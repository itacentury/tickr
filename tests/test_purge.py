"""Tests for tombstone purging and the stale-checkpoint guard."""

import sqlite3
from datetime import UTC, datetime, timedelta

from backend.database import now
from backend.purge import purge_tombstones, tombstone_cutoff


def _days_ago(days: int) -> str:
    """Return an ISO timestamp ``days`` in the past, matching ``database.now``."""
    moment: datetime = datetime.now(UTC) - timedelta(days=days)
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _insert_list(conn: sqlite3.Connection, name: str, deleted: int, updated_at: str) -> str:
    """Insert one list row and return its id."""
    list_id: str = f"list-{name}"
    conn.execute(
        "INSERT INTO lists (id, name, created_at, updated_at, _deleted) VALUES (?, ?, ?, ?, ?)",
        (list_id, name, updated_at, updated_at, deleted),
    )
    conn.commit()
    return list_id


class TestTombstoneCutoff:
    """Tests for the cutoff timestamp formatting."""

    def test_cutoff_matches_now_format(self):
        """Cutoff is the same lexicographically comparable format as now()."""
        cutoff: str = tombstone_cutoff(30)
        assert cutoff.endswith("Z")
        # Same shape as now() so string comparison against updated_at is valid.
        assert len(cutoff) == len(now())
        assert cutoff < now()


class TestPurgeTombstones:
    """Tests for purge_tombstones over the in-memory schema."""

    def test_purges_old_tombstones(self, db_connection):
        """A tombstone older than the window is deleted and counted."""
        old_id = _insert_list(db_connection, "old", deleted=1, updated_at=_days_ago(40))

        deleted = purge_tombstones(db_connection, retain_days=30)

        assert deleted == 1
        row = db_connection.execute("SELECT 1 FROM lists WHERE id = ?", (old_id,)).fetchone()
        assert row is None

    def test_keeps_recent_tombstones(self, db_connection):
        """A tombstone newer than the window survives."""
        recent_id = _insert_list(db_connection, "recent", deleted=1, updated_at=_days_ago(5))

        deleted = purge_tombstones(db_connection, retain_days=30)

        assert deleted == 0
        row = db_connection.execute("SELECT 1 FROM lists WHERE id = ?", (recent_id,)).fetchone()
        assert row is not None

    def test_keeps_live_documents(self, db_connection):
        """A live (non-deleted) row is never purged, even when old."""
        live_id = _insert_list(db_connection, "live", deleted=0, updated_at=_days_ago(99))

        deleted = purge_tombstones(db_connection, retain_days=30)

        assert deleted == 0
        row = db_connection.execute("SELECT 1 FROM lists WHERE id = ?", (live_id,)).fetchone()
        assert row is not None


class TestStaleCheckpointGuard:
    """Tests for the 410 guard in GET /api/v1/sync/{collection}/pull."""

    def test_old_checkpoint_returns_410(self, client):
        """A checkpoint older than the purge horizon forces a full resync."""
        resp = client.get(f"/api/v1/sync/lists/pull?updated_at={_days_ago(40)}&id=any-id")
        assert resp.status_code == 410
        assert resp.json()["error"]["code"] == "CHECKPOINT_TOO_OLD"

    def test_recent_checkpoint_is_allowed(self, client):
        """A recent checkpoint pulls normally."""
        resp = client.get(f"/api/v1/sync/lists/pull?updated_at={_days_ago(1)}&id=any-id")
        assert resp.status_code == 200

    def test_no_checkpoint_is_allowed(self, client):
        """The initial pull (no checkpoint) is never guarded."""
        resp = client.get("/api/v1/sync/lists/pull")
        assert resp.status_code == 200
