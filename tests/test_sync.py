"""Tests for RxDB-compatible sync pull/push endpoints."""

import uuid


def _uuid():
    """Generate a random UUID string for test documents."""
    return str(uuid.uuid4())


class TestSyncPull:
    """Tests for GET /api/v1/sync/{collection}/pull."""

    def test_pull_empty(self, client):
        """Empty database returns empty documents and null checkpoint."""
        resp = client.get("/api/v1/sync/lists/pull")
        assert resp.status_code == 200
        data = resp.json()
        assert data["documents"] == []
        assert data["checkpoint"] is None

    def test_pull_returns_documents(self, client, create_list):
        """After creating a list, pull returns it as a document."""
        lst = create_list(name="Sync Test")
        resp = client.get("/api/v1/sync/lists/pull")
        docs = resp.json()["documents"]
        assert any(d["id"] == lst["id"] for d in docs)

    def test_pull_with_checkpoint(self, client, create_list, db):
        """Only documents newer than the checkpoint are returned."""
        lst1 = create_list(name="Old")

        # Get checkpoint from first pull
        pull1 = client.get("/api/v1/sync/lists/pull").json()
        cp = pull1["checkpoint"]

        # Create a second list with a later timestamp
        lst2 = create_list(name="New")

        pull2 = client.get(
            f"/api/v1/sync/lists/pull?updated_at={cp['updatedAt']}&id={cp['id']}"
            f"&issued_at={cp['issuedAt']}"
        ).json()
        ids = [d["id"] for d in pull2["documents"]]
        assert lst2["id"] in ids
        assert lst1["id"] not in ids

    def test_pull_limit(self, client, create_list):
        """Pull respects the limit parameter."""
        for i in range(5):
            create_list(name=f"List {i}")
        resp = client.get("/api/v1/sync/lists/pull?limit=2")
        assert len(resp.json()["documents"]) == 2

    def test_pull_limit_rejects_out_of_range(self, client):
        """Limit outside [1, 1000] is rejected with 422 before touching the DB."""
        assert client.get("/api/v1/sync/lists/pull?limit=0").status_code == 422
        assert client.get("/api/v1/sync/lists/pull?limit=9999999").status_code == 422
        assert client.get("/api/v1/sync/lists/pull?limit=-5").status_code == 422

    def test_pull_invalid_collection(self, client):
        """Invalid collection name returns 400 INVALID_COLLECTION."""
        resp = client.get("/api/v1/sync/bogus/pull")
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] == "INVALID_COLLECTION"


class TestSyncPush:
    """Tests for POST /api/v1/sync/{collection}/push."""

    def test_push_insert_new(self, client, create_list):
        """Pushing a new document inserts it with empty conflicts."""
        # Need an existing list for foreign key when pushing items
        lst = create_list()
        doc_id = _uuid()
        changes = [
            {
                "newDocumentState": {
                    "id": doc_id,
                    "list_id": lst["id"],
                    "text": "Pushed item",
                    "completed": 0,
                    "created_at": "2025-01-01T00:00:00",
                    "updated_at": "2025-01-01T00:00:00",
                    "completed_at": None,
                    "_deleted": 0,
                },
                "assumedMasterState": None,
            }
        ]
        resp = client.post("/api/v1/sync/items/push", json=changes)
        assert resp.status_code == 200
        assert resp.json() == []

    def test_push_update_existing(self, client, create_list, db):
        """Matching assumedMasterState allows update with no conflicts."""
        lst = create_list(name="Original")
        # Get the current document state
        pull = client.get("/api/v1/sync/lists/pull").json()
        current = next(d for d in pull["documents"] if d["id"] == lst["id"])

        changes = [
            {
                "newDocumentState": {
                    **current,
                    "name": "Updated",
                    "updated_at": "2099-01-01T00:00:00",
                },
                "assumedMasterState": current,
            }
        ]
        resp = client.post("/api/v1/sync/lists/push", json=changes)
        assert resp.status_code == 200
        assert resp.json() == []

    def test_push_conflict_stale_state(self, client, create_list):
        """Stale assumedMasterState produces a conflict."""
        lst = create_list(name="Conflict Test")
        pull = client.get("/api/v1/sync/lists/pull").json()
        current = next(d for d in pull["documents"] if d["id"] == lst["id"])

        # Update on server first to make the assumed state stale
        client.put(f"/api/v1/lists/{lst['id']}", json={"name": "Server Update"})

        changes = [
            {
                "newDocumentState": {
                    **current,
                    "name": "Client Update",
                    "updated_at": "2099-01-01T00:00:00",
                },
                "assumedMasterState": current,
            }
        ]
        resp = client.post("/api/v1/sync/lists/push", json=changes)
        conflicts = resp.json()
        assert len(conflicts) == 1
        assert conflicts[0]["name"] == "Server Update"

    def test_push_conflict_same_timestamp_different_content(self, client, create_list, db):
        """A server change that keeps updated_at unchanged is still a conflict (B2).

        Simulates two writes that coincidentally share a millisecond-precision
        updated_at: a full-field comparison must catch the divergence that a
        timestamp-only check would silently overwrite.
        """
        lst = create_list(name="Original")
        pull = client.get("/api/v1/sync/lists/pull").json()
        current = next(d for d in pull["documents"] if d["id"] == lst["id"])

        # Mutate the server row WITHOUT touching updated_at — the coincidental
        # same-timestamp collision the timestamp-only check could not detect.
        db.execute(
            "UPDATE lists SET name = ? WHERE id = ?",
            ("Server Edit", lst["id"]),
        )
        db.commit()

        changes = [
            {
                "newDocumentState": {**current, "name": "Client Edit"},
                "assumedMasterState": current,
            }
        ]
        resp = client.post("/api/v1/sync/lists/push", json=changes)
        conflicts = resp.json()
        assert len(conflicts) == 1
        assert conflicts[0]["name"] == "Server Edit"

    def test_push_insert_conflict_exists(self, client, create_list):
        """Insert when document already exists returns conflict."""
        lst = create_list(name="Existing")
        pull = client.get("/api/v1/sync/lists/pull").json()
        current = next(d for d in pull["documents"] if d["id"] == lst["id"])

        changes = [
            {
                "newDocumentState": current,
                "assumedMasterState": None,
            }
        ]
        resp = client.post("/api/v1/sync/lists/push", json=changes)
        conflicts = resp.json()
        assert len(conflicts) == 1

    def test_push_invalid_collection(self, client):
        """Invalid collection returns 400."""
        resp = client.post("/api/v1/sync/bogus/push", json=[])
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] == "INVALID_COLLECTION"

    def test_push_malformed_change_missing_new_state(self, client):
        """Change without newDocumentState is rejected with 422."""
        resp = client.post("/api/v1/sync/lists/push", json=[{}])
        assert resp.status_code == 422
        assert resp.json()["error"]["code"] == "VALIDATION_ERROR"

    def test_push_missing_id_in_document_state(self, client):
        """newDocumentState without id returns 422."""
        resp = client.post(
            "/api/v1/sync/lists/push",
            json=[{"newDocumentState": {"name": "No ID"}, "assumedMasterState": None}],
        )
        assert resp.status_code == 422
        assert resp.json()["error"]["code"] == "VALIDATION_ERROR"

    def test_push_rejects_oversized_item_text(self, client, create_list):
        """Item text beyond TEXT_MAX (500) chars is rejected with 422 (mirrors REST limit)."""
        lst = create_list()
        resp = client.post(
            "/api/v1/sync/items/push",
            json=[
                {
                    "newDocumentState": {
                        "id": _uuid(),
                        "list_id": lst["id"],
                        "text": "A" * 501,
                        "completed": 0,
                        "created_at": "2025-01-01T00:00:00",
                        "updated_at": "2025-01-01T00:00:00",
                        "completed_at": None,
                        "_deleted": 0,
                    },
                    "assumedMasterState": None,
                }
            ],
        )
        assert resp.status_code == 422
        assert resp.json()["error"]["code"] == "VALIDATION_ERROR"

    def test_push_rejects_oversized_list_name(self, client):
        """List name beyond 200 chars is rejected with 422."""
        resp = client.post(
            "/api/v1/sync/lists/push",
            json=[
                {
                    "newDocumentState": {
                        "id": _uuid(),
                        "name": "N" * 201,
                        "icon": "list",
                        "item_sort": "alphabetical",
                        "sort_order": 0,
                        "created_at": "2025-01-01T00:00:00",
                        "updated_at": "2025-01-01T00:00:00",
                        "_deleted": 0,
                    },
                    "assumedMasterState": None,
                }
            ],
        )
        assert resp.status_code == 422
        assert resp.json()["error"]["code"] == "VALIDATION_ERROR"

    def test_push_rejects_oversized_icon(self, client):
        """Icon beyond 50 chars is rejected with 422."""
        resp = client.post(
            "/api/v1/sync/lists/push",
            json=[
                {
                    "newDocumentState": {
                        "id": _uuid(),
                        "name": "Ok",
                        "icon": "I" * 51,
                        "_deleted": 0,
                    },
                    "assumedMasterState": None,
                }
            ],
        )
        assert resp.status_code == 422
        assert resp.json()["error"]["code"] == "VALIDATION_ERROR"

    def test_push_ignores_unknown_fields(self, client, create_list):
        """Unknown keys in newDocumentState are silently dropped (no regression)."""
        lst = create_list()
        resp = client.post(
            "/api/v1/sync/items/push",
            json=[
                {
                    "newDocumentState": {
                        "id": _uuid(),
                        "list_id": lst["id"],
                        "text": "Known fields only",
                        "completed": 0,
                        "created_at": "2025-01-01T00:00:00",
                        "updated_at": "2025-01-01T00:00:00",
                        "completed_at": None,
                        "_deleted": 0,
                        "unknown_attacker_field": "A" * 5000,
                    },
                    "assumedMasterState": None,
                }
            ],
        )
        assert resp.status_code == 200
        assert resp.json() == []

    def test_push_partial_insert_uses_defaults(self, client, create_list):
        """Sparse newDocumentState still inserts successfully via collection defaults."""
        lst = create_list()
        item_id = _uuid()
        resp = client.post(
            "/api/v1/sync/items/push",
            json=[
                {
                    "newDocumentState": {
                        "id": item_id,
                        "list_id": lst["id"],
                        "text": "Sparse",
                    },
                    "assumedMasterState": None,
                }
            ],
        )
        assert resp.status_code == 200
        assert resp.json() == []

        docs = client.get("/api/v1/sync/items/pull").json()["documents"]
        inserted = next(d for d in docs if d["id"] == item_id)
        assert inserted["text"] == "Sparse"
        assert inserted["created_at"] is not None
        assert inserted["updated_at"] is not None


def _push_item(client, *, new_state, assumed=None):
    """Send a single items push and return (status, conflicts)."""
    resp = client.post(
        "/api/v1/sync/items/push",
        json=[{"newDocumentState": new_state, "assumedMasterState": assumed}],
    )
    return resp.status_code, resp.json()


def _push_list(client, *, new_state, assumed=None):
    """Send a single lists push and return (status, conflicts)."""
    resp = client.post(
        "/api/v1/sync/lists/push",
        json=[{"newDocumentState": new_state, "assumedMasterState": assumed}],
    )
    return resp.status_code, resp.json()


class TestSyncHistory:
    """Sync push must derive history entries from the state diff."""

    def test_list_insert_logs_list_created(self, client):
        """Inserting a new list via sync push logs list_created."""
        list_id = _uuid()
        _push_list(
            client,
            new_state={
                "id": list_id,
                "name": "Synced List",
                "icon": "list",
                "item_sort": "alphabetical",
                "sort_order": 0,
                "created_at": "2025-01-01T00:00:00",
                "updated_at": "2025-01-01T00:00:00",
                "_deleted": 0,
            },
        )
        history = client.get(f"/api/v1/lists/{list_id}/history").json()
        assert [h["action"] for h in history] == ["list_created"]
        assert history[0]["item_text"] == "Synced List"

    def test_item_insert_logs_item_created(self, client, create_list):
        """Inserting a new item via sync push logs item_created."""
        lst = create_list(undo=True)
        item_id = _uuid()
        _push_item(
            client,
            new_state={
                "id": item_id,
                "list_id": lst["id"],
                "text": "Buy milk",
                "completed": 0,
                "created_at": "2025-01-01T00:00:00",
                "updated_at": "2025-01-01T00:00:00",
                "completed_at": None,
                "_deleted": 0,
            },
        )
        history = client.get(f"/api/v1/lists/{lst['id']}/history").json()
        assert [h["action"] for h in history] == ["item_created"]
        assert history[0]["item_text"] == "Buy milk"

    def test_item_completion_toggle_logs_both_directions(self, client, create_list):
        """Completing then uncompleting logs item_completed and item_uncompleted."""
        lst = create_list(undo=True)
        item_id = _uuid()
        base = {
            "id": item_id,
            "list_id": lst["id"],
            "text": "Task",
            "completed": 0,
            "created_at": "2025-01-01T00:00:00",
            "updated_at": "2025-01-01T00:00:00",
            "completed_at": None,
            "_deleted": 0,
        }
        _push_item(client, new_state=base)
        inserted = client.get("/api/v1/sync/items/pull").json()["documents"][-1]

        completed = {**inserted, "completed": 1, "updated_at": "2025-01-02T00:00:00"}
        _push_item(client, new_state=completed, assumed=inserted)

        reopened = {**completed, "completed": 0, "updated_at": "2025-01-03T00:00:00"}
        _push_item(client, new_state=reopened, assumed=completed)

        actions = {h["action"] for h in client.get(f"/api/v1/lists/{lst['id']}/history").json()}
        assert actions == {"item_created", "item_completed", "item_uncompleted"}

    def test_item_text_change_logs_item_renamed(self, client, create_list):
        """Changing text logs item_renamed with 'old → new' format."""
        lst = create_list(undo=True)
        item_id = _uuid()
        base = {
            "id": item_id,
            "list_id": lst["id"],
            "text": "Old text",
            "completed": 0,
            "created_at": "2025-01-01T00:00:00",
            "updated_at": "2025-01-01T00:00:00",
            "completed_at": None,
            "_deleted": 0,
        }
        _push_item(client, new_state=base)
        inserted = client.get("/api/v1/sync/items/pull").json()["documents"][-1]

        edited = {**inserted, "text": "New text", "updated_at": "2025-01-02T00:00:00"}
        _push_item(client, new_state=edited, assumed=inserted)

        history = client.get(f"/api/v1/lists/{lst['id']}/history").json()
        edit = next(h for h in history if h["action"] == "item_renamed")
        assert edit["item_text"] == "Old text \u2192 New text"

    def test_item_soft_delete_logs_item_deleted(self, client, create_list):
        """Setting _deleted=1 logs item_deleted with the pre-delete text."""
        lst = create_list(undo=True)
        item_id = _uuid()
        base = {
            "id": item_id,
            "list_id": lst["id"],
            "text": "Doomed",
            "completed": 0,
            "created_at": "2025-01-01T00:00:00",
            "updated_at": "2025-01-01T00:00:00",
            "completed_at": None,
            "_deleted": 0,
        }
        _push_item(client, new_state=base)
        inserted = client.get("/api/v1/sync/items/pull").json()["documents"][-1]

        deleted = {**inserted, "_deleted": 1, "updated_at": "2025-01-02T00:00:00"}
        _push_item(client, new_state=deleted, assumed=inserted)

        history = client.get(f"/api/v1/lists/{lst['id']}/history").json()
        deleted_entry = next(h for h in history if h["action"] == "item_deleted")
        assert deleted_entry["item_text"] == "Doomed"

    def test_list_rename_logs_list_renamed(self, client, create_list):
        """Renaming a list via sync logs list_renamed with 'old → new' format."""
        lst = create_list(name="Original", undo=True)
        pull = client.get("/api/v1/sync/lists/pull").json()
        current = next(d for d in pull["documents"] if d["id"] == lst["id"])

        renamed = {**current, "name": "Renamed", "updated_at": "2099-01-01T00:00:00"}
        _push_list(client, new_state=renamed, assumed=current)

        history = client.get(f"/api/v1/lists/{lst['id']}/history").json()
        entry = next(h for h in history if h["action"] == "list_renamed")
        assert entry["item_text"] == "Original → Renamed"
        assert entry["item_id"] is None

    def test_list_icon_and_sort_change_log_history(self, client, create_list):
        """Icon and item_sort changes each produce their own history row."""
        lst = create_list(undo=True)
        pull = client.get("/api/v1/sync/lists/pull").json()
        current = next(d for d in pull["documents"] if d["id"] == lst["id"])

        updated = {
            **current,
            "icon": "star",
            "item_sort": "created_desc",
            "updated_at": "2099-01-01T00:00:00",
        }
        _push_list(client, new_state=updated, assumed=current)

        history = client.get(f"/api/v1/lists/{lst['id']}/history").json()
        actions = {h["action"] for h in history}
        assert "list_icon_changed" in actions
        assert "list_sort_changed" in actions

    def test_list_sort_order_change_does_not_log(self, client, create_list):
        """Reordering lists (sort_order only) produces no history rows."""
        lst = create_list(undo=True)
        pull = client.get("/api/v1/sync/lists/pull").json()
        current = next(d for d in pull["documents"] if d["id"] == lst["id"])

        reordered = {**current, "sort_order": 5, "updated_at": "2099-01-01T00:00:00"}
        _push_list(client, new_state=reordered, assumed=current)

        history = client.get(f"/api/v1/lists/{lst['id']}/history").json()
        assert history == []

    def test_push_batch_size_limit(self, client):
        """Pushing more than 500 changes in one request is rejected."""
        changes = [
            {"newDocumentState": {"id": _uuid(), "name": "x"}, "assumedMasterState": None}
            for _ in range(501)
        ]
        resp = client.post("/api/v1/sync/lists/push", json=changes)
        assert resp.status_code == 422


def _new_list_state(list_id):
    """Build a complete, valid list document state for sync push."""
    return {
        "id": list_id,
        "name": "Fresh List",
        "icon": "list",
        "item_sort": "alphabetical",
        "sort_order": 0,
        "created_at": "2025-01-01T00:00:00",
        "updated_at": "2025-01-01T00:00:00",
        "_deleted": 0,
    }


class TestSyncPushBroadcast:
    """Push must broadcast whenever at least one write committed (B1)."""

    def _patch_broadcasts(self, monkeypatch):
        """Replace the broadcast callables in the sync module with spies."""
        import unittest.mock as mock

        from backend.routes import sync

        update_spy = mock.Mock(name="broadcast_update")
        sync_spy = mock.Mock(name="broadcast_sync")
        monkeypatch.setattr(sync, "broadcast_update", update_spy)
        monkeypatch.setattr(sync, "broadcast_sync", sync_spy)
        return update_spy, sync_spy

    def test_mixed_batch_broadcasts_despite_conflict(self, client, create_list, monkeypatch):
        """A batch with one write and one conflict still notifies other clients."""
        update_spy, sync_spy = self._patch_broadcasts(monkeypatch)

        existing = create_list(name="Already Here")
        pull = client.get("/api/v1/sync/lists/pull").json()
        existing_state = next(d for d in pull["documents"] if d["id"] == existing["id"])

        changes = [
            # Succeeds: brand-new document inserted.
            {"newDocumentState": _new_list_state(_uuid()), "assumedMasterState": None},
            # Conflicts: insert (assumed None) of an id that already exists.
            {"newDocumentState": existing_state, "assumedMasterState": None},
        ]
        resp = client.post("/api/v1/sync/lists/push", json=changes)

        assert len(resp.json()) == 1
        update_spy.assert_called_once()
        sync_spy.assert_called_once()

    def test_pure_conflict_batch_does_not_broadcast(self, client, create_list, monkeypatch):
        """A batch where every change conflicts writes nothing and stays silent."""
        update_spy, sync_spy = self._patch_broadcasts(monkeypatch)

        existing = create_list(name="Only Conflict")
        pull = client.get("/api/v1/sync/lists/pull").json()
        existing_state = next(d for d in pull["documents"] if d["id"] == existing["id"])

        changes = [{"newDocumentState": existing_state, "assumedMasterState": None}]
        resp = client.post("/api/v1/sync/lists/push", json=changes)

        assert len(resp.json()) == 1
        update_spy.assert_not_called()
        sync_spy.assert_not_called()
