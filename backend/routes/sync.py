"""RxDB-compatible sync endpoints for offline-first replication."""

import logging
import sqlite3

from fastapi import APIRouter, Body, Depends
from fastapi.responses import StreamingResponse

from ..config import SSE_HEARTBEAT_INTERVAL
from ..database import get_db, now
from ..errors import AppError, ErrorCode
from ..events import broadcast_sync, broadcast_update, sync_broadcaster
from ..models import SyncChange

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/sync")


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
        raise AppError(ErrorCode.INVALID_COLLECTION, "Invalid collection", 400)

    cursor = db.cursor()

    rows = _pull_docs(cursor, collection, updated_at, id, limit)
    documents = [dict(row) for row in rows]

    checkpoint = None
    if documents:
        last = documents[-1]
        checkpoint = {"updatedAt": last["updated_at"], "id": last["id"]}

    return {"documents": documents, "checkpoint": checkpoint}


@router.post("/{collection}/push")
def sync_push(
    collection: str,
    changes: list[SyncChange] = Body(..., max_length=500),
    db: sqlite3.Connection = Depends(get_db),
):
    """Push local changes to the server for RxDB replication.

    Each change contains newDocumentState and optionally assumedMasterState.
    Returns an array of conflicts (empty means success).
    """
    if collection not in ("lists", "items"):
        raise AppError(ErrorCode.INVALID_COLLECTION, "Invalid collection", 400)

    cursor = db.cursor()
    conflicts: list[dict] = []

    with db:
        for change in changes:
            new_state = change.new_document_state
            assumed = change.assumed_master_state

            if "id" not in new_state:
                raise AppError(ErrorCode.VALIDATION_ERROR, "newDocumentState.id missing", 422)
            doc_id = new_state["id"]

            current = _select_doc(cursor, collection, doc_id)
            current_dict = dict(current) if current else None

            try:
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
            except sqlite3.IntegrityError as exc:
                logger.warning(
                    "Integrity error in sync_push for %s/%s: %s", collection, doc_id, exc
                )
                refreshed = _select_doc(cursor, collection, doc_id)
                if refreshed:
                    conflicts.append(dict(refreshed))
                else:
                    raise AppError(ErrorCode.CONFLICT, str(exc), 409) from exc

    if not conflicts:
        broadcast_update("lists_changed" if collection == "lists" else "items_changed")
        broadcast_sync(collection)

    return conflicts


def _select_doc(cursor: sqlite3.Cursor, collection: str, doc_id: str) -> sqlite3.Row | None:
    """Select a single document by ID from the specified collection."""
    if collection == "lists":
        cursor.execute("SELECT * FROM lists WHERE id = ?", (doc_id,))
    elif collection == "items":
        cursor.execute("SELECT * FROM items WHERE id = ?", (doc_id,))
    return cursor.fetchone()


def _pull_docs(
    cursor: sqlite3.Cursor,
    collection: str,
    updated_at: str | None,
    id: str | None,
    limit: int,
) -> list[sqlite3.Row]:
    """Fetch documents from a collection for replication pull."""
    if updated_at and id:
        if collection == "lists":
            cursor.execute(
                "SELECT * FROM lists WHERE (updated_at > ?) OR (updated_at = ? AND id > ?) "
                "ORDER BY updated_at ASC, id ASC LIMIT ?",
                (updated_at, updated_at, id, limit),
            )
        elif collection == "items":
            cursor.execute(
                "SELECT * FROM items WHERE (updated_at > ?) OR (updated_at = ? AND id > ?) "
                "ORDER BY updated_at ASC, id ASC LIMIT ?",
                (updated_at, updated_at, id, limit),
            )
    else:
        if collection == "lists":
            cursor.execute(
                "SELECT * FROM lists ORDER BY updated_at ASC, id ASC LIMIT ?",
                (limit,),
            )
        elif collection == "items":
            cursor.execute(
                "SELECT * FROM items ORDER BY updated_at ASC, id ASC LIMIT ?",
                (limit,),
            )
    return cursor.fetchall()


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
    queue = await sync_broadcaster.register()
    return StreamingResponse(
        sync_broadcaster.stream(queue, heartbeat=SSE_HEARTBEAT_INTERVAL),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
