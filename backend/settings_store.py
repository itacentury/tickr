"""Settings persistence helpers shared by the REST and sync write paths."""

import sqlite3


def clear_default_list_if_matches(cursor: sqlite3.Cursor, list_id: str) -> None:
    """Drop the default-list setting if it points at ``list_id``."""
    cursor.execute("DELETE FROM settings WHERE key = 'default_list_id' AND value = ?", (list_id,))
