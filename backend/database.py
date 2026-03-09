"""Database connection, initialization, and migration logic."""

import logging
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

DATABASE = "data/tickr.db"


def get_db():
    """Yield a database connection for dependency injection."""
    conn = sqlite3.connect(DATABASE, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
    finally:
        conn.close()


def now() -> str:
    """Return the current UTC timestamp as an ISO string."""
    return datetime.now().isoformat()


def new_uuid() -> str:
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
        _create_tables_fresh(conn)
    else:
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
        ts = now()
        list_id = new_uuid()
        cursor.execute(
            "INSERT INTO lists (id, name, icon, item_sort, sort_order, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (list_id, "Todos", "check", "alphabetical", 0, ts, ts),
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
    ts = now()

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
        new_id = new_uuid()
        list_id_map[old_id] = new_id
        created_at = row[5] if row[5] else ts
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
                ts,
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
        new_id = new_uuid()
        item_id_map[old_id] = new_id
        new_list_id = list_id_map.get(row[1])
        if not new_list_id:
            continue
        created_at = row[4] if row[4] else ts
        cursor.execute(
            "INSERT INTO items_new "
            "(id, list_id, text, completed, created_at, updated_at, completed_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (new_id, new_list_id, row[2], row[3] or 0, created_at, ts, row[5]),
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
