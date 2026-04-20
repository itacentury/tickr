"""RxDB-compatible sync endpoints for offline-first replication."""

import logging
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, Body, Depends
from fastapi.responses import StreamingResponse

from ..config import SSE_HEARTBEAT_INTERVAL
from ..database import get_db, now
from ..errors import AppError, ErrorCode
from ..events import broadcast_sync, broadcast_update, sync_broadcaster
from ..models import SyncChange

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/sync")


@dataclass(frozen=True)
class CollectionSpec:
    """Describes how to persist and replicate a single RxDB collection."""

    table: str
    insert_fields: tuple[str, ...]
    update_fields: tuple[str, ...]
    defaults: Callable[[], dict[str, Any]]
    broadcast_event: str

    @property
    def select_sql(self) -> str:
        """SQL for fetching a single document by id."""
        return f"SELECT * FROM {self.table} WHERE id = ?"

    @property
    def insert_sql(self) -> str:
        """SQL for inserting a document by positional insert_fields."""
        cols = ", ".join(self.insert_fields)
        placeholders = ", ".join("?" * len(self.insert_fields))
        return f"INSERT INTO {self.table} ({cols}) VALUES ({placeholders})"

    @property
    def update_sql(self) -> str:
        """SQL for updating a document by positional update_fields, keyed on id."""
        assignments = ", ".join(f"{f}=?" for f in self.update_fields)
        return f"UPDATE {self.table} SET {assignments} WHERE id=?"

    @property
    def pull_sql_checkpoint(self) -> str:
        """SQL for fetching documents strictly newer than the given checkpoint."""
        return (
            f"SELECT * FROM {self.table} "
            "WHERE (updated_at > ?) OR (updated_at = ? AND id > ?) "
            "ORDER BY updated_at ASC, id ASC LIMIT ?"
        )

    @property
    def pull_sql_all(self) -> str:
        """SQL for fetching all documents in replication order."""
        return f"SELECT * FROM {self.table} ORDER BY updated_at ASC, id ASC LIMIT ?"


def _list_defaults() -> dict[str, Any]:
    """Defaults for a fresh ``lists`` document (timestamps computed per call)."""
    ts = now()
    return {
        "name": "",
        "icon": "list",
        "item_sort": "alphabetical",
        "sort_order": 0,
        "created_at": ts,
        "updated_at": ts,
        "_deleted": 0,
    }


def _item_defaults() -> dict[str, Any]:
    """Defaults for a fresh ``items`` document (timestamps computed per call)."""
    ts = now()
    return {
        "list_id": "",
        "text": "",
        "completed": 0,
        "created_at": ts,
        "updated_at": ts,
        "completed_at": None,
        "_deleted": 0,
    }


COLLECTIONS: dict[str, CollectionSpec] = {
    "lists": CollectionSpec(
        table="lists",
        insert_fields=(
            "id",
            "name",
            "icon",
            "item_sort",
            "sort_order",
            "created_at",
            "updated_at",
            "_deleted",
        ),
        update_fields=(
            "name",
            "icon",
            "item_sort",
            "sort_order",
            "updated_at",
            "_deleted",
        ),
        defaults=_list_defaults,
        broadcast_event="lists_changed",
    ),
    "items": CollectionSpec(
        table="items",
        insert_fields=(
            "id",
            "list_id",
            "text",
            "completed",
            "created_at",
            "updated_at",
            "completed_at",
            "_deleted",
        ),
        update_fields=(
            "list_id",
            "text",
            "completed",
            "updated_at",
            "completed_at",
            "_deleted",
        ),
        defaults=_item_defaults,
        broadcast_event="items_changed",
    ),
}


def _require_spec(collection: str) -> CollectionSpec:
    """Return the spec for ``collection`` or raise 400 if unknown."""
    spec = COLLECTIONS.get(collection)
    if spec is None:
        raise AppError(ErrorCode.INVALID_COLLECTION, "Invalid collection", 400)
    return spec


def _select_doc(cursor: sqlite3.Cursor, spec: CollectionSpec, doc_id: str) -> sqlite3.Row | None:
    """Select a single document by id from the collection described by ``spec``."""
    cursor.execute(spec.select_sql, (doc_id,))
    return cursor.fetchone()


def _pull_docs(
    cursor: sqlite3.Cursor,
    spec: CollectionSpec,
    updated_at: str | None,
    id: str | None,
    limit: int,
) -> list[sqlite3.Row]:
    """Fetch a page of replication documents, optionally newer than a checkpoint."""
    if updated_at and id:
        cursor.execute(spec.pull_sql_checkpoint, (updated_at, updated_at, id, limit))
    else:
        cursor.execute(spec.pull_sql_all, (limit,))
    return cursor.fetchall()


def _resolve_values(spec: CollectionSpec, doc: dict, fields: tuple[str, ...]) -> tuple[Any, ...]:
    """Pick ``fields`` from ``doc`` in order, filling gaps from ``spec.defaults()``."""
    defaults = spec.defaults()
    return tuple(doc.get(f, defaults.get(f)) for f in fields)


def _insert_doc(cursor: sqlite3.Cursor, spec: CollectionSpec, doc: dict) -> None:
    """Insert a new document into the collection described by ``spec``."""
    cursor.execute(spec.insert_sql, _resolve_values(spec, doc, spec.insert_fields))


def _update_doc(cursor: sqlite3.Cursor, spec: CollectionSpec, doc: dict) -> None:
    """Update an existing document; ``id`` is appended as the WHERE parameter."""
    values = _resolve_values(spec, doc, spec.update_fields)
    cursor.execute(spec.update_sql, (*values, doc["id"]))


def _states_match(current: dict, assumed: dict) -> bool:
    """Check if current server state matches the client's assumed state."""
    return current.get("updated_at") == assumed.get("updated_at")


@router.get("/{collection}/pull")
def sync_pull(
    collection: str,
    updated_at: str | None = None,
    id: str | None = None,
    limit: int = 100,
    db: sqlite3.Connection = Depends(get_db),
):
    """Pull documents newer than the given checkpoint for RxDB replication."""
    spec = _require_spec(collection)
    cursor = db.cursor()

    rows = _pull_docs(cursor, spec, updated_at, id, limit)
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
    spec = _require_spec(collection)
    cursor = db.cursor()
    conflicts: list[dict] = []

    with db:
        for change in changes:
            new_state = change.new_document_state
            assumed = change.assumed_master_state

            if "id" not in new_state:
                raise AppError(ErrorCode.VALIDATION_ERROR, "newDocumentState.id missing", 422)
            doc_id = new_state["id"]

            current = _select_doc(cursor, spec, doc_id)
            current_dict = dict(current) if current else None

            try:
                if assumed is None:
                    if current_dict:
                        conflicts.append(current_dict)
                        continue
                    _insert_doc(cursor, spec, new_state)
                else:
                    if not current_dict:
                        _insert_doc(cursor, spec, new_state)
                    elif _states_match(current_dict, assumed):
                        _update_doc(cursor, spec, new_state)
                    else:
                        conflicts.append(current_dict)
                        continue
            except sqlite3.IntegrityError as exc:
                logger.warning(
                    "Integrity error in sync_push for %s/%s: %s", collection, doc_id, exc
                )
                refreshed = _select_doc(cursor, spec, doc_id)
                if refreshed:
                    conflicts.append(dict(refreshed))
                else:
                    raise AppError(ErrorCode.CONFLICT, str(exc), 409) from exc

    if not conflicts:
        broadcast_update(spec.broadcast_event)
        broadcast_sync(collection)

    return conflicts


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
