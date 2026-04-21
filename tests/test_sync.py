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

    def test_item_text_change_logs_item_edited(self, client, create_list):
        """Changing text logs item_edited with 'old → new' format."""
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
        edit = next(h for h in history if h["action"] == "item_edited")
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

    def test_list_rename_does_not_log(self, client, create_list):
        """List edits (name/icon) do not produce history rows."""
        lst = create_list(undo=True)
        pull = client.get("/api/v1/sync/lists/pull").json()
        current = next(d for d in pull["documents"] if d["id"] == lst["id"])

        renamed = {**current, "name": "Renamed", "updated_at": "2099-01-01T00:00:00"}
        _push_list(client, new_state=renamed, assumed=current)

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
