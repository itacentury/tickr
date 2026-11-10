"""Tests for settings endpoints."""

import pytest

from backend import config
from backend.constants import ID_MAX


class TestGetSettings:
    """Tests for GET /api/v1/settings."""

    def test_get_settings_default(self, client) -> None:
        """Default settings include list_sort=alphabetical."""
        resp = client.get("/api/v1/settings")
        assert resp.status_code == 200
        assert resp.json() == {
            "list_sort": "alphabetical",
            "default_list_timeout_minutes": "30",
        }

    def test_get_settings_timeout_from_config(
        self, client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The default-list timeout reflects the configured value."""
        monkeypatch.setattr(config, "DEFAULT_LIST_TIMEOUT_MINUTES", 5)
        resp = client.get("/api/v1/settings")
        assert resp.json()["default_list_timeout_minutes"] == "5"


class TestUpdateSettings:
    """Tests for PUT /api/v1/settings."""

    def test_update_settings_valid_options(self, client) -> None:
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

    def test_update_settings_invalid(self, client) -> None:
        """Invalid sort option returns 400 INVALID_SORT_OPTION."""
        resp = client.put("/api/v1/settings", json={"list_sort": "random"})
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] == "INVALID_SORT_OPTION"

    def test_update_settings_empty_body(self, client) -> None:
        """Empty body is a no-op and returns success."""
        resp = client.put("/api/v1/settings", json={})
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_settings_affect_list_order(self, client, create_list) -> None:
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


class TestDefaultList:
    """Tests for the default_list_id setting."""

    def test_no_default_initially(self, client) -> None:
        """No list is default until one is chosen."""
        assert "default_list_id" not in client.get("/api/v1/settings").json()

    def test_set_and_clear_default(self, client, create_list) -> None:
        """A default can be set, replaced and cleared again."""
        first: dict = create_list("First")
        second: dict = create_list("Second")

        client.put("/api/v1/settings", json={"default_list_id": first["id"]})
        assert client.get("/api/v1/settings").json()["default_list_id"] == first["id"]

        client.put("/api/v1/settings", json={"default_list_id": second["id"]})
        assert client.get("/api/v1/settings").json()["default_list_id"] == second["id"]

        resp = client.put("/api/v1/settings", json={"default_list_id": ""})
        assert resp.status_code == 200
        assert "default_list_id" not in client.get("/api/v1/settings").json()

    def test_unrelated_update_keeps_default(self, client, create_list) -> None:
        """Updating another setting leaves the default untouched."""
        lst: dict = create_list("Keep")
        client.put("/api/v1/settings", json={"default_list_id": lst["id"]})
        client.put("/api/v1/settings", json={"list_sort": "created_asc"})
        assert client.get("/api/v1/settings").json()["default_list_id"] == lst["id"]

    def test_unknown_list_accepted(self, client) -> None:
        """A list not yet replicated to the server can still become the default."""
        resp = client.put("/api/v1/settings", json={"default_list_id": "not-synced-yet"})
        assert resp.status_code == 200
        assert client.get("/api/v1/settings").json()["default_list_id"] == "not-synced-yet"

    def test_overlong_id_rejected(self, client) -> None:
        """An id exceeding the maximum length fails validation."""
        resp = client.put("/api/v1/settings", json={"default_list_id": "x" * (ID_MAX + 1)})
        assert resp.status_code == 422
