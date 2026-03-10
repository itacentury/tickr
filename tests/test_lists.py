"""Tests for list CRUD and reorder endpoints."""


class TestGetLists:
    """Tests for GET /api/v1/lists."""

    def test_get_lists_empty(self, client):
        """Empty database returns an empty list."""
        resp = client.get("/api/v1/lists")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_create_list_appears_in_get(self, client, create_list):
        """A created list appears in the GET /lists response."""
        created = create_list(name="Groceries")
        resp = client.get("/api/v1/lists")
        names = [lst["name"] for lst in resp.json()]
        assert "Groceries" in names
        assert any(lst["id"] == created["id"] for lst in resp.json())

    def test_get_lists_with_item_counts(self, client, create_list, create_item):
        """GET /lists includes correct total_items and completed_items counts."""
        lst = create_list()
        create_item(lst["id"], text="Item 1")
        item2 = create_item(lst["id"], text="Item 2")
        client.put(f"/api/v1/items/{item2['id']}", json={"completed": True})

        resp = client.get("/api/v1/lists")
        result = next(entry for entry in resp.json() if entry["id"] == lst["id"])
        assert result["total_items"] == 2
        assert result["completed_items"] == 1

    def test_get_lists_excludes_deleted(self, client, create_list):
        """Soft-deleted lists are hidden from GET /lists."""
        lst = create_list()
        client.delete(f"/api/v1/lists/{lst['id']}")
        resp = client.get("/api/v1/lists")
        assert all(entry["id"] != lst["id"] for entry in resp.json())


class TestCreateList:
    """Tests for POST /api/v1/lists."""

    def test_create_list(self, client):
        """Creating a list returns id, name, and icon."""
        resp = client.post("/api/v1/lists", json={"name": "My List"})
        assert resp.status_code == 200
        data = resp.json()
        assert "id" in data
        assert data["name"] == "My List"
        assert data["icon"] == "list"

    def test_create_list_custom_icon(self, client):
        """Custom icon field is persisted and returned."""
        resp = client.post("/api/v1/lists", json={"name": "Work", "icon": "briefcase"})
        assert resp.json()["icon"] == "briefcase"

    def test_create_list_undo_skips_history(self, client, db):
        """Creating with undo=True produces no history entry."""
        resp = client.post("/api/v1/lists", json={"name": "Undo List", "undo": True})
        list_id = resp.json()["id"]
        row = db.execute(
            "SELECT COUNT(*) as cnt FROM history WHERE list_id = ?", (list_id,)
        ).fetchone()
        assert row["cnt"] == 0

    def test_create_list_validation_name_required(self, client):
        """Missing name field returns 422."""
        resp = client.post("/api/v1/lists", json={"icon": "star"})
        assert resp.status_code == 422

    def test_create_list_validation_name_too_long(self, client):
        """Name exceeding 200 characters returns 422."""
        resp = client.post("/api/v1/lists", json={"name": "x" * 201})
        assert resp.status_code == 422


class TestUpdateList:
    """Tests for PUT /api/v1/lists/{list_id}."""

    def test_update_list_name(self, client, create_list):
        """PUT updates the list name."""
        lst = create_list(name="Old Name")
        resp = client.put(f"/api/v1/lists/{lst['id']}", json={"name": "New Name"})
        assert resp.status_code == 200

        lists = client.get("/api/v1/lists").json()
        updated = next(entry for entry in lists if entry["id"] == lst["id"])
        assert updated["name"] == "New Name"

    def test_update_list_icon(self, client, create_list):
        """PUT updates the list icon."""
        lst = create_list()
        client.put(f"/api/v1/lists/{lst['id']}", json={"icon": "star"})

        lists = client.get("/api/v1/lists").json()
        updated = next(entry for entry in lists if entry["id"] == lst["id"])
        assert updated["icon"] == "star"

    def test_update_list_item_sort(self, client, create_list):
        """PUT updates the item_sort preference."""
        lst = create_list()
        client.put(f"/api/v1/lists/{lst['id']}", json={"item_sort": "created_desc"})

        lists = client.get("/api/v1/lists").json()
        updated = next(entry for entry in lists if entry["id"] == lst["id"])
        assert updated["item_sort"] == "created_desc"

    def test_update_list_invalid_sort(self, client, create_list):
        """Invalid item_sort returns 400 INVALID_SORT_OPTION."""
        lst = create_list()
        resp = client.put(f"/api/v1/lists/{lst['id']}", json={"item_sort": "bogus"})
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] == "INVALID_SORT_OPTION"


class TestDeleteList:
    """Tests for DELETE /api/v1/lists/{list_id}."""

    def test_delete_list_soft_deletes(self, client, create_list, create_item):
        """Soft-deleting a list hides both the list and its items."""
        lst = create_list()
        create_item(lst["id"])
        client.delete(f"/api/v1/lists/{lst['id']}")

        assert all(entry["id"] != lst["id"] for entry in client.get("/api/v1/lists").json())
        assert client.get(f"/api/v1/lists/{lst['id']}/items").json() == []


class TestReorderLists:
    """Tests for POST /api/v1/lists/reorder."""

    def test_reorder_lists(self, client, create_list, db):
        """Reordering updates sort_order for each list."""
        a = create_list(name="A")
        b = create_list(name="B")
        resp = client.post("/api/v1/lists/reorder", json={"list_ids": [b["id"], a["id"]]})
        assert resp.status_code == 200

        row_b = db.execute("SELECT sort_order FROM lists WHERE id = ?", (b["id"],)).fetchone()
        row_a = db.execute("SELECT sort_order FROM lists WHERE id = ?", (a["id"],)).fetchone()
        assert row_b["sort_order"] == 0
        assert row_a["sort_order"] == 1
