"""
Tickr Backend - FastAPI REST API with SQLite persistence.

Provides endpoints for managing todo lists, items, history tracking,
and RxDB-compatible sync endpoints for offline-first replication.
"""

import asyncio
import json
import logging
import sqlite3
import time
import uuid
from collections import defaultdict
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from queue import Empty, Full, Queue
from threading import Lock

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Initialize database on startup."""
    logger.info("Starting Tickr application")
    init_db()
    logger.info("Application startup complete")
    yield
    logger.info("Shutting down Tickr application")


app = FastAPI(title="Tickr", version="2.0.0", lifespan=lifespan)

# Rate limiting configuration
RATE_LIMIT_REQUESTS = 100
RATE_LIMIT_WINDOW = 60  # seconds
rate_limit_store: dict[str, list[float]] = defaultdict(list)
rate_limit_lock = Lock()

# Maximum concurrent SSE connections
MAX_SSE_CLIENTS = 10


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next) -> Response:
    """Attach security headers to every response."""
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; "
        "font-src 'self' https://fonts.gstatic.com; "
        "img-src 'self' data:; "
        "connect-src 'self'"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    return response


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next) -> Response:
    """Enforce per-IP sliding window rate limiting, excluding SSE."""
    if request.url.path in ("/api/events", "/api/sync/stream"):
        return await call_next(request)

    client_ip = request.client.host if request.client else "unknown"
    now = time.time()

    with rate_limit_lock:
        # Prune expired timestamps
        timestamps = rate_limit_store[client_ip]
        cutoff = now - RATE_LIMIT_WINDOW
        rate_limit_store[client_ip] = [t for t in timestamps if t > cutoff]
        timestamps = rate_limit_store[client_ip]

        if len(timestamps) >= RATE_LIMIT_REQUESTS:
            retry_after = int(timestamps[0] - cutoff) + 1
            logger.warning("Rate limit exceeded for %s (retry after %ds)", client_ip, retry_after)
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests"},
                headers={"Retry-After": str(retry_after)},
            )

        timestamps.append(now)

    return await call_next(request)


# Database setup
DATABASE = "data/tickr.db"

# SSE client management (thread-safe)
clients_lock = Lock()
connected_clients: list[Queue] = []

# Sync SSE clients for RxDB replication
sync_clients_lock = Lock()
sync_connected_clients: list[Queue] = []


def broadcast_update(event_type: str, list_id: str | None = None) -> None:
    """Notify all connected SSE clients of a data change."""
    message = json.dumps({"type": event_type, "list_id": list_id})
    with clients_lock:
        client_count = len(connected_clients)
        for queue in connected_clients:
            try:
                queue.put_nowait(message)
            except Full:
                logger.warning("SSE client queue full, dropping message")
    logger.debug("Broadcast '%s' (list_id=%s) to %d client(s)", event_type, list_id, client_count)


def broadcast_sync(collection: str) -> None:
    """Notify all sync SSE clients that a collection has changed."""
    message = json.dumps({"collection": collection})
    with sync_clients_lock:
        for queue in sync_connected_clients:
            try:
                queue.put_nowait(message)
            except Full:
                logger.warning("Sync SSE client queue full, dropping message")


def get_db():
    """Yield a database connection for dependency injection."""
    conn = sqlite3.connect(DATABASE, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
    finally:
        conn.close()


def _now() -> str:
    """Return the current UTC timestamp as an ISO string."""
    return datetime.now().isoformat()


def _uuid() -> str:
    """Generate a new UUID v4 string."""
    return str(uuid.uuid4())


def init_db():
    """Create database tables and run migrations for UUID primary keys."""
    logger.info("Initializing database at %s", DATABASE)
    Path(DATABASE).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()

    # Check if migration from INTEGER to TEXT PKs is needed
    cursor.execute("PRAGMA table_info(lists)")
    list_cols = {row[1]: row[2] for row in cursor.fetchall()}

    needs_uuid_migration = list_cols.get("id") == "INTEGER"

    if needs_uuid_migration and list_cols:
        logger.info("Migrating database: INTEGER PKs -> UUID TEXT PKs")
        _migrate_to_uuid(conn)
    elif not list_cols:
        # Fresh database - create tables directly with UUID schema
        _create_tables_fresh(conn)
    else:
        # Already migrated, check for missing columns
        _ensure_columns(conn)

    # Settings table
    cursor.execute("PRAGMA table_info(settings)")
    settings_columns = [row[1] for row in cursor.fetchall()]
    if settings_columns and "key" not in settings_columns:
        logger.info("Migrating database: recreating settings table with new schema")
        cursor.execute("DROP TABLE settings")

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    """)
    cursor.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
        ("list_sort", "alphabetical"),
    )

    # Insert default list if empty
    cursor.execute("SELECT COUNT(*) FROM lists WHERE _deleted = 0")
    if cursor.fetchone()[0] == 0:
        logger.info("Empty database detected, inserting default list")
        now = _now()
        list_id = _uuid()
        cursor.execute(
            "INSERT INTO lists (id, name, icon, item_sort, sort_order, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (list_id, "Todos", "check", "alphabetical", 0, now, now),
        )

    conn.commit()
    conn.close()
    logger.info("Database initialization complete")


def _create_tables_fresh(conn: sqlite3.Connection) -> None:
    """Create all tables with UUID TEXT primary keys from scratch."""
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS lists (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            icon TEXT DEFAULT 'list',
            item_sort TEXT DEFAULT 'alphabetical',
            sort_order INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            _deleted INTEGER DEFAULT 0
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS items (
            id TEXT PRIMARY KEY,
            list_id TEXT NOT NULL,
            text TEXT NOT NULL,
            completed INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            completed_at TEXT,
            _deleted INTEGER DEFAULT 0,
            FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            list_id TEXT NOT NULL,
            item_id TEXT,
            action TEXT NOT NULL,
            item_text TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE
        )
    """)

    conn.commit()


def _migrate_to_uuid(conn: sqlite3.Connection) -> None:
    """Migrate existing INTEGER PK tables to TEXT UUID primary keys."""
    cursor = conn.cursor()
    now = _now()

    # Build ID mapping for lists
    cursor.execute("SELECT id, name, icon, item_sort, sort_order, created_at FROM lists")
    old_lists = cursor.fetchall()
    list_id_map: dict[int, str] = {}

    cursor.execute("DROP TABLE IF EXISTS lists_new")
    cursor.execute("""
        CREATE TABLE lists_new (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            icon TEXT DEFAULT 'list',
            item_sort TEXT DEFAULT 'alphabetical',
            sort_order INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            _deleted INTEGER DEFAULT 0
        )
    """)

    for row in old_lists:
        old_id = row[0]
        new_id = _uuid()
        list_id_map[old_id] = new_id
        created_at = row[5] if row[5] else now
        cursor.execute(
            "INSERT INTO lists_new (id, name, icon, item_sort, sort_order, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                new_id,
                row[1],
                row[2] or "list",
                row[3] or "alphabetical",
                row[4] or 0,
                created_at,
                now,
            ),
        )

    # Build ID mapping for items
    cursor.execute("SELECT id, list_id, text, completed, created_at, completed_at FROM items")
    old_items = cursor.fetchall()
    item_id_map: dict[int, str] = {}

    cursor.execute("DROP TABLE IF EXISTS items_new")
    cursor.execute("""
        CREATE TABLE items_new (
            id TEXT PRIMARY KEY,
            list_id TEXT NOT NULL,
            text TEXT NOT NULL,
            completed INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            completed_at TEXT,
            _deleted INTEGER DEFAULT 0,
            FOREIGN KEY (list_id) REFERENCES lists_new(id) ON DELETE CASCADE
        )
    """)

    for row in old_items:
        old_id = row[0]
        new_id = _uuid()
        item_id_map[old_id] = new_id
        new_list_id = list_id_map.get(row[1])
        if not new_list_id:
            continue  # Skip orphaned items
        created_at = row[4] if row[4] else now
        cursor.execute(
            "INSERT INTO items_new "
            "(id, list_id, text, completed, created_at, updated_at, completed_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (new_id, new_list_id, row[2], row[3] or 0, created_at, now, row[5]),
        )

    # Migrate history
    cursor.execute("SELECT id, list_id, item_id, action, item_text, timestamp FROM history")
    old_history = cursor.fetchall()

    cursor.execute("DROP TABLE IF EXISTS history_new")
    cursor.execute("""
        CREATE TABLE history_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            list_id TEXT NOT NULL,
            item_id TEXT,
            action TEXT NOT NULL,
            item_text TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (list_id) REFERENCES lists_new(id) ON DELETE CASCADE
        )
    """)

    for row in old_history:
        new_list_id = list_id_map.get(row[1])
        if not new_list_id:
            continue
        new_item_id = item_id_map.get(row[2]) if row[2] else None
        cursor.execute(
            "INSERT INTO history_new (list_id, item_id, action, item_text, timestamp) "
            "VALUES (?, ?, ?, ?, ?)",
            (new_list_id, new_item_id, row[3], row[4], row[5]),
        )

    # Swap tables
    cursor.execute("DROP TABLE history")
    cursor.execute("DROP TABLE items")
    cursor.execute("DROP TABLE lists")
    cursor.execute("ALTER TABLE lists_new RENAME TO lists")
    cursor.execute("ALTER TABLE items_new RENAME TO items")
    cursor.execute("ALTER TABLE history_new RENAME TO history")

    conn.commit()
    logger.info(
        "Migration complete: %d lists, %d items, %d history entries",
        len(list_id_map),
        len(item_id_map),
        len(old_history),
    )


def _ensure_columns(conn: sqlite3.Connection) -> None:
    """Add any missing columns to existing UUID-based tables."""
    cursor = conn.cursor()

    cursor.execute("PRAGMA table_info(lists)")
    list_cols = [row[1] for row in cursor.fetchall()]
    if "updated_at" not in list_cols:
        cursor.execute("ALTER TABLE lists ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''")
    if "_deleted" not in list_cols:
        cursor.execute("ALTER TABLE lists ADD COLUMN _deleted INTEGER DEFAULT 0")
    if "item_sort" not in list_cols:
        cursor.execute("ALTER TABLE lists ADD COLUMN item_sort TEXT DEFAULT 'alphabetical'")
    if "sort_order" not in list_cols:
        cursor.execute("ALTER TABLE lists ADD COLUMN sort_order INTEGER DEFAULT 0")

    cursor.execute("PRAGMA table_info(items)")
    item_cols = [row[1] for row in cursor.fetchall()]
    if "updated_at" not in item_cols:
        cursor.execute("ALTER TABLE items ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''")
    if "_deleted" not in item_cols:
        cursor.execute("ALTER TABLE items ADD COLUMN _deleted INTEGER DEFAULT 0")

    conn.commit()


# Pydantic models
class ListCreate(BaseModel):
    """Request model for creating a new list."""

    name: str = Field(..., max_length=200)
    icon: str = Field("list", max_length=50)
    undo: bool = False


class ListUpdate(BaseModel):
    """Request model for updating an existing list."""

    name: str | None = Field(None, max_length=200)
    icon: str | None = Field(None, max_length=50)
    item_sort: str | None = None


class ItemCreate(BaseModel):
    """Request model for creating a new item."""

    text: str = Field(..., max_length=1000)
    undo: bool = False


class ItemUpdate(BaseModel):
    """Request model for updating an existing item."""

    text: str | None = Field(None, max_length=1000)
    completed: bool | None = None
    undo: bool = False


class SettingsUpdate(BaseModel):
    """Request model for updating app settings."""

    list_sort: str | None = None


class ListReorder(BaseModel):
    """Request model for reordering lists."""

    list_ids: list[str]


class HistoryEntry(BaseModel):
    """Request model for a single history entry during restore."""

    action: str = Field(..., max_length=50)
    item_text: str | None = Field(None, max_length=1000)
    timestamp: str | None = Field(None, max_length=30)


# Valid sort options for items
VALID_SORT_OPTIONS = ["alphabetical", "alphabetical_desc", "created_desc", "created_asc"]

# Valid sort options for lists
VALID_LIST_SORT_OPTIONS = [
    "alphabetical",
    "alphabetical_desc",
    "created_desc",
    "created_asc",
    "custom",
]


# ---- CRUD API Routes ----


# Lists
@app.get("/api/lists")
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


@app.post("/api/lists")
def create_list(list_data: ListCreate, db: sqlite3.Connection = Depends(get_db)):
    """Create a new list and log to history."""
    cursor = db.cursor()
    now = _now()
    list_id = _uuid()

    cursor.execute("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM lists WHERE _deleted = 0")
    next_sort_order = cursor.fetchone()[0]

    cursor.execute(
        "INSERT INTO lists (id, name, icon, sort_order, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (list_id, list_data.name, list_data.icon, next_sort_order, now, now),
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


@app.put("/api/lists/{list_id}")
def update_list(list_id: str, list_data: ListUpdate, db: sqlite3.Connection = Depends(get_db)):
    """Update list name, icon, and/or sorting preference."""
    cursor = db.cursor()

    if list_data.item_sort is not None and list_data.item_sort not in VALID_SORT_OPTIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid sort option. Valid options: {', '.join(VALID_SORT_OPTIONS)}",
        )

    updates: list[str] = ["updated_at = ?"]
    values: list[str | int] = [_now()]
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


@app.delete("/api/lists/{list_id}")
def delete_list(list_id: str, db: sqlite3.Connection = Depends(get_db)):
    """Soft-delete a list and its items."""
    cursor = db.cursor()
    now = _now()

    # Soft-delete items
    cursor.execute(
        "UPDATE items SET _deleted = 1, updated_at = ? WHERE list_id = ? AND _deleted = 0",
        (now, list_id),
    )
    # Soft-delete list
    cursor.execute(
        "UPDATE lists SET _deleted = 1, updated_at = ? WHERE id = ?",
        (now, list_id),
    )
    # Hard-delete history (not synced)
    cursor.execute("DELETE FROM history WHERE list_id = ?", (list_id,))

    db.commit()
    broadcast_update("lists_changed")
    broadcast_sync("lists")
    broadcast_sync("items")
    logger.info("Soft-deleted list id=%s", list_id)
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


@app.post("/api/lists/{list_id}/items")
def create_item(list_id: str, item_data: ItemCreate, db: sqlite3.Connection = Depends(get_db)):
    """Create a new item in a list and log to history."""
    cursor = db.cursor()
    now = _now()
    item_id = _uuid()

    cursor.execute(
        "INSERT INTO items (id, list_id, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        (item_id, list_id, item_data.text, now, now),
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


@app.put("/api/items/{item_id}")
def update_item(item_id: str, item_data: ItemUpdate, db: sqlite3.Connection = Depends(get_db)):
    """Update item text and/or completion status with history logging."""
    cursor = db.cursor()

    cursor.execute("SELECT * FROM items WHERE id = ? AND _deleted = 0", (item_id,))
    item = cursor.fetchone()
    if not item:
        logger.warning("Item id=%s not found for update", item_id)
        raise HTTPException(status_code=404, detail="Item not found")

    now = _now()
    updates: list[str] = ["updated_at = ?"]
    values: list[str | int | bool] = [now]

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
            values.append(now)

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


@app.delete("/api/items/{item_id}")
def delete_item(item_id: str, undo: bool = False, db: sqlite3.Connection = Depends(get_db)):
    """Soft-delete an item and log to history."""
    cursor = db.cursor()
    now = _now()

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
        (now, item_id),
    )
    db.commit()

    if list_id:
        broadcast_update("items_changed", list_id)
    broadcast_sync("items")
    logger.info("Soft-deleted item id=%s", item_id)
    return {"success": True}


# Settings
@app.get("/api/settings")
def get_settings(db: sqlite3.Connection = Depends(get_db)):
    """Return all app settings."""
    cursor = db.cursor()
    cursor.execute("SELECT key, value FROM settings")
    rows = cursor.fetchall()
    return {row["key"]: row["value"] for row in rows}


@app.put("/api/settings")
def update_settings(settings_data: SettingsUpdate, db: sqlite3.Connection = Depends(get_db)):
    """Update app settings."""
    cursor = db.cursor()

    if settings_data.list_sort is not None:
        if settings_data.list_sort not in VALID_LIST_SORT_OPTIONS:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid list sort option. Valid: {', '.join(VALID_LIST_SORT_OPTIONS)}",
            )
        cursor.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            ("list_sort", settings_data.list_sort),
        )

    db.commit()
    return {"success": True}


# List reordering
@app.post("/api/lists/reorder")
def reorder_lists(reorder_data: ListReorder, db: sqlite3.Connection = Depends(get_db)):
    """Update the sort order of lists based on provided order."""
    cursor = db.cursor()
    now = _now()

    for idx, list_id in enumerate(reorder_data.list_ids):
        cursor.execute(
            "UPDATE lists SET sort_order = ?, updated_at = ? WHERE id = ?",
            (idx, now, list_id),
        )

    db.commit()
    broadcast_update("lists_changed")
    broadcast_sync("lists")
    return {"success": True}


# History
@app.get("/api/lists/{list_id}/history")
def get_history(list_id: str, db: sqlite3.Connection = Depends(get_db)):
    """Return all history entries for a list."""
    cursor = db.cursor()
    cursor.execute(
        """
        SELECT * FROM history
        WHERE list_id = ? AND action NOT LIKE 'undo_%'
        ORDER BY timestamp DESC
    """,
        (list_id,),
    )
    rows = cursor.fetchall()
    return [dict(row) for row in rows]


@app.post("/api/lists/{list_id}/history")
def restore_history(
    list_id: str, entries: list[HistoryEntry], db: sqlite3.Connection = Depends(get_db)
):
    """Bulk-insert validated history entries for a restored list."""
    cursor = db.cursor()
    for entry in entries:
        cursor.execute(
            "INSERT INTO history (list_id, action, item_text, timestamp) VALUES (?, ?, ?, ?)",
            (list_id, entry.action, entry.item_text, entry.timestamp),
        )
    db.commit()
    return {"success": True}


# ---- RxDB Sync Endpoints ----


@app.get("/api/sync/{collection}/pull")
def sync_pull(
    collection: str,
    updated_at: str | None = None,
    id: str | None = None,
    limit: int = 100,
    db: sqlite3.Connection = Depends(get_db),
):
    """Pull documents newer than the given checkpoint for RxDB replication."""
    if collection not in ("lists", "items"):
        raise HTTPException(status_code=400, detail="Invalid collection")

    cursor = db.cursor()

    if updated_at and id:
        # Fetch documents past the checkpoint
        cursor.execute(
            f"SELECT * FROM {collection} "
            f"WHERE (updated_at > ?) OR (updated_at = ? AND id > ?) "
            f"ORDER BY updated_at ASC, id ASC LIMIT ?",
            (updated_at, updated_at, id, limit),
        )
    else:
        # Initial pull - get all documents
        cursor.execute(
            f"SELECT * FROM {collection} ORDER BY updated_at ASC, id ASC LIMIT ?",
            (limit,),
        )

    rows = cursor.fetchall()
    documents = [dict(row) for row in rows]

    checkpoint = None
    if documents:
        last = documents[-1]
        checkpoint = {"updatedAt": last["updated_at"], "id": last["id"]}

    return {"documents": documents, "checkpoint": checkpoint}


@app.post("/api/sync/{collection}/push")
def sync_push(
    collection: str,
    changes: list[dict],
    db: sqlite3.Connection = Depends(get_db),
):
    """Push local changes to the server for RxDB replication.

    Each change contains newDocumentState and optionally assumedMasterState.
    Returns an array of conflicts (empty means success).
    """
    if collection not in ("lists", "items"):
        raise HTTPException(status_code=400, detail="Invalid collection")

    cursor = db.cursor()
    conflicts: list[dict] = []

    for change in changes:
        new_state = change["newDocumentState"]
        assumed = change.get("assumedMasterState")
        doc_id = new_state["id"]

        # Fetch current server state
        cursor.execute(f"SELECT * FROM {collection} WHERE id = ?", (doc_id,))
        current = cursor.fetchone()
        current_dict = dict(current) if current else None

        if assumed is None:
            # New document - insert
            if current_dict:
                # Already exists - conflict
                conflicts.append(current_dict)
                continue
            _insert_doc(cursor, collection, new_state)
        else:
            # Update - verify assumed state matches current
            if not current_dict:
                # Document doesn't exist on server
                _insert_doc(cursor, collection, new_state)
            elif _states_match(current_dict, assumed):
                # Assumed state matches - apply update
                _update_doc(cursor, collection, new_state)
            else:
                # Conflict - return current server state
                conflicts.append(current_dict)
                continue

    db.commit()

    if not conflicts:
        broadcast_update("lists_changed" if collection == "lists" else "items_changed")
        broadcast_sync(collection)

    return conflicts


def _insert_doc(cursor: sqlite3.Cursor, collection: str, doc: dict) -> None:
    """Insert a new document into the specified collection."""
    if collection == "lists":
        cursor.execute(
            "INSERT INTO lists (id, name, icon, item_sort, sort_order, "
            "created_at, updated_at, _deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                doc["id"],
                doc.get("name", ""),
                doc.get("icon", "list"),
                doc.get("item_sort", "alphabetical"),
                doc.get("sort_order", 0),
                doc.get("created_at", _now()),
                doc.get("updated_at", _now()),
                doc.get("_deleted", 0),
            ),
        )
    elif collection == "items":
        cursor.execute(
            "INSERT INTO items (id, list_id, text, completed, created_at, "
            "updated_at, completed_at, _deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                doc["id"],
                doc.get("list_id", ""),
                doc.get("text", ""),
                doc.get("completed", 0),
                doc.get("created_at", _now()),
                doc.get("updated_at", _now()),
                doc.get("completed_at"),
                doc.get("_deleted", 0),
            ),
        )


def _update_doc(cursor: sqlite3.Cursor, collection: str, doc: dict) -> None:
    """Update an existing document in the specified collection."""
    if collection == "lists":
        cursor.execute(
            "UPDATE lists SET name=?, icon=?, item_sort=?, sort_order=?, "
            "updated_at=?, _deleted=? WHERE id=?",
            (
                doc.get("name", ""),
                doc.get("icon", "list"),
                doc.get("item_sort", "alphabetical"),
                doc.get("sort_order", 0),
                doc.get("updated_at", _now()),
                doc.get("_deleted", 0),
                doc["id"],
            ),
        )
    elif collection == "items":
        cursor.execute(
            "UPDATE items SET list_id=?, text=?, completed=?, "
            "updated_at=?, completed_at=?, _deleted=? WHERE id=?",
            (
                doc.get("list_id", ""),
                doc.get("text", ""),
                doc.get("completed", 0),
                doc.get("updated_at", _now()),
                doc.get("completed_at"),
                doc.get("_deleted", 0),
                doc["id"],
            ),
        )


def _states_match(current: dict, assumed: dict) -> bool:
    """Check if the current server state matches the client's assumption.

    Compares updated_at timestamps as a simple conflict detection mechanism.
    """
    return current.get("updated_at") == assumed.get("updated_at")


@app.get("/api/sync/stream")
async def sync_stream() -> StreamingResponse:
    """SSE stream that notifies clients when collections change."""
    with sync_clients_lock:
        if len(sync_connected_clients) >= MAX_SSE_CLIENTS:
            raise HTTPException(status_code=429, detail="Too many SSE connections")

    queue: Queue = Queue(maxsize=100)
    with sync_clients_lock:
        sync_connected_clients.append(queue)
        logger.info("Sync SSE client connected (%d active)", len(sync_connected_clients))

    async def event_generator():
        """Generate SSE events for sync stream."""
        heartbeat_interval = 15
        last_heartbeat = asyncio.get_event_loop().time()

        try:
            while True:
                current_time = asyncio.get_event_loop().time()

                if current_time - last_heartbeat >= heartbeat_interval:
                    yield ": heartbeat\n\n"
                    last_heartbeat = current_time

                try:
                    data = queue.get_nowait()
                    yield f"data: {data}\n\n"
                except Empty:
                    await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            pass
        finally:
            with sync_clients_lock:
                if queue in sync_connected_clients:
                    sync_connected_clients.remove(queue)
                logger.info("Sync SSE client disconnected (%d active)", len(sync_connected_clients))

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ---- Legacy SSE endpoint ----


@app.get("/api/events")
async def sse_events() -> StreamingResponse:
    """SSE endpoint for real-time updates to connected clients (legacy)."""
    with clients_lock:
        if len(connected_clients) >= MAX_SSE_CLIENTS:
            logger.warning("SSE connection rejected: max clients (%d) reached", MAX_SSE_CLIENTS)
            raise HTTPException(status_code=429, detail="Too many SSE connections")

    queue: Queue = Queue(maxsize=100)
    with clients_lock:
        connected_clients.append(queue)
        logger.info("SSE client connected (%d active)", len(connected_clients))

    async def event_generator():
        """Generate SSE events from the client's message queue."""
        heartbeat_interval = 15
        last_heartbeat = asyncio.get_event_loop().time()

        try:
            while True:
                current_time = asyncio.get_event_loop().time()

                if current_time - last_heartbeat >= heartbeat_interval:
                    yield ": heartbeat\n\n"
                    last_heartbeat = current_time

                try:
                    data = queue.get_nowait()
                    yield f"data: {data}\n\n"
                except Empty:
                    await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            pass
        finally:
            with clients_lock:
                if queue in connected_clients:
                    connected_clients.remove(queue)
                logger.info("SSE client disconnected (%d active)", len(connected_clients))

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ---- Static File Serving ----

# Serve Vite build output if it exists, otherwise fall back to legacy static
DIST_DIR = Path("static/dist")

if DIST_DIR.exists():
    app.mount("/assets", StaticFiles(directory=DIST_DIR / "assets"), name="assets")

# Legacy static files (icons, etc.)
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def read_root():
    """Serve the main HTML page from Vite build or legacy templates."""
    if (DIST_DIR / "index.html").exists():
        response = FileResponse(str(DIST_DIR / "index.html"))
    else:
        response = FileResponse("templates/index.html")
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@app.get("/manifest.json")
def manifest():
    """Serve the PWA manifest file."""
    if (DIST_DIR / "manifest.json").exists():
        response = FileResponse(str(DIST_DIR / "manifest.json"))
    else:
        response = FileResponse("static/manifest.json")
    response.headers["Cache-Control"] = "public, max-age=3600, must-revalidate"
    return response


@app.get("/sw.js")
def service_worker():
    """Serve the service worker script."""
    if (DIST_DIR / "sw.js").exists():
        response = FileResponse(str(DIST_DIR / "sw.js"), media_type="application/javascript")
    else:
        response = FileResponse("static/sw.js", media_type="application/javascript")
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@app.get("/icons/{file_path:path}")
def serve_icon(file_path: str):
    """Serve icon files from the Vite build output or legacy static directory."""
    dist_path = DIST_DIR / "icons" / file_path
    if dist_path.exists():
        return FileResponse(str(dist_path))
    legacy_path = Path("static/icons") / file_path
    if legacy_path.exists():
        return FileResponse(str(legacy_path))
    raise HTTPException(status_code=404, detail="Icon not found")


if __name__ == "__main__":
    import uvicorn

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    uvicorn.run(app, host="0.0.0.0", port=8000)
