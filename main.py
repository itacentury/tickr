"""
Todo App Backend - FastAPI + SQLite
"""

import sqlite3
from datetime import datetime
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

app = FastAPI(title="Todo App", version="1.0.0")

# Database setup
DATABASE = "todo.db"


def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def init_db():
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()

    # Lists table
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS lists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            icon TEXT DEFAULT 'list',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """
    )

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
    name: str
    icon: str = "list"


class ListUpdate(BaseModel):
    name: Optional[str] = None
    icon: Optional[str] = None


class ItemCreate(BaseModel):
    text: str


class ItemUpdate(BaseModel):
    text: Optional[str] = None
    completed: Optional[bool] = None


# API Routes


# Lists
@app.get("/api/lists")
def get_lists(db: sqlite3.Connection = Depends(get_db)):
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
    cursor = db.cursor()

    updates = []
    values = []
    if list_data.name is not None:
        updates.append("name = ?")
        values.append(list_data.name)
    if list_data.icon is not None:
        updates.append("icon = ?")
        values.append(list_data.icon)

    if updates:
        values.append(list_id)
        cursor.execute(f"UPDATE lists SET {', '.join(updates)} WHERE id = ?", values)
        db.commit()

    return {"success": True}


@app.delete("/api/lists/{list_id}")
def delete_list(list_id: int, db: sqlite3.Connection = Depends(get_db)):
    cursor = db.cursor()
    cursor.execute("DELETE FROM lists WHERE id = ?", (list_id,))
    cursor.execute("DELETE FROM history WHERE list_id = ?", (list_id,))
    db.commit()
    return {"success": True}


# Items
@app.get("/api/lists/{list_id}/items")
def get_items(
    list_id: int, include_completed: bool = False, db: sqlite3.Connection = Depends(get_db)
):
    cursor = db.cursor()
    if include_completed:
        cursor.execute(
            "SELECT * FROM items WHERE list_id = ? ORDER BY completed, created_at DESC", (list_id,)
        )
    else:
        cursor.execute(
            "SELECT * FROM items WHERE list_id = ? AND completed = 0 ORDER BY created_at DESC",
            (list_id,),
        )
    rows = cursor.fetchall()
    return [dict(row) for row in rows]


@app.post("/api/lists/{list_id}/items")
def create_item(list_id: int, item_data: ItemCreate, db: sqlite3.Connection = Depends(get_db)):
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
    cursor = db.cursor()

    # Get current item data
    cursor.execute("SELECT * FROM items WHERE id = ?", (item_id,))
    item = cursor.fetchone()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    updates = []
    values = []

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
    return FileResponse("templates/index.html")


@app.get("/manifest.json")
def manifest():
    return FileResponse("static/manifest.json")


@app.get("/sw.js")
def service_worker():
    return FileResponse("static/sw.js", media_type="application/javascript")


# Initialize database on startup
@app.on_event("startup")
def startup():
    init_db()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
