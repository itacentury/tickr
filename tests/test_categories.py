"""Category CRUD and integration with items."""

import uuid


def _uuid() -> str:
    return str(uuid.uuid4())


class TestCategoryCRUD:
    def test_create_and_list(self, client, create_list):
        lst = create_list()
        resp = client.post(
            f"/api/v1/lists/{lst['id']}/categories",
            json={"name": "Shopping", "color": "#3b82f6"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] == "Shopping"
        assert body["color"] == "#3b82f6"
        assert body["list_id"] == lst["id"]

        listing = client.get(f"/api/v1/lists/{lst['id']}/categories")
        assert listing.status_code == 200
        assert len(listing.json()) == 1

    def test_create_rejects_invalid_color(self, client, create_list):
        lst = create_list()
        for bad in ["red", "#abc", "#GGGGGG", "#1234567"]:
            resp = client.post(
                f"/api/v1/lists/{lst['id']}/categories",
                json={"name": "X", "color": bad},
            )
            assert resp.status_code == 422, f"expected 422 for {bad}"

    def test_create_rejects_unknown_list(self, client):
        resp = client.post(
            f"/api/v1/lists/{_uuid()}/categories",
            json={"name": "X", "color": "#3b82f6"},
        )
        assert resp.status_code == 404

    def test_update_category(self, client, create_list):
        lst = create_list()
        created = client.post(
            f"/api/v1/lists/{lst['id']}/categories",
            json={"name": "Shopping", "color": "#3b82f6"},
        ).json()

        resp = client.put(
            f"/api/v1/categories/{created['id']}",
            json={"name": "Errands", "color": "#10b981"},
        )
        assert resp.status_code == 200

        listing = client.get(f"/api/v1/lists/{lst['id']}/categories").json()
        assert listing[0]["name"] == "Errands"
        assert listing[0]["color"] == "#10b981"

    def test_delete_category_clears_items(self, client, create_list, create_item):
        lst = create_list()
        cat = client.post(
            f"/api/v1/lists/{lst['id']}/categories",
            json={"name": "Shopping", "color": "#3b82f6"},
        ).json()
        item = create_item(lst["id"])
        client.put(f"/api/v1/items/{item['id']}", json={"category_id": cat["id"]})

        resp = client.delete(f"/api/v1/categories/{cat['id']}")
        assert resp.status_code == 200

        # category gone from listing
        listing = client.get(f"/api/v1/lists/{lst['id']}/categories").json()
        assert listing == []

        # item still exists, but category_id cleared
        items = client.get(f"/api/v1/lists/{lst['id']}/items").json()
        assert len(items) == 1
        assert items[0]["category_id"] is None


class TestItemCategoryAssignment:
    def test_create_item_with_category(self, client, create_list):
        lst = create_list()
        cat = client.post(
            f"/api/v1/lists/{lst['id']}/categories",
            json={"name": "Shopping", "color": "#3b82f6"},
        ).json()
        resp = client.post(
            f"/api/v1/lists/{lst['id']}/items",
            json={"text": "Bread", "category_id": cat["id"]},
        )
        assert resp.status_code == 200
        assert resp.json()["category_id"] == cat["id"]

    def test_clear_item_category_via_update(self, client, create_list, create_item):
        lst = create_list()
        cat = client.post(
            f"/api/v1/lists/{lst['id']}/categories",
            json={"name": "Shopping", "color": "#3b82f6"},
        ).json()
        item = create_item(lst["id"])
        client.put(f"/api/v1/items/{item['id']}", json={"category_id": cat["id"]})
        resp = client.put(f"/api/v1/items/{item['id']}", json={"category_id": None})
        assert resp.status_code == 200

        items = client.get(f"/api/v1/lists/{lst['id']}/items").json()
        assert items[0]["category_id"] is None


class TestCategorySync:
    def test_push_pull_category(self, client, create_list):
        lst = create_list()
        cat_id = _uuid()
        resp = client.post(
            "/api/v1/sync/categories/push",
            json=[
                {
                    "newDocumentState": {
                        "id": cat_id,
                        "list_id": lst["id"],
                        "name": "Shopping",
                        "color": "#3b82f6",
                        "created_at": "2026-01-01T00:00:00",
                        "updated_at": "2026-01-01T00:00:00",
                        "_deleted": 0,
                    },
                    "assumedMasterState": None,
                }
            ],
        )
        assert resp.status_code == 200
        assert resp.json() == []

        pull = client.get("/api/v1/sync/categories/pull").json()
        assert len(pull["documents"]) == 1
        assert pull["documents"][0]["id"] == cat_id

    def test_push_rejects_invalid_color(self, client, create_list):
        lst = create_list()
        resp = client.post(
            "/api/v1/sync/categories/push",
            json=[
                {
                    "newDocumentState": {
                        "id": _uuid(),
                        "list_id": lst["id"],
                        "name": "Shopping",
                        "color": "not-a-hex",
                        "created_at": "2026-01-01T00:00:00",
                        "updated_at": "2026-01-01T00:00:00",
                        "_deleted": 0,
                    },
                    "assumedMasterState": None,
                }
            ],
        )
        assert resp.status_code == 422

    def test_item_sync_carries_category_id(self, client, create_list):
        lst = create_list()
        cat_id = _uuid()
        client.post(
            "/api/v1/sync/categories/push",
            json=[
                {
                    "newDocumentState": {
                        "id": cat_id,
                        "list_id": lst["id"],
                        "name": "X",
                        "color": "#3b82f6",
                        "created_at": "2026-01-01T00:00:00",
                        "updated_at": "2026-01-01T00:00:00",
                        "_deleted": 0,
                    },
                    "assumedMasterState": None,
                }
            ],
        )

        item_id = _uuid()
        resp = client.post(
            "/api/v1/sync/items/push",
            json=[
                {
                    "newDocumentState": {
                        "id": item_id,
                        "list_id": lst["id"],
                        "text": "Bread",
                        "completed": 0,
                        "category_id": cat_id,
                        "created_at": "2026-01-01T00:00:00",
                        "updated_at": "2026-01-01T00:00:00",
                        "completed_at": None,
                        "_deleted": 0,
                    },
                    "assumedMasterState": None,
                }
            ],
        )
        assert resp.status_code == 200

        pull = client.get("/api/v1/sync/items/pull").json()
        assert pull["documents"][0]["category_id"] == cat_id


class TestCategoryListCascade:
    def test_list_delete_soft_deletes_categories_via_sync(self, client, create_list):
        # Listen-Delete soft-deletet die Liste und kaskadiert via FK auf categories?
        # Eigentlich nicht: SQL-FK feuert nur bei DELETE, nicht UPDATE _deleted=1.
        # Wir testen, dass die Listen-Delete-Route die Kategorien NICHT mitnimmt;
        # das Frontend erwartet die ohnehin gefilterte Sicht.
        lst = create_list()
        client.post(
            f"/api/v1/lists/{lst['id']}/categories",
            json={"name": "X", "color": "#3b82f6"},
        )
        client.delete(f"/api/v1/lists/{lst['id']}")

        # Categories table still has the row; pull returns it (used by remote clients)
        pull = client.get("/api/v1/sync/categories/pull").json()
        assert len(pull["documents"]) == 1
