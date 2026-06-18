"""Database connection, initialization, and migration logic."""

import sqlite3
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Final

from backend.config import DATABASE
from backend.logging_config import get_logger

logger = get_logger(__name__)


_SCHEMA_SQL: Final[str] = """
CREATE TABLE IF NOT EXISTS lists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT DEFAULT 'list',
    item_sort TEXT DEFAULT 'alphabetical',
    sort_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    _deleted INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL,
    text TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    category_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    _deleted INTEGER DEFAULT 0,
    FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    _deleted INTEGER DEFAULT 0,
    FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id TEXT NOT NULL,
    item_id TEXT,
    action TEXT NOT NULL,
    item_text TEXT,
    hidden INTEGER DEFAULT 0,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_list_id ON items(list_id, _deleted);
CREATE INDEX IF NOT EXISTS idx_items_updated ON items(updated_at, id);
CREATE INDEX IF NOT EXISTS idx_lists_updated ON lists(updated_at, id);
CREATE INDEX IF NOT EXISTS idx_categories_list_id ON categories(list_id, _deleted);
CREATE INDEX IF NOT EXISTS idx_categories_updated ON categories(updated_at, id);
CREATE INDEX IF NOT EXISTS idx_history_list_id ON history(list_id, hidden, timestamp);
"""


def get_db() -> Iterator[sqlite3.Connection]:
    """Yield a database connection for dependency injection."""
    conn: sqlite3.Connection = sqlite3.connect(DATABASE, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    try:
        yield conn
    finally:
        conn.close()


def now() -> str:
    """Return the current UTC timestamp as an ISO-8601 string with Z suffix."""
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def new_uuid() -> str:
    """Generate a new UUID v4 string."""
    return str(uuid.uuid4())


def log_history(
    cursor: sqlite3.Cursor,
    list_id: str | None,
    action: str,
    item_text: str | None,
    item_id: str | None = None,
) -> None:
    """Insert a single history entry; ``item_id`` is NULL for list-level actions."""
    cursor.execute(
        "INSERT INTO history (list_id, item_id, action, item_text) VALUES (?, ?, ?, ?)",
        (list_id, item_id, action, item_text),
    )


def init_db(conn: sqlite3.Connection | None = None) -> None:
    """Create database tables and run migrations for UUID primary keys.

    When ``conn`` is provided (e.g. from tests with an in-memory DB) the
    shared ``_SCHEMA_SQL`` is applied idempotently, the ``list_sort`` setting
    is seeded, and migration logic is skipped — we assume the caller wants a
    clean slate. When ``conn`` is ``None`` a file-backed connection is opened
    with WAL and the full migration path runs.
    """
    if conn is not None:
        conn.executescript(_SCHEMA_SQL)
        conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
            ("list_sort", "alphabetical"),
        )
        conn.commit()
        return

    logger.info("db_init_begin", database=DATABASE)
    Path(DATABASE).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DATABASE)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    logger.info("db_wal_enabled")
    cursor: sqlite3.Cursor = conn.cursor()

    # Check if migration from INTEGER to TEXT PKs is needed
    cursor.execute("PRAGMA table_info(lists)")
    list_cols: dict[str, str] = {row[1]: row[2] for row in cursor.fetchall()}

    needs_uuid_migration: bool = list_cols.get("id") == "INTEGER"

    if needs_uuid_migration and list_cols:
        logger.info("db_migration_begin", migration="integer_pk_to_uuid")
        _migrate_to_uuid(conn)
    elif not list_cols:
        _create_tables_fresh(conn)
    else:
        _ensure_columns(conn)

    _rename_legacy_history_actions(conn)
    _ensure_history_hidden_column(conn)
    _ensure_history_item_fk(conn)
    _ensure_indexes(conn)

    # Settings table
    cursor.execute("PRAGMA table_info(settings)")
    settings_columns: list[str] = [row[1] for row in cursor.fetchall()]
    if settings_columns and "key" not in settings_columns:
        logger.info("db_migration_begin", migration="settings_schema_recreate")
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
        logger.info("db_default_list_inserted")
        timestamp: str = now()
        list_id: str = new_uuid()
        cursor.execute(
            "INSERT INTO lists (id, name, icon, item_sort, sort_order, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (list_id, "Todos", "check", "alphabetical", 0, timestamp, timestamp),
        )

    conn.commit()
    conn.close()
    logger.info("db_init_complete")


def _create_tables_fresh(conn: sqlite3.Connection) -> None:
    """Create all tables and indexes with UUID TEXT primary keys from scratch."""
    conn.executescript(_SCHEMA_SQL)
    conn.commit()


def _migrate_to_uuid(conn: sqlite3.Connection) -> None:
    """Migrate existing INTEGER PK tables to TEXT UUID primary keys."""
    cursor: sqlite3.Cursor = conn.cursor()
    timestamp: str = now()

    # Build ID mapping for lists
    cursor.execute("SELECT id, name, icon, item_sort, sort_order, created_at FROM lists")
    old_lists: list[sqlite3.Row] = cursor.fetchall()
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
        old_id: int = row[0]
        new_id: str = new_uuid()
        list_id_map[old_id] = new_id
        created_at: str = row[5] if row[5] else timestamp
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
                timestamp,
            ),
        )

    # Build ID mapping for items
    cursor.execute("SELECT id, list_id, text, completed, created_at, completed_at FROM items")
    old_items: list[sqlite3.Row] = cursor.fetchall()
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
        old_id_item: int = row[0]
        new_id_item: str = new_uuid()
        item_id_map[old_id_item] = new_id_item
        new_list_id: str | None = list_id_map.get(row[1])
        if not new_list_id:
            continue
        created_at_item: str = row[4] if row[4] else timestamp
        cursor.execute(
            "INSERT INTO items_new "
            "(id, list_id, text, completed, created_at, updated_at, completed_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (new_id_item, new_list_id, row[2], row[3] or 0, created_at_item, timestamp, row[5]),
        )

    # Migrate history
    cursor.execute("SELECT id, list_id, item_id, action, item_text, timestamp FROM history")
    old_history: list[sqlite3.Row] = cursor.fetchall()

    cursor.execute("DROP TABLE IF EXISTS history_new")
    cursor.execute("""
        CREATE TABLE history_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            list_id TEXT NOT NULL,
            item_id TEXT,
            action TEXT NOT NULL,
            item_text TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (list_id) REFERENCES lists_new(id) ON DELETE CASCADE,
            FOREIGN KEY (item_id) REFERENCES items_new(id) ON DELETE SET NULL
        )
    """)

    for row in old_history:
        new_list_id_hist: str | None = list_id_map.get(row[1])
        if not new_list_id_hist:
            continue
        new_item_id: str | None = item_id_map.get(row[2]) if row[2] else None
        cursor.execute(
            "INSERT INTO history_new (list_id, item_id, action, item_text, timestamp) "
            "VALUES (?, ?, ?, ?, ?)",
            (new_list_id_hist, new_item_id, row[3], row[4], row[5]),
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
        "db_migration_complete",
        migration="integer_pk_to_uuid",
        lists=len(list_id_map),
        items=len(item_id_map),
        history_entries=len(old_history),
    )


def _ensure_columns(conn: sqlite3.Connection) -> None:
    """Add any missing columns to existing UUID-based tables."""
    cursor: sqlite3.Cursor = conn.cursor()
    timestamp: str = now()

    cursor.execute("PRAGMA table_info(lists)")
    list_cols: list[str] = [row[1] for row in cursor.fetchall()]
    if "updated_at" not in list_cols:
        cursor.execute("ALTER TABLE lists ADD COLUMN updated_at TEXT")
        cursor.execute("UPDATE lists SET updated_at = ? WHERE updated_at IS NULL", (timestamp))
    if "_deleted" not in list_cols:
        cursor.execute("ALTER TABLE lists ADD COLUMN _deleted INTEGER DEFAULT 0")
    if "item_sort" not in list_cols:
        cursor.execute("ALTER TABLE lists ADD COLUMN item_sort TEXT DEFAULT 'alphabetical'")
    if "sort_order" not in list_cols:
        cursor.execute("ALTER TABLE lists ADD COLUMN sort_order INTEGER DEFAULT 0")

    cursor.execute("PRAGMA table_info(items)")
    item_cols: list[str] = [row[1] for row in cursor.fetchall()]
    if "updated_at" not in item_cols:
        cursor.execute("ALTER TABLE items ADD COLUMN updated_at TEXT")
        cursor.execute("UPDATE items SET updated_at = ? WHERE updated_at IS NULL", (timestamp,))
    if "_deleted" not in item_cols:
        cursor.execute("ALTER TABLE items ADD COLUMN _deleted INTEGER DEFAULT 0")
    if "category_id" not in item_cols:
        cursor.execute("ALTER TABLE items ADD COLUMN category_id TEXT")

    cursor.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'categories'")
    if cursor.fetchone() is None:
        cursor.execute("""
            CREATE TABLE categories (
                id TEXT PRIMARY KEY,
                list_id TEXT NOT NULL,
                name TEXT NOT NULL,
                color TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                _deleted INTEGER DEFAULT 0,
                FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE
            )
        """)

    conn.commit()


def _rename_legacy_history_actions(conn: sqlite3.Connection) -> None:
    """Rename legacy ``item_edited`` history rows to ``item_renamed``.

    Idempotent — only logs when rows are actually updated.
    """
    cursor: sqlite3.Cursor = conn.cursor()
    cursor.execute("UPDATE history SET action = 'item_renamed' WHERE action = 'item_edited'")
    if cursor.rowcount > 0:
        logger.info(
            "history_action_renamed", rows=cursor.rowcount, old="item_edited", new="item_renamed"
        )
    conn.commit()


def _ensure_history_hidden_column(conn: sqlite3.Connection) -> None:
    """Add the ``hidden`` column to the history table if it is missing.

    Idempotent — supports "remove from history" by soft-hiding rows rather
    than deleting them.
    """
    cursor: sqlite3.Cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(history)")
    history_cols: list[str] = [row[1] for row in cursor.fetchall()]
    if "hidden" not in history_cols:
        cursor.execute("ALTER TABLE history ADD COLUMN hidden INTEGER DEFAULT 0")
        logger.info("history_hidden_column_added")
    conn.commit()


def _ensure_history_item_fk(conn: sqlite3.Connection) -> None:
    """Add the ``history.item_id -> items(id) ON DELETE SET NULL`` foreign key.

    SQLite cannot attach a foreign key via ``ALTER TABLE``, so an older database
    whose ``history`` table predates this constraint is rebuilt: a new table with
    both foreign keys is created, rows are copied verbatim, and the old table is
    dropped. Idempotent — a no-op once the ``item_id`` key is present.
    """
    cursor: sqlite3.Cursor = conn.cursor()
    cursor.execute("PRAGMA foreign_key_list(history)")
    # foreign_key_list columns: (id, seq, table, from, to, ...); row[3] is "from".
    # Positional access avoids depending on a sqlite3.Row factory, which init_db's
    # own connection does not set.
    has_item_fk: bool = any(row[3] == "item_id" for row in cursor.fetchall())
    if has_item_fk:
        return

    # Older databases that predate this FK may also predate the `hidden` column.
    # Copy it only when present so the rebuild works regardless of call order;
    # absent rows fall back to the new table's DEFAULT 0.
    cursor.execute("PRAGMA table_info(history)")
    has_hidden: bool = any(row[1] == "hidden" for row in cursor.fetchall())
    columns: str = "id, list_id, item_id, action, item_text, timestamp"
    if has_hidden:
        columns = "id, list_id, item_id, action, item_text, hidden, timestamp"

    # SQLite has transactional DDL, so a failure mid-rebuild can be rolled back to
    # the intact original table instead of leaving the database without history.
    logger.info("db_migration_begin", migration="history_item_fk")
    try:
        cursor.execute("DROP TABLE IF EXISTS history_new")
        cursor.execute("""
            CREATE TABLE history_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                list_id TEXT NOT NULL,
                item_id TEXT,
                action TEXT NOT NULL,
                item_text TEXT,
                hidden INTEGER DEFAULT 0,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE,
                FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL
            )
        """)
        cursor.execute(
            f"INSERT INTO history_new ({columns}) SELECT {columns} FROM history"
        )
        # Capture now: the DROP/ALTER DDL below resets rowcount to -1, so it
        # cannot be read at the logger.info call.
        migrated: int = cursor.rowcount
        cursor.execute("DROP TABLE IF EXISTS history")
        cursor.execute("ALTER TABLE history_new RENAME TO history")
        conn.commit()
    except Exception:
        conn.rollback()
        logger.exception("db_migration_failed", migration="history_item_fk")
        raise
    logger.info("db_migration_complete", migration="history_item_fk", rows=migrated)


def _ensure_indexes(conn: sqlite3.Connection) -> None:
    """Create indexes on sync hot paths. Idempotent — safe to call repeatedly."""
    cursor: sqlite3.Cursor = conn.cursor()
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_items_list_id ON items(list_id, _deleted)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_items_updated ON items(updated_at, id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_lists_updated ON lists(updated_at, id)")
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_categories_list_id ON categories(list_id, _deleted)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_categories_updated ON categories(updated_at, id)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_history_list_id ON history(list_id, hidden, timestamp)"
    )
    conn.commit()
