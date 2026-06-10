"""Tombstone purging for the Tickr sync database.

Soft-deleted rows (``_deleted = 1``) are retained only as replication tombstones
so that peers learn about deletions. Once a row is older than the retention
window, no online client still needs it: any client whose sync checkpoint
predates the window is forced into a full resync by the pull endpoint's
stale-checkpoint guard. This module deletes such rows for good.
"""

import sqlite3
from datetime import UTC, datetime, timedelta

# Synced collections carrying a ``_deleted`` tombstone flag. Mirrors the keys of
# ``backend.routes.sync.COLLECTIONS``; kept local to avoid importing the route
# module (and its FastAPI dependencies) into this standalone-friendly helper.
_TOMBSTONE_TABLES: tuple[str, ...] = ("lists", "items", "categories")


def tombstone_cutoff(retain_days: int) -> str:
    """Return the timestamp before which tombstones are eligible for purging.

    The format matches ``backend.database.now`` exactly so the value can be
    compared lexicographically against the stored ``updated_at`` column.

    Args:
        retain_days: Number of days a tombstone is kept after deletion.

    Returns:
        An ISO 8601 UTC timestamp string with millisecond precision.
    """
    cutoff: datetime = datetime.now(UTC) - timedelta(days=retain_days)
    return cutoff.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def purge_tombstones(conn: sqlite3.Connection, retain_days: int) -> int:
    """Delete soft-deleted rows older than the retention window.

    ``updated_at`` is the deletion time: a soft-delete sets ``_deleted = 1`` and
    bumps ``updated_at``, and tombstones are never modified again.

    Args:
        conn: Open SQLite connection to the sync database.
        retain_days: Number of days a tombstone is kept after deletion.

    Returns:
        The total number of rows deleted across all synced tables.
    """
    cutoff: str = tombstone_cutoff(retain_days)
    cursor: sqlite3.Cursor = conn.cursor()
    deleted: int = 0
    for table in _TOMBSTONE_TABLES:
        cursor.execute(
            f"DELETE FROM {table} WHERE _deleted = 1 AND updated_at < ?",
            (cutoff,),
        )
        deleted += cursor.rowcount
    conn.commit()
    return deleted
