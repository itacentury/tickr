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

    def test_get_history_excludes_hidden_entries(self, client, create_list, db):
        """History rows flagged hidden = 1 are not returned."""
        lst = create_list()
        db.execute(
            "INSERT INTO history (list_id, action, item_text, hidden) VALUES (?, ?, ?, 1)",
            (lst["id"], "item_created", "hidden item"),
        )
        db.commit()

        history = client.get(f"/api/v1/lists/{lst['id']}/history").json()
        assert all(h["item_text"] != "hidden item" for h in history)


def _push_item(client, item_state, assumed):
    """Push a single item change through the sync endpoint and return the response."""
    return client.post(
        "/api/v1/sync/items/push",
        json=[{"newDocumentState": item_state, "assumedMasterState": assumed}],
    )


class TestRestoreHistory:
    """Tests for item_restored logging on the sync un-tombstone path."""

    def test_restore_logs_item_restored(self, client, create_list, create_item):
        """Un-tombstoning an item via sync records an item_restored event."""
        lst = create_list()
        item = create_item(lst["id"], text="Restore me")

        pull = client.get("/api/v1/sync/items/pull").json()
        current = next(d for d in pull["documents"] if d["id"] == item["id"])

        deleted = {**current, "_deleted": 1, "updated_at": "2099-01-01T00:00:00"}
        assert _push_item(client, deleted, current).json() == []

        restored = {**deleted, "_deleted": 0, "updated_at": "2099-01-02T00:00:00"}
        assert _push_item(client, restored, deleted).json() == []

        actions = [h["action"] for h in client.get(f"/api/v1/lists/{lst['id']}/history").json()]
        assert "item_deleted" in actions
        assert "item_restored" in actions


class TestHideItemHistory:
    """Tests for POST /api/v1/lists/{list_id}/history/hide."""

    def test_hide_removes_item_entries_from_view(self, client, create_list, create_item):
        """Hiding an item drops all of its history rows from the list view."""
        lst = create_list()
        item = create_item(lst["id"], text="Bye")
        client.put(f"/api/v1/items/{item['id']}", json={"completed": True})

        resp = client.post(f"/api/v1/lists/{lst['id']}/history/hide?item_id={item['id']}")
        assert resp.status_code == 200
        assert resp.json() == {"success": True}

        history = client.get(f"/api/v1/lists/{lst['id']}/history").json()
        assert all(h["item_id"] != item["id"] for h in history)

    def test_hide_keeps_other_items(self, client, create_list, create_item):
        """Hiding one item leaves another item's history untouched."""
        lst = create_list()
        kept = create_item(lst["id"], text="Keep")
        gone = create_item(lst["id"], text="Hide")

        client.post(f"/api/v1/lists/{lst['id']}/history/hide?item_id={gone['id']}")

        item_ids = {h["item_id"] for h in client.get(f"/api/v1/lists/{lst['id']}/history").json()}
        assert kept["id"] in item_ids
        assert gone["id"] not in item_ids

    def test_hide_unknown_item_returns_404(self, client, create_list):
        """Hiding an item with no matching history rows returns 404 ITEM_NOT_FOUND."""
        lst = create_list()

        resp = client.post(f"/api/v1/lists/{lst['id']}/history/hide?item_id=does-not-exist")
        assert resp.status_code == 404
        assert resp.json()["error"]["code"] == "ITEM_NOT_FOUND"
