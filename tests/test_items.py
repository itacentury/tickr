"""Tests for item CRUD endpoints."""


class TestGetItems:
    """Tests for GET /api/v1/lists/{list_id}/items."""

    def test_get_items_empty(self, client, create_list):
        """A fresh list returns no items."""
        lst = create_list()
        resp = client.get(f"/api/v1/lists/{lst['id']}/items")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_get_items_excludes_completed(self, client, create_list, create_item):
        """By default, completed items are excluded."""
        lst = create_list()
        item = create_item(lst["id"])
        client.put(f"/api/v1/items/{item['id']}", json={"completed": True})

        resp = client.get(f"/api/v1/lists/{lst['id']}/items")
        assert all(i["id"] != item["id"] for i in resp.json())

    def test_get_items_include_completed(self, client, create_list, create_item):
        """include_completed=true shows all items including completed ones."""
        lst = create_list()
        item = create_item(lst["id"])
        client.put(f"/api/v1/items/{item['id']}", json={"completed": True})

        resp = client.get(f"/api/v1/lists/{lst['id']}/items?include_completed=true")
        assert any(i["id"] == item["id"] for i in resp.json())


class TestCreateItem:
    """Tests for POST /api/v1/lists/{list_id}/items."""

    def test_create_item(self, client, create_list):
        """Creating an item returns id, list_id, text, and completed=False."""
        lst = create_list()
        resp = client.post(f"/api/v1/lists/{lst['id']}/items", json={"text": "Buy milk"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["text"] == "Buy milk"
        assert data["list_id"] == lst["id"]
        assert data["completed"] is False

    def test_create_item_appears_in_get(self, client, create_list, create_item):
        """A created item appears in GET /lists/{id}/items."""
        lst = create_list()
        item = create_item(lst["id"], text="Walk dog")
        resp = client.get(f"/api/v1/lists/{lst['id']}/items")
        assert any(i["id"] == item["id"] for i in resp.json())

    def test_create_item_undo_skips_history(self, client, create_list, db):
        """Creating with undo=True produces no history entry."""
        lst = create_list()
        resp = client.post(
            f"/api/v1/lists/{lst['id']}/items", json={"text": "Undo item", "undo": True}
        )
        item_id = resp.json()["id"]
        row = db.execute(
            "SELECT COUNT(*) as cnt FROM history WHERE item_id = ?", (item_id,)
        ).fetchone()
        assert row["cnt"] == 0

    def test_create_item_validation_text_required(self, client, create_list):
        """Missing text field returns 422."""
        lst = create_list()
        resp = client.post(f"/api/v1/lists/{lst['id']}/items", json={})
        assert resp.status_code == 422

    def test_create_item_validation_text_too_long(self, client, create_list):
        """Text exceeding 1000 characters returns 422."""
        lst = create_list()
        resp = client.post(f"/api/v1/lists/{lst['id']}/items", json={"text": "x" * 1001})
        assert resp.status_code == 422


class TestUpdateItem:
    """Tests for PUT /api/v1/items/{item_id}."""

    def test_update_item_text(self, client, create_list, create_item):
        """PUT changes item text."""
        lst = create_list()
        item = create_item(lst["id"], text="Old text")
        resp = client.put(f"/api/v1/items/{item['id']}", json={"text": "New text"})
        assert resp.status_code == 200

        items = client.get(f"/api/v1/lists/{lst['id']}/items").json()
        updated = next(i for i in items if i["id"] == item["id"])
        assert updated["text"] == "New text"

    def test_update_item_complete(self, client, create_list, create_item):
        """Setting completed=True sets completed_at."""
        lst = create_list()
        item = create_item(lst["id"])
        client.put(f"/api/v1/items/{item['id']}", json={"completed": True})

        items = client.get(f"/api/v1/lists/{lst['id']}/items?include_completed=true").json()
        updated = next(i for i in items if i["id"] == item["id"])
        assert updated["completed"] == 1
        assert updated["completed_at"] is not None

    def test_update_item_uncomplete(self, client, create_list, create_item):
        """Setting completed=False clears completed_at."""
        lst = create_list()
        item = create_item(lst["id"])
        client.put(f"/api/v1/items/{item['id']}", json={"completed": True})
        client.put(f"/api/v1/items/{item['id']}", json={"completed": False})

        items = client.get(f"/api/v1/lists/{lst['id']}/items").json()
        updated = next(i for i in items if i["id"] == item["id"])
        assert updated["completed"] == 0
        assert updated["completed_at"] is None

    def test_update_item_not_found(self, client):
        """Updating a nonexistent item returns 404 ITEM_NOT_FOUND."""
        resp = client.put(
            "/api/v1/items/00000000-0000-0000-0000-000000000000",
            json={"text": "nope"},
        )
        assert resp.status_code == 404
        assert resp.json()["error"]["code"] == "ITEM_NOT_FOUND"


class TestDeleteItem:
    """Tests for DELETE /api/v1/items/{item_id}."""

    def test_delete_item(self, client, create_list, create_item):
        """A deleted item no longer appears in GET."""
        lst = create_list()
        item = create_item(lst["id"])
        client.delete(f"/api/v1/items/{item['id']}")
        items = client.get(f"/api/v1/lists/{lst['id']}/items").json()
        assert all(i["id"] != item["id"] for i in items)

    def test_delete_item_undo_skips_history(self, client, create_list, create_item, db):
        """Deleting with undo=True produces no history entry for the delete action."""
        lst = create_list()
        item = create_item(lst["id"])
        client.delete(f"/api/v1/items/{item['id']}?undo=true")
        row = db.execute(
            "SELECT COUNT(*) as cnt FROM history WHERE item_id = ? AND action = 'item_deleted'",
            (item["id"],),
        ).fetchone()
        assert row["cnt"] == 0
