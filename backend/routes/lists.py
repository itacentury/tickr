"""List CRUD and reorder endpoints."""

import sqlite3

from fastapi import APIRouter, BackgroundTasks, Depends

from ..database import get_db, log_history, new_uuid, now
from ..errors import AppError, ErrorCode
from ..events import broadcast_sync, notify_change
from ..logging_config import get_logger
from ..models import (
    LIST_SORT_SQL,
    VALID_SORT_OPTIONS,
    ListCreate,
    ListReorder,
    ListResponse,
    ListUpdate,
    SuccessResponse,
    resolve_sort_sql,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/api/v1")


@router.get("/lists", response_model=list[ListResponse])
def get_lists(db: sqlite3.Connection = Depends(get_db)) -> list[dict]:
    """Return all non-deleted lists with item counts, sorted according to settings."""
    cursor: sqlite3.Cursor = db.cursor()

    cursor.execute("SELECT value FROM settings WHERE key = 'list_sort'")
    row: sqlite3.Row | None = cursor.fetchone()
    order_by: str = resolve_sort_sql(row["value"] if row else None, LIST_SORT_SQL)

    cursor.execute(f"""
        SELECT l.*,
               COUNT(i.id) as total_items,
               SUM(CASE WHEN i.completed = 1 THEN 1 ELSE 0 END) as completed_items
        FROM lists l
        LEFT JOIN items i ON l.id = i.list_id AND i._deleted = 0
        WHERE l._deleted = 0
        GROUP BY l.id
        ORDER BY {order_by}
    """)
    rows: list[sqlite3.Row] = cursor.fetchall()
    return [dict(row) for row in rows]


@router.post("/lists", response_model=ListResponse)
def create_list(
    list_data: ListCreate,
    bg: BackgroundTasks,
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Create a new list and log to history."""
    cursor: sqlite3.Cursor = db.cursor()
    timestamp: str = now()
    list_id: str = new_uuid()

    cursor.execute("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM lists WHERE _deleted = 0")
    next_sort_order: int = cursor.fetchone()[0]

    cursor.execute(
        "INSERT INTO lists (id, name, icon, item_sort, sort_order, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            list_id,
            list_data.name,
            list_data.icon,
            "alphabetical",
            next_sort_order,
            timestamp,
            timestamp,
        ),
    )

    if not list_data.undo:
        log_history(cursor, list_id, "list_created", list_data.name)

    db.commit()
    notify_change(bg, "lists_changed", "lists")
    logger.info("list_created", list_id=list_id, name=list_data.name[:50])
    return {
        "id": list_id,
        "name": list_data.name,
        "icon": list_data.icon,
        "item_sort": "alphabetical",
        "sort_order": next_sort_order,
        "created_at": timestamp,
        "updated_at": timestamp,
    }


@router.put("/lists/{list_id}", response_model=SuccessResponse)
def update_list(
    list_id: str,
    list_data: ListUpdate,
    bg: BackgroundTasks,
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Update list name, icon, and/or sorting preference."""
    cursor: sqlite3.Cursor = db.cursor()

    if list_data.item_sort is not None and list_data.item_sort not in VALID_SORT_OPTIONS:
        raise AppError(
            ErrorCode.INVALID_SORT_OPTION,
            f"Invalid sort option. Valid options: {', '.join(VALID_SORT_OPTIONS)}",
            400,
        )

    updates: list[str] = ["updated_at = ?"]
    values: list[str | int] = [now()]
    if list_data.name is not None:
        updates.append("name = ?")
        values.append(list_data.name)
    if list_data.icon is not None:
        updates.append("icon = ?")
        values.append(list_data.icon)
    if list_data.item_sort is not None:
        updates.append("item_sort = ?")
        values.append(list_data.item_sort)

    values.append(list_id)
    cursor.execute(f"UPDATE lists SET {', '.join(updates)} WHERE id = ?", values)
    db.commit()
    notify_change(bg, "lists_changed", "lists", list_id)
    logger.info("list_updated", list_id=list_id)

    return {"success": True}


@router.delete("/lists/{list_id}", response_model=SuccessResponse)
def delete_list(
    list_id: str,
    bg: BackgroundTasks,
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Soft-delete a list and its items."""
    cursor: sqlite3.Cursor = db.cursor()
    timestamp: str = now()

    with db:
        cursor.execute(
            "UPDATE items SET _deleted = 1, updated_at = ? WHERE list_id = ? AND _deleted = 0",
            (timestamp, list_id),
        )
        cursor.execute(
            "UPDATE lists SET _deleted = 1, updated_at = ? WHERE id = ?",
            (timestamp, list_id),
        )

    notify_change(bg, "lists_changed", "lists")
    bg.add_task(broadcast_sync, "items")
    logger.info("list_deleted", list_id=list_id)
    return {"success": True}


@router.post("/lists/reorder", response_model=SuccessResponse)
def reorder_lists(
    reorder_data: ListReorder,
    bg: BackgroundTasks,
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Update the sort order of lists based on provided order."""
    cursor: sqlite3.Cursor = db.cursor()
    timestamp: str = now()

    for index, list_id in enumerate(reorder_data.list_ids):
        cursor.execute(
            "UPDATE lists SET sort_order = ?, updated_at = ? WHERE id = ?",
            (index, timestamp, list_id),
        )

    db.commit()
    notify_change(bg, "lists_changed", "lists")
    return {"success": True}
