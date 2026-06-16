"""Item CRUD endpoints."""

import sqlite3
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends

from ..database import get_db, log_history, new_uuid, now
from ..errors import AppError, ErrorCode
from ..events import notify_change
from ..history import log_item_diff
from ..logging_config import get_logger
from ..models import (
    SORT_SQL,
    ItemCreate,
    ItemResponse,
    ItemUpdate,
    SuccessResponse,
    resolve_sort_sql,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/api/v1")


@router.get("/lists/{list_id}/items", response_model=list[ItemResponse])
def get_items(
    list_id: str, include_completed: bool = False, db: sqlite3.Connection = Depends(get_db)
) -> list[dict]:
    """Return non-deleted items for a list, sorted according to list settings."""
    cursor: sqlite3.Cursor = db.cursor()

    cursor.execute("SELECT item_sort FROM lists WHERE id = ? AND _deleted = 0", (list_id,))
    row: sqlite3.Row | None = cursor.fetchone()
    if row is None:
        raise AppError(ErrorCode.LIST_NOT_FOUND, "List not found", 404)
    order_by: str = resolve_sort_sql(row["item_sort"], SORT_SQL)

    if include_completed:
        cursor.execute(
            f"SELECT * FROM items WHERE list_id = ? AND _deleted = 0 "
            f"ORDER BY completed, {order_by}",
            (list_id,),
        )
    else:
        cursor.execute(
            f"SELECT * FROM items WHERE list_id = ? AND _deleted = 0 AND completed = 0 "
            f"ORDER BY {order_by}",
            (list_id,),
        )
    rows: list[sqlite3.Row] = cursor.fetchall()
    return [dict(row) for row in rows]


@router.post("/lists/{list_id}/items", response_model=ItemResponse)
def create_item(
    list_id: str,
    item_data: ItemCreate,
    bg: BackgroundTasks,
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Create a new item in a list and log to history."""
    cursor: sqlite3.Cursor = db.cursor()
    timestamp: str = now()
    item_id: str = new_uuid()

    cursor.execute(
        "INSERT INTO items (id, list_id, text, category_id, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (item_id, list_id, item_data.text, item_data.category_id, timestamp, timestamp),
    )

    if not item_data.undo:
        log_history(cursor, list_id, "item_created", item_data.text, item_id)

    db.commit()
    notify_change(bg, "items_changed", "items", list_id)
    logger.info("item_created", item_id=item_id, list_id=list_id, text=item_data.text[:50])
    return {
        "id": item_id,
        "list_id": list_id,
        "text": item_data.text,
        "completed": False,
        "category_id": item_data.category_id,
        "created_at": timestamp,
        "updated_at": timestamp,
        "completed_at": None,
    }


def _staged_item_changes(
    item: sqlite3.Row, item_data: ItemUpdate, timestamp: str
) -> dict[str, Any]:
    """Return only the columns that actually differ from the stored item.

    Completion is diff-based: re-completing an already-completed item is a no-op,
    matching the sync push semantics. ``category_id`` uses model_fields_set so
    clearing it to ``None`` is honored.
    """
    changes: dict[str, Any] = {}
    if item_data.text is not None and item_data.text != item["text"]:
        changes["text"] = item_data.text
    if "category_id" in item_data.model_fields_set and item_data.category_id != item["category_id"]:
        changes["category_id"] = item_data.category_id
    if item_data.completed is not None and bool(item_data.completed) != bool(item["completed"]):
        changes["completed"] = int(item_data.completed)
        changes["completed_at"] = timestamp if item_data.completed else None
    return changes


@router.put("/items/{item_id}", response_model=SuccessResponse)
def update_item(
    item_id: str,
    item_data: ItemUpdate,
    bg: BackgroundTasks,
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Update item text, category, and/or completion status with history logging."""
    cursor: sqlite3.Cursor = db.cursor()

    cursor.execute("SELECT * FROM items WHERE id = ? AND _deleted = 0", (item_id,))
    item: sqlite3.Row | None = cursor.fetchone()
    if not item:
        logger.warning("item_not_found", item_id=item_id, op="update")
        raise AppError(ErrorCode.ITEM_NOT_FOUND, "Item not found", 404)

    timestamp: str = now()
    changes: dict[str, Any] = _staged_item_changes(item, item_data, timestamp)

    if changes:
        new_values: dict[str, Any] = {**dict(item), **changes, "updated_at": timestamp}
        log_item_diff(cursor, dict(item), new_values, undo=item_data.undo)

    changes["updated_at"] = timestamp
    assignments: str = ", ".join(f"{column} = ?" for column in changes)
    cursor.execute(f"UPDATE items SET {assignments} WHERE id = ?", (*changes.values(), item_id))
    db.commit()
    notify_change(bg, "items_changed", "items", item["list_id"])
    logger.info("item_updated", item_id=item_id)

    return {"success": True}


@router.delete("/items/{item_id}", response_model=SuccessResponse)
def delete_item(
    item_id: str,
    bg: BackgroundTasks,
    undo: bool = False,
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Soft-delete an item and log to history."""
    cursor: sqlite3.Cursor = db.cursor()
    timestamp: str = now()

    cursor.execute("SELECT * FROM items WHERE id = ? AND _deleted = 0", (item_id,))
    item: sqlite3.Row | None = cursor.fetchone()
    list_id: str | None = item["list_id"] if item else None

    if item and not undo:
        log_history(cursor, item["list_id"], "item_deleted", item["text"], item_id)

    cursor.execute(
        "UPDATE items SET _deleted = 1, updated_at = ? WHERE id = ?",
        (timestamp, item_id),
    )
    db.commit()

    if item:
        notify_change(bg, "items_changed", "items", list_id)
    logger.info("item_deleted", item_id=item_id)
    return {"success": True}
