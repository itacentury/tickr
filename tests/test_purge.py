"""Tests for tombstone purging and the stale-checkpoint guard."""

import sqlite3
from datetime import UTC, datetime, timedelta

import pytest

from backend.database import _ensure_history_item_fk, init_db, now
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


def _insert_item(conn: sqlite3.Connection, item_id: str, list_id: str, deleted: int) -> None:
    """Insert one item row whose tombstone is old enough to be purged."""
    stamp: str = _days_ago(40)
    conn.execute(
        "INSERT INTO items (id, list_id, text, created_at, updated_at, _deleted) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (item_id, list_id, "Buy milk", stamp, stamp, deleted),
    )
    conn.commit()


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
    """Tests for the 410 guard in GET /api/v1/sync/{collection}/pull.

    Staleness is judged by ``issued_at`` (when the server handed out the
    checkpoint), never by ``updated_at`` (a document timestamp): old data must
    not 410 a freshly synced client.
    """

    def test_legacy_checkpoint_without_issued_at_returns_410(self, client):
        """A pre-issuedAt checkpoint forces one migrating full resync."""
        resp = client.get(f"/api/v1/sync/lists/pull?updated_at={_days_ago(40)}&id=any-id")
        assert resp.status_code == 410
        assert resp.json()["error"]["code"] == "CHECKPOINT_TOO_OLD"

    def test_old_issued_at_returns_410(self, client):
        """A client that last synced before the purge horizon must resync."""
        resp = client.get(
            f"/api/v1/sync/lists/pull?updated_at={_days_ago(1)}&id=any-id&issued_at={_days_ago(40)}"
        )
        assert resp.status_code == 410
        assert resp.json()["error"]["code"] == "CHECKPOINT_TOO_OLD"

    def test_old_documents_with_fresh_issued_at_are_allowed(self, client):
        """Regression: ancient document timestamps must not 410 a fresh sync.

        The old guard compared ``updated_at`` (a document timestamp) against
        the purge horizon, trapping clients with old data in an infinite
        wipe/reload resync loop.
        """
        resp = client.get(
            f"/api/v1/sync/lists/pull?updated_at={_days_ago(400)}&id=any-id"
            f"&issued_at={_days_ago(1)}"
        )
        assert resp.status_code == 200

    def test_recent_checkpoint_is_allowed(self, client):
        """A recent checkpoint pulls normally."""
        resp = client.get(
            f"/api/v1/sync/lists/pull?updated_at={_days_ago(1)}&id=any-id&issued_at={_days_ago(1)}"
        )
        assert resp.status_code == 200

    def test_no_checkpoint_is_allowed(self, client):
        """The initial pull (no checkpoint) is never guarded."""
        resp = client.get("/api/v1/sync/lists/pull")
        assert resp.status_code == 200


class TestCheckpointIssuedAt:
    """Tests for the issuedAt stamp on pull-response checkpoints."""

    def test_checkpoint_includes_fresh_issued_at(self, client, db_connection):
        """Every checkpoint built from documents carries a fresh issuedAt."""
        doc_time: str = _days_ago(400)
        _insert_list(db_connection, "old-doc", deleted=0, updated_at=doc_time)

        resp = client.get("/api/v1/sync/lists/pull")

        assert resp.status_code == 200
        checkpoint: dict = resp.json()["checkpoint"]
        assert checkpoint["updatedAt"] == doc_time
        # The stamp reflects sync time, not the (ancient) document time.
        assert checkpoint["issuedAt"] > _days_ago(1)

    def test_empty_pull_echoes_checkpoint_with_fresh_issued_at(self, client):
        """An empty incremental pull refreshes the client's checkpoint stamp.

        Without this, an idle-but-active client's issuedAt would age past the
        purge horizon and trigger a needless full resync.
        """
        updated_at: str = _days_ago(1)
        resp = client.get(
            f"/api/v1/sync/lists/pull?updated_at={updated_at}&id=some-id&issued_at={_days_ago(1)}"
        )

        assert resp.status_code == 200
        body: dict = resp.json()
        assert body["documents"] == []
        checkpoint: dict = body["checkpoint"]
        assert checkpoint["updatedAt"] == updated_at
        assert checkpoint["id"] == "some-id"
        assert checkpoint["issuedAt"] > _days_ago(1)

    def test_empty_initial_pull_has_no_checkpoint(self, client):
        """No documents and no client checkpoint yields a null checkpoint."""
        resp = client.get("/api/v1/sync/lists/pull")
        assert resp.status_code == 200
        assert resp.json()["checkpoint"] is None

    def test_fresh_paginated_resync_of_old_data_never_410s(self, client, db_connection):
        """Regression for the reload loop: paginating >limit old rows succeeds.

        Page 1 of a fresh sync over data older than the purge horizon returns
        a checkpoint whose updatedAt is ancient; requesting page 2 with that
        checkpoint used to 410 and wipe the client, forever.
        """
        for i in range(3):
            _insert_list(db_connection, f"old-{i}", deleted=0, updated_at=_days_ago(400 - i))

        page1 = client.get("/api/v1/sync/lists/pull?limit=2")
        assert page1.status_code == 200
        checkpoint: dict = page1.json()["checkpoint"]

        page2 = client.get(
            f"/api/v1/sync/lists/pull?limit=2&updated_at={checkpoint['updatedAt']}"
            f"&id={checkpoint['id']}&issued_at={checkpoint['issuedAt']}"
        )
        assert page2.status_code == 200
        assert len(page2.json()["documents"]) == 1


class TestPurgeForeignKeyCascades:
    """B6a: hard deletes must not orphan history rows.

    ``purge_tombstones`` enables ``PRAGMA foreign_keys`` so the schema's cascade
    rules fire: deleting a list removes its history; purging an item nulls the
    dangling ``history.item_id`` while keeping the audit row.
    """

    def test_deleting_list_cascades_history(self, db_connection):
        """Purging a soft-deleted list removes its items and history."""
        list_id = _insert_list(db_connection, "doomed", deleted=1, updated_at=_days_ago(40))
        _insert_item(db_connection, "item-1", list_id, deleted=0)
        db_connection.execute(
            "INSERT INTO history (list_id, item_id, action, item_text) VALUES (?, ?, ?, ?)",
            (list_id, "item-1", "item_created", "Buy milk"),
        )
        db_connection.commit()

        purge_tombstones(db_connection, retain_days=30)

        assert _count(db_connection, "lists", list_id) == 0
        assert _count(db_connection, "items", "item-1") == 0
        history = db_connection.execute(
            "SELECT COUNT(*) FROM history WHERE list_id = ?", (list_id,)
        ).fetchone()[0]
        assert history == 0

    def test_purging_item_nulls_history_reference(self, db_connection):
        """Purging an item under a live list nulls item_id but keeps the row."""
        list_id = _insert_list(db_connection, "live", deleted=0, updated_at=now())
        _insert_item(db_connection, "item-1", list_id, deleted=1)
        db_connection.execute(
            "INSERT INTO history (list_id, item_id, action, item_text) VALUES (?, ?, ?, ?)",
            (list_id, "item-1", "item_deleted", "Buy milk"),
        )
        db_connection.commit()

        purge_tombstones(db_connection, retain_days=30)

        assert _count(db_connection, "items", "item-1") == 0
        row = db_connection.execute(
            "SELECT item_id, item_text FROM history WHERE list_id = ?", (list_id,)
        ).fetchone()
        assert row is not None
        assert row["item_id"] is None
        assert row["item_text"] == "Buy milk"


class TestHistoryItemFkMigration:
    """``_ensure_history_item_fk`` rebuilds legacy history tables idempotently."""

    @staticmethod
    def _downgrade_history(conn: sqlite3.Connection) -> None:
        """Replace history with a legacy table lacking the item_id foreign key."""
        conn.execute("DROP TABLE history")
        conn.execute("""
            CREATE TABLE history (
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

    @staticmethod
    def _has_item_fk(conn: sqlite3.Connection) -> bool:
        rows = conn.execute("PRAGMA foreign_key_list(history)").fetchall()
        return any(row[3] == "item_id" for row in rows)

    def test_migration_adds_fk_and_preserves_rows(self):
        conn = sqlite3.connect(":memory:")
        init_db(conn)
        self._downgrade_history(conn)
        conn.execute(
            "INSERT INTO history (list_id, item_id, action, item_text) VALUES (?, ?, ?, ?)",
            ("list-1", "item-1", "item_created", "Buy milk"),
        )
        conn.commit()
        assert not self._has_item_fk(conn)

        _ensure_history_item_fk(conn)

        assert self._has_item_fk(conn)
        row = conn.execute("SELECT item_id, item_text FROM history").fetchone()
        assert row == ("item-1", "Buy milk")
        conn.close()

    def test_migration_is_idempotent(self):
        conn = sqlite3.connect(":memory:")
        init_db(conn)  # schema already carries the FK
        assert self._has_item_fk(conn)

        _ensure_history_item_fk(conn)

        assert self._has_item_fk(conn)
        conn.close()

    def test_migration_rolls_back_on_failure(self):
        """A failure mid-rebuild leaves the original history table intact."""
        conn = sqlite3.connect(":memory:")
        init_db(conn)
        self._downgrade_history(conn)
        conn.execute(
            "INSERT INTO history (list_id, item_id, action, item_text) VALUES (?, ?, ?, ?)",
            ("list-1", "item-1", "item_created", "Buy milk"),
        )
        conn.commit()

        class _CommitFails:
            """Delegate to the real connection but raise on commit."""

            def __init__(self, real: sqlite3.Connection) -> None:
                self._real = real

            def cursor(self) -> sqlite3.Cursor:
                return self._real.cursor()

            def commit(self) -> None:
                raise sqlite3.OperationalError("simulated failure")

            def rollback(self) -> None:
                self._real.rollback()

        with pytest.raises(sqlite3.OperationalError):
            _ensure_history_item_fk(_CommitFails(conn))  # type: ignore[arg-type]

        # Rollback restored the original (FK-less) table and its row.
        assert not self._has_item_fk(conn)
        row = conn.execute("SELECT item_id, item_text FROM history").fetchone()
        assert row == ("item-1", "Buy milk")
        conn.close()


def _count(conn: sqlite3.Connection, table: str, row_id: str) -> int:
    """Return how many rows in ``table`` carry the given id."""
    return conn.execute(f"SELECT COUNT(*) FROM {table} WHERE id = ?", (row_id,)).fetchone()[0]
