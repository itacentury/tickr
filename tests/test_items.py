"""Tests for item CRUD endpoints."""


class TestGetItems:
    """Tests for GET /api/v1/lists/{list_id}/items."""

    def test_get_items_empty(self, client, create_list) -> None:
        """A fresh list returns no items."""
        lst = create_list()
        resp = client.get(f"/api/v1/lists/{lst['id']}/items")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_get_items_nonexistent_list(self, client) -> None:
        """Fetching items for an unknown list returns 404 with LIST_NOT_FOUND."""
        resp = client.get("/api/v1/lists/does-not-exist/items")
        assert resp.status_code == 404
        assert resp.json()["error"]["code"] == "LIST_NOT_FOUND"

    def test_get_items_excludes_completed(self, client, create_list, create_item) -> None:
        """By default, completed items are excluded."""
        lst = create_list()
        item = create_item(lst["id"])
        client.put(f"/api/v1/items/{item['id']}", json={"completed": True})

        resp = client.get(f"/api/v1/lists/{lst['id']}/items")
        assert all(i["id"] != item["id"] for i in resp.json())

    def test_get_items_include_completed(self, client, create_list, create_item) -> None:
        """include_completed=true shows all items including completed ones."""
        lst = create_list()
        item = create_item(lst["id"])
        client.put(f"/api/v1/items/{item['id']}", json={"completed": True})

        resp = client.get(f"/api/v1/lists/{lst['id']}/items?include_completed=true")
        assert any(i["id"] == item["id"] for i in resp.json())


class TestCreateItem:
    """Tests for POST /api/v1/lists/{list_id}/items."""

    def test_create_item(self, client, create_list) -> None:
        """Creating an item returns id, list_id, text, and completed=False."""
        lst = create_list()
        resp = client.post(f"/api/v1/lists/{lst['id']}/items", json={"text": "Buy milk"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["text"] == "Buy milk"
        assert data["list_id"] == lst["id"]
        assert data["completed"] is False

    def test_create_item_appears_in_get(self, client, create_list, create_item) -> None:
        """A created item appears in GET /lists/{id}/items."""
        lst = create_list()
        item = create_item(lst["id"], text="Walk dog")
        resp = client.get(f"/api/v1/lists/{lst['id']}/items")
        assert any(i["id"] == item["id"] for i in resp.json())

    def test_create_item_undo_skips_history(self, client, create_list, db) -> None:
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

    def test_create_item_validation_text_required(self, client, create_list) -> None:
        """Missing text field returns 422."""
        lst = create_list()
        resp = client.post(f"/api/v1/lists/{lst['id']}/items", json={})
        assert resp.status_code == 422

    def test_create_item_validation_text_too_long(self, client, create_list) -> None:
        """Text exceeding TEXT_MAX (500) characters returns 422."""
        lst = create_list()
        resp = client.post(f"/api/v1/lists/{lst['id']}/items", json={"text": "x" * 501})
        assert resp.status_code == 422

    def test_create_item_accepts_text_at_boundary(self, client, create_list) -> None:
        """Text exactly at TEXT_MAX (500) characters is accepted."""
        lst = create_list()
        resp = client.post(f"/api/v1/lists/{lst['id']}/items", json={"text": "x" * 500})
        assert resp.status_code == 200

    def test_create_item_rejects_empty_text(self, client, create_list) -> None:
        """Empty text returns 422 via min_length=1."""
        lst = create_list()
        resp = client.post(f"/api/v1/lists/{lst['id']}/items", json={"text": ""})
        assert resp.status_code == 422

    def test_create_item_rejects_whitespace_text(self, client, create_list) -> None:
        """Whitespace-only text is stripped and rejected."""
        lst = create_list()
        resp = client.post(f"/api/v1/lists/{lst['id']}/items", json={"text": "   "})
        assert resp.status_code == 422

    def test_create_item_strips_whitespace(self, client, create_list) -> None:
        """Surrounding whitespace is stripped from the stored text."""
        lst = create_list()
        resp = client.post(f"/api/v1/lists/{lst['id']}/items", json={"text": "  buy milk  "})
        assert resp.status_code == 200
        assert resp.json()["text"] == "buy milk"

    def test_response_omits_deleted_field(self, client, create_list, create_item) -> None:
        """The `_deleted` column must not leak through GET /items."""
        lst = create_list()
        create_item(lst["id"])
        resp = client.get(f"/api/v1/lists/{lst['id']}/items")
        assert resp.status_code == 200
        assert all("_deleted" not in entry for entry in resp.json())


class TestUpdateItem:
    """Tests for PUT /api/v1/items/{item_id}."""

    def test_update_item_text(self, client, create_list, create_item) -> None:
        """PUT changes item text."""
        lst = create_list()
        item = create_item(lst["id"], text="Old text")
        resp = client.put(f"/api/v1/items/{item['id']}", json={"text": "New text"})
        assert resp.status_code == 200

        items = client.get(f"/api/v1/lists/{lst['id']}/items").json()
        updated = next(i for i in items if i["id"] == item["id"])
        assert updated["text"] == "New text"

    def test_update_item_complete(self, client, create_list, create_item) -> None:
        """Setting completed=True sets completed_at."""
        lst = create_list()
        item = create_item(lst["id"])
        client.put(f"/api/v1/items/{item['id']}", json={"completed": True})

        items = client.get(f"/api/v1/lists/{lst['id']}/items?include_completed=true").json()
        updated = next(i for i in items if i["id"] == item["id"])
        assert updated["completed"] == 1
        assert updated["completed_at"] is not None

    def test_update_item_uncomplete(self, client, create_list, create_item) -> None:
        """Setting completed=False clears completed_at."""
        lst = create_list()
        item = create_item(lst["id"])
        client.put(f"/api/v1/items/{item['id']}", json={"completed": True})
        client.put(f"/api/v1/items/{item['id']}", json={"completed": False})

        items = client.get(f"/api/v1/lists/{lst['id']}/items").json()
        updated = next(i for i in items if i["id"] == item["id"])
        assert updated["completed"] == 0
        assert updated["completed_at"] is None

    def test_update_item_recomplete_is_noop(self, client, create_list, create_item, db) -> None:
        """A second completed=True PUT logs no new item_completed row and keeps completed_at."""
        lst = create_list()
        item = create_item(lst["id"])

        client.put(f"/api/v1/items/{item['id']}", json={"completed": True})
        items = client.get(f"/api/v1/lists/{lst['id']}/items?include_completed=true").json()
        first = next(i for i in items if i["id"] == item["id"])
        first_completed_at = first["completed_at"]
        first_updated_at = first["updated_at"]
        assert first_completed_at is not None

        def completed_rows() -> int:
            """Count item_completed history rows for the item under test."""
            row = db.execute(
                "SELECT COUNT(*) AS cnt FROM history WHERE item_id = ? AND action = 'item_completed'",
                (item["id"],),
            ).fetchone()
            return row["cnt"]

        assert completed_rows() == 1

        resp = client.put(f"/api/v1/items/{item['id']}", json={"completed": True})
        assert resp.status_code == 200

        assert completed_rows() == 1  # no new history row

        items = client.get(f"/api/v1/lists/{lst['id']}/items?include_completed=true").json()
        second = next(i for i in items if i["id"] == item["id"])
        assert second["completed_at"] == first_completed_at  # completed_at unchanged
        assert second["updated_at"] == first_updated_at  # no-op does not bump updated_at

    def test_update_item_same_text_is_noop(self, client, create_list, create_item) -> None:
        """PUTting the identical text is a no-op and does not bump updated_at."""
        lst = create_list()
        item = create_item(lst["id"], text="Same text")
        original_updated_at = item["updated_at"]

        resp = client.put(f"/api/v1/items/{item['id']}", json={"text": "Same text"})
        assert resp.status_code == 200

        items = client.get(f"/api/v1/lists/{lst['id']}/items").json()
        updated = next(i for i in items if i["id"] == item["id"])
        assert updated["updated_at"] == original_updated_at

    def test_update_item_not_found(self, client) -> None:
        """Updating a nonexistent item returns 404 ITEM_NOT_FOUND."""
        resp = client.put(
            "/api/v1/items/00000000-0000-0000-0000-000000000000",
            json={"text": "nope"},
        )
        assert resp.status_code == 404
        assert resp.json()["error"]["code"] == "ITEM_NOT_FOUND"


class TestDeleteItem:
    """Tests for DELETE /api/v1/items/{item_id}."""

    def test_delete_item(self, client, create_list, create_item) -> None:
        """A deleted item no longer appears in GET."""
        lst = create_list()
        item = create_item(lst["id"])
        client.delete(f"/api/v1/items/{item['id']}")
        items = client.get(f"/api/v1/lists/{lst['id']}/items").json()
        assert all(i["id"] != item["id"] for i in items)

    def test_delete_item_undo_skips_history(self, client, create_list, create_item, db) -> None:
        """Deleting with undo=True produces no history entry for the delete action."""
        lst = create_list()
        item = create_item(lst["id"])
        client.delete(f"/api/v1/items/{item['id']}?undo=true")
        row = db.execute(
            "SELECT COUNT(*) as cnt FROM history WHERE item_id = ? AND action = 'item_deleted'",
            (item["id"],),
        ).fetchone()
        assert row["cnt"] == 0

    def test_delete_nonexistent_item_skips_broadcast(self, client, monkeypatch) -> None:
        """Deleting an absent item succeeds idempotently without scheduling any broadcast."""
        calls: list[tuple] = []
        monkeypatch.setattr(
            "backend.routes.items.notify_change",
            lambda *args, **kwargs: calls.append(args),
        )
        resp = client.delete("/api/v1/items/does-not-exist")
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        assert calls == []

    def test_delete_existing_item_broadcasts(
        self, client, create_list, create_item, monkeypatch
    ) -> None:
        """Deleting a real item schedules exactly one items_changed broadcast for its list."""
        lst = create_list()
        item = create_item(lst["id"])
        calls: list[tuple] = []
        monkeypatch.setattr(
            "backend.routes.items.notify_change",
            lambda bg, *args: calls.append(args),
        )
        client.delete(f"/api/v1/items/{item['id']}")
        assert calls == [("items_changed", "items", lst["id"])]
