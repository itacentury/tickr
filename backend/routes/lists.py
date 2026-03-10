"""List CRUD and reorder endpoints."""

import logging
import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from ..database import get_db, new_uuid, now
from ..events import broadcast_sync, broadcast_update
from ..models import VALID_SORT_OPTIONS, ListCreate, ListReorder, ListUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1")


@router.get("/lists")
def get_lists(db: sqlite3.Connection = Depends(get_db)):
    """Return all non-deleted lists with item counts, sorted according to settings."""
    cursor = db.cursor()

    cursor.execute("SELECT value FROM settings WHERE key = 'list_sort'")
    row = cursor.fetchone()
    list_sort = row["value"] if row else "alphabetical"

    list_sort_sql = {
        "alphabetical": "l.name COLLATE NOCASE ASC",
        "alphabetical_desc": "l.name COLLATE NOCASE DESC",
        "created_desc": "l.created_at DESC",
        "created_asc": "l.created_at ASC",
        "custom": "l.sort_order, l.created_at",
    }
    order_by = list_sort_sql.get(list_sort, list_sort_sql["alphabetical"])

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
    rows = cursor.fetchall()
    return [dict(row) for row in rows]


@router.post("/lists")
def create_list(list_data: ListCreate, db: sqlite3.Connection = Depends(get_db)):
    """Create a new list and log to history."""
    cursor = db.cursor()
    ts = now()
    list_id = new_uuid()

    cursor.execute("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM lists WHERE _deleted = 0")
    next_sort_order = cursor.fetchone()[0]

    cursor.execute(
        "INSERT INTO lists (id, name, icon, sort_order, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (list_id, list_data.name, list_data.icon, next_sort_order, ts, ts),
    )

    if not list_data.undo:
        cursor.execute(
            "INSERT INTO history (list_id, action, item_text) VALUES (?, ?, ?)",
            (list_id, "list_created", list_data.name),
        )

    db.commit()
    broadcast_update("lists_changed")
    broadcast_sync("lists")
    logger.info("Created list '%s' (id=%s)", list_data.name, list_id)
    return {"id": list_id, "name": list_data.name, "icon": list_data.icon}


@router.put("/lists/{list_id}")
def update_list(list_id: str, list_data: ListUpdate, db: sqlite3.Connection = Depends(get_db)):
    """Update list name, icon, and/or sorting preference."""
    cursor = db.cursor()

    if list_data.item_sort is not None and list_data.item_sort not in VALID_SORT_OPTIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid sort option. Valid options: {', '.join(VALID_SORT_OPTIONS)}",
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
    broadcast_update("lists_changed", list_id)
    broadcast_sync("lists")
    logger.info("Updated list id=%s", list_id)

    return {"success": True}


@router.delete("/lists/{list_id}")
def delete_list(list_id: str, db: sqlite3.Connection = Depends(get_db)):
    """Soft-delete a list and its items."""
    cursor = db.cursor()
    ts = now()

    cursor.execute(
        "UPDATE items SET _deleted = 1, updated_at = ? WHERE list_id = ? AND _deleted = 0",
        (ts, list_id),
    )
    cursor.execute(
        "UPDATE lists SET _deleted = 1, updated_at = ? WHERE id = ?",
        (ts, list_id),
    )
    cursor.execute("DELETE FROM history WHERE list_id = ?", (list_id,))

    db.commit()
    broadcast_update("lists_changed")
    broadcast_sync("lists")
    broadcast_sync("items")
    logger.info("Soft-deleted list id=%s", list_id)
    return {"success": True}


@router.post("/lists/reorder")
def reorder_lists(reorder_data: ListReorder, db: sqlite3.Connection = Depends(get_db)):
    """Update the sort order of lists based on provided order."""
    cursor = db.cursor()
    ts = now()

    for idx, list_id in enumerate(reorder_data.list_ids):
        cursor.execute(
            "UPDATE lists SET sort_order = ?, updated_at = ? WHERE id = ?",
            (idx, ts, list_id),
        )

    db.commit()
    broadcast_update("lists_changed")
    broadcast_sync("lists")
    return {"success": True}
