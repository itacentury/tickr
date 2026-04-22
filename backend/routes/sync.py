"""RxDB-compatible sync endpoints for offline-first replication."""

import asyncio
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Body, Depends
from fastapi.responses import StreamingResponse

from ..config import SSE_HEARTBEAT_INTERVAL
from ..database import get_db, now
from ..errors import AppError, ErrorCode
from ..events import broadcast_sync, broadcast_update, sync_broadcaster
from ..logging_config import get_logger
from ..models import SyncChange

logger = get_logger(__name__)

router = APIRouter(prefix="/api/v1/sync")


HistoryLogger = Callable[[sqlite3.Cursor, dict[str, Any] | None, dict[str, Any]], None]


@dataclass(frozen=True)
class CollectionSpec:
    """Describes how to persist and replicate a single RxDB collection."""

    table: str
    insert_fields: tuple[str, ...]
    update_fields: tuple[str, ...]
    defaults: Callable[[], dict[str, Any]]
    broadcast_event: str
    log_history: HistoryLogger | None = None

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
    timestamp: str = now()
    return {
        "name": "",
        "icon": "list",
        "item_sort": "alphabetical",
        "sort_order": 0,
        "created_at": timestamp,
        "updated_at": timestamp,
        "_deleted": 0,
    }


def _item_defaults() -> dict[str, Any]:
    """Defaults for a fresh ``items`` document (timestamps computed per call)."""
    timestamp: str = now()
    return {
        "list_id": "",
        "text": "",
        "completed": 0,
        "created_at": timestamp,
        "updated_at": timestamp,
        "completed_at": None,
        "_deleted": 0,
    }


def _insert_history(
    cursor: sqlite3.Cursor,
    list_id: str | None,
    item_id: str | None,
    action: str,
    item_text: str | None,
) -> None:
    """Append one history row; timestamp defaults to CURRENT_TIMESTAMP."""
    cursor.execute(
        "INSERT INTO history (list_id, item_id, action, item_text) VALUES (?, ?, ?, ?)",
        (list_id, item_id, action, item_text),
    )


def _log_list_history(
    cursor: sqlite3.Cursor,
    current: dict[str, Any] | None,
    new_state: dict[str, Any],
) -> None:
    """Log list lifecycle events derived from the diff between current and new state.

    Reorder-only updates (``sort_order`` changes) are intentionally ignored — they
    reflect UI preference, not a meaningful list change.
    """
    if current is None:
        if not new_state.get("_deleted"):
            _insert_history(cursor, new_state["id"], None, "list_created", new_state.get("name"))
        return

    if not current.get("_deleted") and new_state.get("_deleted"):
        return

    list_id: str = new_state["id"]

    old_name: str | None = current.get("name")
    new_name: str | None = new_state.get("name")
    if new_name is not None and old_name != new_name:
        _insert_history(cursor, list_id, None, "list_renamed", f"{old_name} → {new_name}")

    old_icon: str | None = current.get("icon")
    new_icon: str | None = new_state.get("icon")
    if new_icon is not None and old_icon != new_icon:
        _insert_history(cursor, list_id, None, "list_icon_changed", f"{old_icon} → {new_icon}")

    old_sort: str | None = current.get("item_sort")
    new_sort: str | None = new_state.get("item_sort")
    if new_sort is not None and old_sort != new_sort:
        _insert_history(cursor, list_id, None, "list_sort_changed", f"{old_sort} → {new_sort}")


def _log_item_history(
    cursor: sqlite3.Cursor,
    current: dict[str, Any] | None,
    new_state: dict[str, Any],
) -> None:
    """Log item lifecycle events derived from the diff between current and new state."""
    list_id: str | None = new_state.get("list_id") or (current or {}).get("list_id")
    item_id: str = new_state["id"]

    if current is None:
        if not new_state.get("_deleted"):
            _insert_history(cursor, list_id, item_id, "item_created", new_state.get("text"))
        return

    if not current.get("_deleted") and new_state.get("_deleted"):
        _insert_history(cursor, list_id, item_id, "item_deleted", current.get("text"))
        return

    old_text: str | None = current.get("text")
    new_text: str | None = new_state.get("text")
    if old_text != new_text:
        _insert_history(cursor, list_id, item_id, "item_renamed", f"{old_text} \u2192 {new_text}")

    old_completed: bool = bool(current.get("completed"))
    new_completed: bool = bool(new_state.get("completed"))
    if old_completed != new_completed:
        action: str = "item_completed" if new_completed else "item_uncompleted"
        _insert_history(cursor, list_id, item_id, action, new_text)


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
        log_history=_log_list_history,
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
        log_history=_log_item_history,
    ),
}


def _require_spec(collection: str) -> CollectionSpec:
    """Return the spec for ``collection`` or raise 400 if unknown."""
    spec: CollectionSpec | None = COLLECTIONS.get(collection)
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


def _resolve_values(
    spec: CollectionSpec, doc: dict[str, Any], fields: tuple[str, ...]
) -> tuple[Any, ...]:
    """Pick ``fields`` from ``doc`` in order, filling gaps from ``spec.defaults()``."""
    defaults: dict[str, Any] = spec.defaults()
    return tuple(doc.get(f, defaults.get(f)) for f in fields)


def _insert_doc(cursor: sqlite3.Cursor, spec: CollectionSpec, doc: dict[str, Any]) -> None:
    """Insert a new document into the collection described by ``spec``."""
    cursor.execute(spec.insert_sql, _resolve_values(spec, doc, spec.insert_fields))


def _update_doc(cursor: sqlite3.Cursor, spec: CollectionSpec, doc: dict[str, Any]) -> None:
    """Update an existing document; ``id`` is appended as the WHERE parameter."""
    values: tuple[Any, ...] = _resolve_values(spec, doc, spec.update_fields)
    cursor.execute(spec.update_sql, (*values, doc["id"]))


def _states_match(current: dict[str, Any], assumed: dict[str, Any]) -> bool:
    """Check if current server state matches the client's assumed state."""
    return current.get("updated_at") == assumed.get("updated_at")


@router.get("/{collection}/pull")
def sync_pull(
    collection: str,
    updated_at: str | None = None,
    id: str | None = None,
    limit: int = 100,
    db: sqlite3.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Pull documents newer than the given checkpoint for RxDB replication."""
    spec: CollectionSpec = _require_spec(collection)
    cursor: sqlite3.Cursor = db.cursor()

    rows: list[sqlite3.Row] = _pull_docs(cursor, spec, updated_at, id, limit)
    documents: list[dict[str, Any]] = [dict(row) for row in rows]

    checkpoint: dict[str, Any] | None = None
    if documents:
        last: dict[str, Any] = documents[-1]
        checkpoint = {"updatedAt": last["updated_at"], "id": last["id"]}

    return {"documents": documents, "checkpoint": checkpoint}


@router.post("/{collection}/push")
def sync_push(
    collection: str,
    bg: BackgroundTasks,
    changes: list[SyncChange] = Body(..., max_length=500),
    db: sqlite3.Connection = Depends(get_db),
) -> list[dict[str, Any]]:
    """Push local changes to the server for RxDB replication.

    Each change contains newDocumentState and optionally assumedMasterState.
    Returns an array of conflicts (empty means success).
    """
    spec: CollectionSpec = _require_spec(collection)
    cursor: sqlite3.Cursor = db.cursor()
    conflicts: list[dict[str, Any]] = []

    with db:
        for change in changes:
            new_state: dict[str, Any] = change.new_document_state
            assumed: dict[str, Any] | None = change.assumed_master_state

            if "id" not in new_state:
                raise AppError(ErrorCode.VALIDATION_ERROR, "newDocumentState.id missing", 422)
            doc_id: str = new_state["id"]

            current: sqlite3.Row | None = _select_doc(cursor, spec, doc_id)
            current_dict: dict[str, Any] | None = dict(current) if current else None

            try:
                if assumed is None:
                    if current_dict:
                        conflicts.append(current_dict)
                        continue
                    _insert_doc(cursor, spec, new_state)
                    if spec.log_history is not None:
                        spec.log_history(cursor, None, new_state)
                else:
                    if not current_dict:
                        _insert_doc(cursor, spec, new_state)
                        if spec.log_history is not None:
                            spec.log_history(cursor, None, new_state)
                    elif _states_match(current_dict, assumed):
                        _update_doc(cursor, spec, new_state)
                        if spec.log_history is not None:
                            spec.log_history(cursor, current_dict, new_state)
                    else:
                        conflicts.append(current_dict)
                        continue
            except sqlite3.IntegrityError as exc:
                logger.warning(
                    "sync_push_integrity_error",
                    collection=collection,
                    doc_id=doc_id,
                    error=str(exc),
                )
                refreshed: sqlite3.Row | None = _select_doc(cursor, spec, doc_id)
                if refreshed:
                    conflicts.append(dict(refreshed))
                else:
                    raise AppError(ErrorCode.CONFLICT, str(exc), 409) from exc

    if not conflicts:
        bg.add_task(broadcast_update, spec.broadcast_event)
        bg.add_task(broadcast_sync, collection)

    return conflicts


@router.get("/stream")
async def sync_stream() -> StreamingResponse:
    """SSE stream that notifies clients when collections change."""
    queue: asyncio.Queue[str] = await sync_broadcaster.register()
    return StreamingResponse(
        sync_broadcaster.stream(queue, heartbeat=SSE_HEARTBEAT_INTERVAL),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
