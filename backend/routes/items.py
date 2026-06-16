"""Item CRUD endpoints."""

import sqlite3

from fastapi import APIRouter, BackgroundTasks, Depends

from ..database import get_db, log_history, new_uuid, now
from ..errors import AppError, ErrorCode
from ..events import notify_change
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


def _apply_text(
    cursor: sqlite3.Cursor,
    item: sqlite3.Row,
    item_data: ItemUpdate,
    updates: list[str],
    values: list[str | int | bool | None],
) -> None:
    """Stage a text change and log a rename when the text actually differs."""
    if item_data.text is None or item_data.text == item["text"]:
        return
    updates.append("text = ?")
    values.append(item_data.text)
    if not item_data.undo:
        log_history(
            cursor,
            item["list_id"],
            "item_renamed",
            f"{item['text']} → {item_data.text}",
            item["id"],
        )


def _apply_category(
    cursor: sqlite3.Cursor,
    item: sqlite3.Row,
    item_data: ItemUpdate,
    updates: list[str],
    values: list[str | int | bool | None],
) -> None:
    """Stage a category change; uses model_fields_set so clearing (None) is honored."""
    if (
        "category_id" not in item_data.model_fields_set
        or item_data.category_id == item["category_id"]
    ):
        return
    updates.append("category_id = ?")
    values.append(item_data.category_id)
    if not item_data.undo:
        log_history(
            cursor,
            item["list_id"],
            "item_category_changed",
            f"{item['category_id'] or ''} → {item_data.category_id or ''}",
            item["id"],
        )


def _apply_completed(
    cursor: sqlite3.Cursor,
    item: sqlite3.Row,
    item_data: ItemUpdate,
    updates: list[str],
    values: list[str | int | bool | None],
    timestamp: str,
) -> None:
    """Stage completion toggle (no diff — matches existing REST semantics) and log it."""
    if item_data.completed is None:
        return
    updates.append("completed = ?")
    values.append(item_data.completed)
    if item_data.completed:
        updates.append("completed_at = ?")
        values.append(timestamp)
        action: str = "item_completed"
    else:
        updates.append("completed_at = NULL")
        action = "item_uncompleted"
    if not item_data.undo:
        log_history(
            cursor,
            item["list_id"],
            action,
            item_data.text or item["text"],
            item["id"],
        )


@router.put("/items/{item_id}", response_model=SuccessResponse)
def update_item(
    item_id: str,
    item_data: ItemUpdate,
    bg: BackgroundTasks,
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Update item text and/or completion status with history logging."""
    cursor: sqlite3.Cursor = db.cursor()

    cursor.execute("SELECT * FROM items WHERE id = ? AND _deleted = 0", (item_id,))
    item: sqlite3.Row | None = cursor.fetchone()
    if not item:
        logger.warning("item_not_found", item_id=item_id, op="update")
        raise AppError(ErrorCode.ITEM_NOT_FOUND, "Item not found", 404)

    timestamp: str = now()
    updates: list[str] = ["updated_at = ?"]
    values: list[str | int | bool | None] = [timestamp]

    _apply_text(cursor, item, item_data, updates, values)
    _apply_category(cursor, item, item_data, updates, values)
    _apply_completed(cursor, item, item_data, updates, values, timestamp)

    values.append(item_id)
    cursor.execute(f"UPDATE items SET {', '.join(updates)} WHERE id = ?", values)
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
