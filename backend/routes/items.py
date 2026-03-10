"""Item CRUD endpoints."""

import logging
import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from ..database import get_db, new_uuid, now
from ..events import broadcast_sync, broadcast_update
from ..models import SORT_SQL, ItemCreate, ItemUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1")


@router.get("/lists/{list_id}/items")
def get_items(
    list_id: str, include_completed: bool = False, db: sqlite3.Connection = Depends(get_db)
):
    """Return non-deleted items for a list, sorted according to list settings."""
    cursor = db.cursor()

    cursor.execute("SELECT item_sort FROM lists WHERE id = ?", (list_id,))
    row = cursor.fetchone()
    sort_option = row["item_sort"] if row and row["item_sort"] else "alphabetical"
    order_by = SORT_SQL.get(sort_option, SORT_SQL["alphabetical"])

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
    rows = cursor.fetchall()
    return [dict(row) for row in rows]


@router.post("/lists/{list_id}/items")
def create_item(list_id: str, item_data: ItemCreate, db: sqlite3.Connection = Depends(get_db)):
    """Create a new item in a list and log to history."""
    cursor = db.cursor()
    ts = now()
    item_id = new_uuid()

    cursor.execute(
        "INSERT INTO items (id, list_id, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        (item_id, list_id, item_data.text, ts, ts),
    )

    if not item_data.undo:
        cursor.execute(
            "INSERT INTO history (list_id, item_id, action, item_text) VALUES (?, ?, ?, ?)",
            (list_id, item_id, "item_created", item_data.text),
        )

    db.commit()
    broadcast_update("items_changed", list_id)
    broadcast_sync("items")
    logger.info("Created item '%s' (id=%s) in list id=%s", item_data.text, item_id, list_id)
    return {"id": item_id, "list_id": list_id, "text": item_data.text, "completed": False}


@router.put("/items/{item_id}")
def update_item(item_id: str, item_data: ItemUpdate, db: sqlite3.Connection = Depends(get_db)):
    """Update item text and/or completion status with history logging."""
    cursor = db.cursor()

    cursor.execute("SELECT * FROM items WHERE id = ? AND _deleted = 0", (item_id,))
    item = cursor.fetchone()
    if not item:
        logger.warning("Item id=%s not found for update", item_id)
        raise HTTPException(status_code=404, detail="Item not found")

    ts = now()
    updates: list[str] = ["updated_at = ?"]
    values: list[str | int | bool] = [ts]

    if item_data.text is not None and item_data.text != item["text"]:
        updates.append("text = ?")
        values.append(item_data.text)

        if not item_data.undo:
            cursor.execute(
                "INSERT INTO history (list_id, item_id, action, item_text) VALUES (?, ?, ?, ?)",
                (item["list_id"], item_id, "item_edited", f"{item['text']} → {item_data.text}"),
            )

    if item_data.completed is not None:
        updates.append("completed = ?")
        values.append(item_data.completed)
        if item_data.completed:
            updates.append("completed_at = ?")
            values.append(ts)

            if not item_data.undo:
                cursor.execute(
                    "INSERT INTO history (list_id, item_id, action, item_text) VALUES (?, ?, ?, ?)",
                    (item["list_id"], item_id, "item_completed", item_data.text or item["text"]),
                )
        else:
            updates.append("completed_at = NULL")

            if not item_data.undo:
                cursor.execute(
                    "INSERT INTO history (list_id, item_id, action, item_text) VALUES (?, ?, ?, ?)",
                    (
                        item["list_id"],
                        item_id,
                        "item_uncompleted",
                        item_data.text or item["text"],
                    ),
                )

    values.append(item_id)
    cursor.execute(f"UPDATE items SET {', '.join(updates)} WHERE id = ?", values)
    db.commit()
    broadcast_update("items_changed", item["list_id"])
    broadcast_sync("items")
    logger.info("Updated item id=%s", item_id)

    return {"success": True}


@router.delete("/items/{item_id}")
def delete_item(item_id: str, undo: bool = False, db: sqlite3.Connection = Depends(get_db)):
    """Soft-delete an item and log to history."""
    cursor = db.cursor()
    ts = now()

    cursor.execute("SELECT * FROM items WHERE id = ? AND _deleted = 0", (item_id,))
    item = cursor.fetchone()
    list_id = item["list_id"] if item else None

    if item and not undo:
        cursor.execute(
            "INSERT INTO history (list_id, item_id, action, item_text) VALUES (?, ?, ?, ?)",
            (item["list_id"], item_id, "item_deleted", item["text"]),
        )

    cursor.execute(
        "UPDATE items SET _deleted = 1, updated_at = ? WHERE id = ?",
        (ts, item_id),
    )
    db.commit()

    if list_id:
        broadcast_update("items_changed", list_id)
    broadcast_sync("items")
    logger.info("Soft-deleted item id=%s", item_id)
    return {"success": True}
