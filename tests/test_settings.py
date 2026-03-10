"""Tests for settings endpoints."""


class TestGetSettings:
    """Tests for GET /api/v1/settings."""

    def test_get_settings_default(self, client):
        """Default settings include list_sort=alphabetical."""
        resp = client.get("/api/v1/settings")
        assert resp.status_code == 200
        assert resp.json() == {"list_sort": "alphabetical"}


class TestUpdateSettings:
    """Tests for PUT /api/v1/settings."""

    def test_update_settings_valid_options(self, client):
        """Each valid list_sort option is accepted."""
        for option in [
            "alphabetical",
            "alphabetical_desc",
            "created_desc",
            "created_asc",
            "custom",
        ]:
            resp = client.put("/api/v1/settings", json={"list_sort": option})
            assert resp.status_code == 200
            assert client.get("/api/v1/settings").json()["list_sort"] == option

    def test_update_settings_invalid(self, client):
        """Invalid sort option returns 400 INVALID_SORT_OPTION."""
        resp = client.put("/api/v1/settings", json={"list_sort": "random"})
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] == "INVALID_SORT_OPTION"

    def test_update_settings_empty_body(self, client):
        """Empty body is a no-op and returns success."""
        resp = client.put("/api/v1/settings", json={})
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_settings_affect_list_order(self, client, create_list):
        """Changing list_sort affects the order of GET /lists."""
        create_list(name="Banana")
        create_list(name="Apple")
        create_list(name="Cherry")

        # Default alphabetical
        names_asc = [entry["name"] for entry in client.get("/api/v1/lists").json()]
        assert names_asc == ["Apple", "Banana", "Cherry"]

        # Switch to reverse alphabetical
        client.put("/api/v1/settings", json={"list_sort": "alphabetical_desc"})
        names_desc = [entry["name"] for entry in client.get("/api/v1/lists").json()]
        assert names_desc == ["Cherry", "Banana", "Apple"]
