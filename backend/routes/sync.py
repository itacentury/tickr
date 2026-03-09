"""RxDB-compatible sync endpoints for offline-first replication."""

import asyncio
import logging
import sqlite3
from queue import Empty, Queue

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from ..database import get_db, now
from ..events import (
    MAX_SSE_CLIENTS,
    broadcast_sync,
    broadcast_update,
    sync_clients_lock,
    sync_connected_clients,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sync")


@router.get("/{collection}/pull")
def sync_pull(
    collection: str,
    updated_at: str | None = None,
    id: str | None = None,
    limit: int = 100,
    db: sqlite3.Connection = Depends(get_db),
):
    """Pull documents newer than the given checkpoint for RxDB replication."""
    if collection not in ("lists", "items"):
        raise HTTPException(status_code=400, detail="Invalid collection")

    cursor = db.cursor()

    if updated_at and id:
        cursor.execute(
            f"SELECT * FROM {collection} "
            f"WHERE (updated_at > ?) OR (updated_at = ? AND id > ?) "
            f"ORDER BY updated_at ASC, id ASC LIMIT ?",
            (updated_at, updated_at, id, limit),
        )
    else:
        cursor.execute(
            f"SELECT * FROM {collection} ORDER BY updated_at ASC, id ASC LIMIT ?",
            (limit,),
        )

    rows = cursor.fetchall()
    documents = [dict(row) for row in rows]

    checkpoint = None
    if documents:
        last = documents[-1]
        checkpoint = {"updatedAt": last["updated_at"], "id": last["id"]}

    return {"documents": documents, "checkpoint": checkpoint}


@router.post("/{collection}/push")
def sync_push(
    collection: str,
    changes: list[dict],
    db: sqlite3.Connection = Depends(get_db),
):
    """Push local changes to the server for RxDB replication.

    Each change contains newDocumentState and optionally assumedMasterState.
    Returns an array of conflicts (empty means success).
    """
    if collection not in ("lists", "items"):
        raise HTTPException(status_code=400, detail="Invalid collection")

    cursor = db.cursor()
    conflicts: list[dict] = []

    for change in changes:
        new_state = change["newDocumentState"]
        assumed = change.get("assumedMasterState")
        doc_id = new_state["id"]

        cursor.execute(f"SELECT * FROM {collection} WHERE id = ?", (doc_id,))
        current = cursor.fetchone()
        current_dict = dict(current) if current else None

        if assumed is None:
            if current_dict:
                conflicts.append(current_dict)
                continue
            _insert_doc(cursor, collection, new_state)
        else:
            if not current_dict:
                _insert_doc(cursor, collection, new_state)
            elif _states_match(current_dict, assumed):
                _update_doc(cursor, collection, new_state)
            else:
                conflicts.append(current_dict)
                continue

    db.commit()

    if not conflicts:
        broadcast_update("lists_changed" if collection == "lists" else "items_changed")
        broadcast_sync(collection)

    return conflicts


def _insert_doc(cursor: sqlite3.Cursor, collection: str, doc: dict) -> None:
    """Insert a new document into the specified collection."""
    if collection == "lists":
        cursor.execute(
            "INSERT INTO lists (id, name, icon, item_sort, sort_order, "
            "created_at, updated_at, _deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                doc["id"],
                doc.get("name", ""),
                doc.get("icon", "list"),
                doc.get("item_sort", "alphabetical"),
                doc.get("sort_order", 0),
                doc.get("created_at", now()),
                doc.get("updated_at", now()),
                doc.get("_deleted", 0),
            ),
        )
    elif collection == "items":
        cursor.execute(
            "INSERT INTO items (id, list_id, text, completed, created_at, "
            "updated_at, completed_at, _deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                doc["id"],
                doc.get("list_id", ""),
                doc.get("text", ""),
                doc.get("completed", 0),
                doc.get("created_at", now()),
                doc.get("updated_at", now()),
                doc.get("completed_at"),
                doc.get("_deleted", 0),
            ),
        )


def _update_doc(cursor: sqlite3.Cursor, collection: str, doc: dict) -> None:
    """Update an existing document in the specified collection."""
    if collection == "lists":
        cursor.execute(
            "UPDATE lists SET name=?, icon=?, item_sort=?, sort_order=?, "
            "updated_at=?, _deleted=? WHERE id=?",
            (
                doc.get("name", ""),
                doc.get("icon", "list"),
                doc.get("item_sort", "alphabetical"),
                doc.get("sort_order", 0),
                doc.get("updated_at", now()),
                doc.get("_deleted", 0),
                doc["id"],
            ),
        )
    elif collection == "items":
        cursor.execute(
            "UPDATE items SET list_id=?, text=?, completed=?, "
            "updated_at=?, completed_at=?, _deleted=? WHERE id=?",
            (
                doc.get("list_id", ""),
                doc.get("text", ""),
                doc.get("completed", 0),
                doc.get("updated_at", now()),
                doc.get("completed_at"),
                doc.get("_deleted", 0),
                doc["id"],
            ),
        )


def _states_match(current: dict, assumed: dict) -> bool:
    """Check if current server state matches the client's assumed state."""
    return current.get("updated_at") == assumed.get("updated_at")


@router.get("/stream")
async def sync_stream() -> StreamingResponse:
    """SSE stream that notifies clients when collections change."""
    with sync_clients_lock:
        if len(sync_connected_clients) >= MAX_SSE_CLIENTS:
            raise HTTPException(status_code=429, detail="Too many SSE connections")

    queue: Queue = Queue(maxsize=100)
    with sync_clients_lock:
        sync_connected_clients.append(queue)
        logger.info("Sync SSE client connected (%d active)", len(sync_connected_clients))

    async def event_generator():
        """Generate SSE events for sync stream."""
        heartbeat_interval = 15
        last_heartbeat = asyncio.get_event_loop().time()

        try:
            while True:
                current_time = asyncio.get_event_loop().time()

                if current_time - last_heartbeat >= heartbeat_interval:
                    yield ": heartbeat\n\n"
                    last_heartbeat = current_time

                try:
                    data = queue.get_nowait()
                    yield f"data: {data}\n\n"
                except Empty:
                    await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            pass
        finally:
            with sync_clients_lock:
                if queue in sync_connected_clients:
                    sync_connected_clients.remove(queue)
                logger.info("Sync SSE client disconnected (%d active)", len(sync_connected_clients))

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
