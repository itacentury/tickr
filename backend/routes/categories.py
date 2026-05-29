"""Category CRUD endpoints scoped per list."""

import sqlite3

from fastapi import APIRouter, BackgroundTasks, Depends

from ..database import get_db, new_uuid, now
from ..errors import AppError, ErrorCode
from ..events import broadcast_sync, broadcast_update
from ..logging_config import get_logger
from ..models import CategoryCreate, CategoryResponse, CategoryUpdate, SuccessResponse

logger = get_logger(__name__)

router = APIRouter(prefix="/api/v1")


@router.get("/lists/{list_id}/categories", response_model=list[CategoryResponse])
def get_categories(list_id: str, db: sqlite3.Connection = Depends(get_db)) -> list[dict]:
    """Return all non-deleted categories for a list."""
    cursor: sqlite3.Cursor = db.cursor()

    cursor.execute("SELECT id FROM lists WHERE id = ? AND _deleted = 0", (list_id,))
    if cursor.fetchone() is None:
        raise AppError(ErrorCode.LIST_NOT_FOUND, "List not found", 404)

    cursor.execute(
        "SELECT * FROM categories WHERE list_id = ? AND _deleted = 0 "
        "ORDER BY name COLLATE NOCASE ASC",
        (list_id,),
    )
    return [dict(row) for row in cursor.fetchall()]


@router.post("/lists/{list_id}/categories", response_model=CategoryResponse)
def create_category(
    list_id: str,
    data: CategoryCreate,
    bg: BackgroundTasks,
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Create a new category in a list."""
    cursor: sqlite3.Cursor = db.cursor()

    cursor.execute("SELECT id FROM lists WHERE id = ? AND _deleted = 0", (list_id,))
    if cursor.fetchone() is None:
        raise AppError(ErrorCode.LIST_NOT_FOUND, "List not found", 404)

    timestamp: str = now()
    category_id: str = new_uuid()

    cursor.execute(
        "INSERT INTO categories (id, list_id, name, color, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (category_id, list_id, data.name, data.color, timestamp, timestamp),
    )
    db.commit()

    bg.add_task(broadcast_update, "categories_changed", list_id)
    bg.add_task(broadcast_sync, "categories")
    logger.info("category_created", category_id=category_id, list_id=list_id, name=data.name[:50])
    return {
        "id": category_id,
        "list_id": list_id,
        "name": data.name,
        "color": data.color,
        "created_at": timestamp,
        "updated_at": timestamp,
    }


@router.put("/categories/{category_id}", response_model=SuccessResponse)
def update_category(
    category_id: str,
    data: CategoryUpdate,
    bg: BackgroundTasks,
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Update a category's name and/or color."""
    cursor: sqlite3.Cursor = db.cursor()

    cursor.execute("SELECT list_id FROM categories WHERE id = ? AND _deleted = 0", (category_id,))
    row: sqlite3.Row | None = cursor.fetchone()
    if row is None:
        raise AppError(ErrorCode.CATEGORY_NOT_FOUND, "Category not found", 404)

    updates: list[str] = ["updated_at = ?"]
    values: list[str] = [now()]
    if data.name is not None:
        updates.append("name = ?")
        values.append(data.name)
    if data.color is not None:
        updates.append("color = ?")
        values.append(data.color)

    values.append(category_id)
    cursor.execute(f"UPDATE categories SET {', '.join(updates)} WHERE id = ?", values)
    db.commit()

    bg.add_task(broadcast_update, "categories_changed", row["list_id"])
    bg.add_task(broadcast_sync, "categories")
    logger.info("category_updated", category_id=category_id)
    return {"success": True}


@router.delete("/categories/{category_id}", response_model=SuccessResponse)
def delete_category(
    category_id: str,
    bg: BackgroundTasks,
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Soft-delete a category and clear it from all assigned items atomically."""
    cursor: sqlite3.Cursor = db.cursor()
    timestamp: str = now()

    cursor.execute("SELECT list_id FROM categories WHERE id = ? AND _deleted = 0", (category_id,))
    row: sqlite3.Row | None = cursor.fetchone()
    if row is None:
        raise AppError(ErrorCode.CATEGORY_NOT_FOUND, "Category not found", 404)

    list_id: str = row["list_id"]

    with db:
        cursor.execute(
            "UPDATE items SET category_id = NULL, updated_at = ? "
            "WHERE category_id = ? AND _deleted = 0",
            (timestamp, category_id),
        )
        cursor.execute(
            "UPDATE categories SET _deleted = 1, updated_at = ? WHERE id = ?",
            (timestamp, category_id),
        )

    bg.add_task(broadcast_update, "categories_changed", list_id)
    bg.add_task(broadcast_update, "items_changed", list_id)
    bg.add_task(broadcast_sync, "categories")
    bg.add_task(broadcast_sync, "items")
    logger.info("category_deleted", category_id=category_id)
    return {"success": True}
