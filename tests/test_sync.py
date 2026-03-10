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
