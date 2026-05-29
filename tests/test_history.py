"""Tests for history endpoints."""


class TestGetHistory:
    """Tests for GET /api/v1/lists/{list_id}/history."""

    def test_get_history_empty(self, client, create_list):
        """A fresh list with no actions returns empty history."""
        lst = create_list(undo=True)  # undo=True skips the creation history entry
        resp = client.get(f"/api/v1/lists/{lst['id']}/history")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_get_history_after_actions(self, client, create_list, create_item):
        """Creating a list and completing an item produce history entries."""
        lst = create_list(name="History Test")
        item = create_item(lst["id"], text="Test item")
        client.put(f"/api/v1/items/{item['id']}", json={"completed": True})

        history = client.get(f"/api/v1/lists/{lst['id']}/history").json()
        actions = [h["action"] for h in history]
        assert "list_created" in actions
        assert "item_created" in actions
        assert "item_completed" in actions

    def test_get_history_excludes_undo_actions(self, client, create_list, db):
        """History entries with undo_ prefix are filtered out."""
        lst = create_list()
        db.execute(
            "INSERT INTO history (list_id, action, item_text) VALUES (?, ?, ?)",
            (lst["id"], "undo_delete", "hidden"),
        )
        db.commit()

        history = client.get(f"/api/v1/lists/{lst['id']}/history").json()
        assert all(not h["action"].startswith("undo_") for h in history)
