"""
Tickr Backend - FastAPI REST API with SQLite persistence.

Provides endpoints for managing todo lists, items, and history tracking.
"""

import sqlite3
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Initialize database on startup."""
    init_db()
    yield


app = FastAPI(title="Tickr", version="1.0.0", lifespan=lifespan)

# Database setup
DATABASE = "data/tickr.db"


def get_db():
    """Yield a database connection for dependency injection."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def init_db():
    """Create database tables and insert default data if empty."""
    Path(DATABASE).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()

    # Lists table
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS lists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            icon TEXT DEFAULT 'list',
            item_sort TEXT DEFAULT 'alphabetical',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """
    )

    # Migration: Add item_sort column if it doesn't exist (for existing databases)
    cursor.execute("PRAGMA table_info(lists)")
    columns = [row[1] for row in cursor.fetchall()]
    if "item_sort" not in columns:
        cursor.execute("ALTER TABLE lists ADD COLUMN item_sort TEXT DEFAULT 'alphabetical'")

    # Items table
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            list_id INTEGER NOT NULL,
            text TEXT NOT NULL,
            completed BOOLEAN DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP,
            FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE
        )
    """
    )

    # History table for tracking changes
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            list_id INTEGER NOT NULL,
            item_id INTEGER,
            action TEXT NOT NULL,
            item_text TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE
        )
    """
    )

    # Insert default list if empty
    cursor.execute("SELECT COUNT(*) FROM lists")
    if cursor.fetchone()[0] == 0:
        cursor.execute("INSERT INTO lists (name, icon) VALUES (?, ?)", ("Todos", "check"))

    conn.commit()
    conn.close()


# Pydantic models
class ListCreate(BaseModel):
    """Request model for creating a new list."""

    name: str
    icon: str = "list"


class ListUpdate(BaseModel):
    """Request model for updating an existing list."""

    name: str | None = None
    icon: str | None = None
    item_sort: str | None = None


class ItemCreate(BaseModel):
    """Request model for creating a new item."""

    text: str


class ItemUpdate(BaseModel):
    """Request model for updating an existing item."""

    text: str | None = None
    completed: bool | None = None


# Valid sort options for items
VALID_SORT_OPTIONS = ["alphabetical", "alphabetical_desc", "created_desc", "created_asc"]


# API Routes


# Lists
@app.get("/api/lists")
def get_lists(db: sqlite3.Connection = Depends(get_db)):
    """Return all lists with item counts."""
    cursor = db.cursor()
    cursor.execute(
        """
        SELECT l.*,
               COUNT(i.id) as total_items,
               SUM(CASE WHEN i.completed = 1 THEN 1 ELSE 0 END) as completed_items
        FROM lists l
        LEFT JOIN items i ON l.id = i.list_id
        GROUP BY l.id
        ORDER BY l.created_at
    """
    )
    rows = cursor.fetchall()
    return [dict(row) for row in rows]


@app.post("/api/lists")
def create_list(list_data: ListCreate, db: sqlite3.Connection = Depends(get_db)):
    """Create a new list and log to history."""
    cursor = db.cursor()
    cursor.execute("INSERT INTO lists (name, icon) VALUES (?, ?)", (list_data.name, list_data.icon))
    db.commit()
    list_id = cursor.lastrowid

    # Log to history
    cursor.execute(
        "INSERT INTO history (list_id, action, item_text) VALUES (?, ?, ?)",
        (list_id, "list_created", list_data.name),
    )
    db.commit()

    return {"id": list_id, "name": list_data.name, "icon": list_data.icon}


@app.put("/api/lists/{list_id}")
def update_list(list_id: int, list_data: ListUpdate, db: sqlite3.Connection = Depends(get_db)):
    """Update list name, icon, and/or sorting preference."""
    cursor = db.cursor()

    # Validate item_sort if provided
    if list_data.item_sort is not None and list_data.item_sort not in VALID_SORT_OPTIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid sort option. Valid options: {', '.join(VALID_SORT_OPTIONS)}",
        )

    updates: list[str] = []
    values: list[str | int] = []
    if list_data.name is not None:
        updates.append("name = ?")
        values.append(list_data.name)
    if list_data.icon is not None:
        updates.append("icon = ?")
        values.append(list_data.icon)
    if list_data.item_sort is not None:
        updates.append("item_sort = ?")
        values.append(list_data.item_sort)

    if updates:
        values.append(list_id)
        cursor.execute(f"UPDATE lists SET {', '.join(updates)} WHERE id = ?", values)
        db.commit()

    return {"success": True}


@app.delete("/api/lists/{list_id}")
def delete_list(list_id: int, db: sqlite3.Connection = Depends(get_db)):
    """Delete a list and its associated history."""
    cursor = db.cursor()
    cursor.execute("DELETE FROM lists WHERE id = ?", (list_id,))
    cursor.execute("DELETE FROM history WHERE list_id = ?", (list_id,))
    db.commit()
    return {"success": True}


# Sort option to SQL ORDER BY mapping
SORT_SQL = {
    "alphabetical": "text COLLATE NOCASE ASC",
    "alphabetical_desc": "text COLLATE NOCASE DESC",
    "created_desc": "created_at DESC",
    "created_asc": "created_at ASC",
}


# Items
@app.get("/api/lists/{list_id}/items")
def get_items(
    list_id: int, include_completed: bool = False, db: sqlite3.Connection = Depends(get_db)
):
    """Return items for a list, sorted according to list settings."""
    cursor = db.cursor()

    # Get sort preference from the list
    cursor.execute("SELECT item_sort FROM lists WHERE id = ?", (list_id,))
    row = cursor.fetchone()
    sort_option = row["item_sort"] if row and row["item_sort"] else "alphabetical"
    order_by = SORT_SQL.get(sort_option, SORT_SQL["alphabetical"])

    if include_completed:
        cursor.execute(
            f"SELECT * FROM items WHERE list_id = ? ORDER BY completed, {order_by}", (list_id,)
        )
    else:
        cursor.execute(
            f"SELECT * FROM items WHERE list_id = ? AND completed = 0 ORDER BY {order_by}",
            (list_id,),
        )
    rows = cursor.fetchall()
    return [dict(row) for row in rows]


@app.post("/api/lists/{list_id}/items")
def create_item(list_id: int, item_data: ItemCreate, db: sqlite3.Connection = Depends(get_db)):
    """Create a new item in a list and log to history."""
    cursor = db.cursor()
    cursor.execute("INSERT INTO items (list_id, text) VALUES (?, ?)", (list_id, item_data.text))
    db.commit()
    item_id = cursor.lastrowid

    # Log to history
    cursor.execute(
        "INSERT INTO history (list_id, item_id, action, item_text) VALUES (?, ?, ?, ?)",
        (list_id, item_id, "item_created", item_data.text),
    )
    db.commit()

    return {"id": item_id, "list_id": list_id, "text": item_data.text, "completed": False}


@app.put("/api/items/{item_id}")
def update_item(item_id: int, item_data: ItemUpdate, db: sqlite3.Connection = Depends(get_db)):
    """Update item text and/or completion status with history logging."""
    cursor = db.cursor()

    # Get current item data
    cursor.execute("SELECT * FROM items WHERE id = ?", (item_id,))
    item = cursor.fetchone()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    updates: list[str] = []
    values: list[str | int | bool] = []

    if item_data.text is not None and item_data.text != item["text"]:
        updates.append("text = ?")
        values.append(item_data.text)

        # Log text edit to history
        cursor.execute(
            "INSERT INTO history (list_id, item_id, action, item_text) VALUES (?, ?, ?, ?)",
            (item["list_id"], item_id, "item_edited", f"{item['text']} → {item_data.text}"),
        )

    if item_data.completed is not None:
        updates.append("completed = ?")
        values.append(item_data.completed)
        if item_data.completed:
            updates.append("completed_at = ?")
            values.append(datetime.now().isoformat())

            # Log completion to history
            cursor.execute(
                "INSERT INTO history (list_id, item_id, action, item_text) VALUES (?, ?, ?, ?)",
                (item["list_id"], item_id, "item_completed", item_data.text or item["text"]),
            )
        else:
            updates.append("completed_at = NULL")

            # Log uncomplete to history
            cursor.execute(
                "INSERT INTO history (list_id, item_id, action, item_text) VALUES (?, ?, ?, ?)",
                (item["list_id"], item_id, "item_uncompleted", item_data.text or item["text"]),
            )

    if updates:
        values.append(item_id)
        cursor.execute(f"UPDATE items SET {', '.join(updates)} WHERE id = ?", values)
        db.commit()

    return {"success": True}


@app.delete("/api/items/{item_id}")
def delete_item(item_id: int, db: sqlite3.Connection = Depends(get_db)):
    """Delete an item and log to history."""
    cursor = db.cursor()

    # Get item data for history
    cursor.execute("SELECT * FROM items WHERE id = ?", (item_id,))
    item = cursor.fetchone()
    if item:
        # Log deletion to history
        cursor.execute(
            "INSERT INTO history (list_id, item_id, action, item_text) VALUES (?, ?, ?, ?)",
            (item["list_id"], item_id, "item_deleted", item["text"]),
        )

    cursor.execute("DELETE FROM items WHERE id = ?", (item_id,))
    db.commit()
    return {"success": True}


# History
@app.get("/api/lists/{list_id}/history")
def get_history(list_id: int, db: sqlite3.Connection = Depends(get_db)):
    """Return the last 100 history entries for a list."""
    cursor = db.cursor()
    # Get history entries with current item status
    cursor.execute(
        """
        SELECT h.*, i.completed as item_current_completed, i.text as item_current_text
        FROM history h
        LEFT JOIN items i ON h.item_id = i.id
        WHERE h.list_id = ?
        ORDER BY h.timestamp DESC
        LIMIT 100
    """,
        (list_id,),
    )
    rows = cursor.fetchall()
    return [dict(row) for row in rows]


# Serve static files
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def read_root():
    """Serve the main HTML page."""
    return FileResponse("templates/index.html")


@app.get("/manifest.json")
def manifest():
    """Serve the PWA manifest file."""
    return FileResponse("static/manifest.json")


@app.get("/sw.js")
def service_worker():
    """Serve the service worker script."""
    return FileResponse("static/sw.js", media_type="application/javascript")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
