"""Settings persistence helpers shared by the REST and sync write paths."""

import sqlite3


def clear_default_list_if_matches(cursor: sqlite3.Cursor, list_id: str) -> None:
    """Drop the default-list setting if it points at ``list_id``."""
    cursor.execute("DELETE FROM settings WHERE key = 'default_list_id' AND value = ?", (list_id,))


def clear_orphaned_default_list(cursor: sqlite3.Cursor) -> None:
    """Drop the default-list setting if it no longer points at a live list.

    Runs from the tombstone purge: once a list is hard-deleted its id is unknown,
    and ``_save_default_list`` accepts unknown ids, so a stale client could re-set
    a purged list as default with nothing else ever clearing it.
    """
    cursor.execute(
        "DELETE FROM settings WHERE key = 'default_list_id' "
        "AND value NOT IN (SELECT id FROM lists WHERE _deleted = 0)"
    )
