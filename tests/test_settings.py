"""Tests for settings endpoints."""

import importlib
from types import ModuleType
from typing import Any

import httpx
import pytest

from backend import config
from backend.constants import ID_MAX


class TestGetSettings:
    """Tests for GET /api/v1/settings."""

    def test_get_settings_default(self, client) -> None:
        """Default settings include list_sort=alphabetical."""
        resp = client.get("/api/v1/settings")
        assert resp.status_code == 200
        assert resp.json() == {"list_sort": "alphabetical"}


class TestGetConfig:
    """Tests for GET /api/v1/config."""

    def test_get_config_default(self, client) -> None:
        """The default-list timeout defaults to 30 minutes."""
        resp = client.get("/api/v1/config")
        assert resp.status_code == 200
        assert resp.json() == {"default_list_timeout_minutes": 30}

    def test_get_config_timeout_from_config(self, client, monkeypatch: pytest.MonkeyPatch) -> None:
        """The default-list timeout reflects the configured value."""
        monkeypatch.setattr(config, "DEFAULT_LIST_TIMEOUT_MINUTES", 5)
        assert client.get("/api/v1/config").json()["default_list_timeout_minutes"] == 5

    @pytest.mark.parametrize("raw", ["0", "-5"])
    def test_timeout_config_clamped_to_one(self, raw: str, monkeypatch: pytest.MonkeyPatch) -> None:
        """A non-positive timeout is clamped so resumes aren't always idle."""
        monkeypatch.setenv("TICKR_DEFAULT_LIST_TIMEOUT_MINUTES", raw)
        try:
            reloaded: ModuleType = importlib.reload(config)
            assert reloaded.DEFAULT_LIST_TIMEOUT_MINUTES == 1
        finally:
            monkeypatch.delenv("TICKR_DEFAULT_LIST_TIMEOUT_MINUTES")
            importlib.reload(config)


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
        first: dict[str, Any] = create_list("First")
        second: dict[str, Any] = create_list("Second")

        client.put("/api/v1/settings", json={"default_list_id": first["id"]})
        assert client.get("/api/v1/settings").json()["default_list_id"] == first["id"]

        client.put("/api/v1/settings", json={"default_list_id": second["id"]})
        assert client.get("/api/v1/settings").json()["default_list_id"] == second["id"]

        resp = client.put("/api/v1/settings", json={"default_list_id": ""})
        assert resp.status_code == 200
        assert "default_list_id" not in client.get("/api/v1/settings").json()

    def test_unrelated_update_keeps_default(self, client, create_list) -> None:
        """Updating another setting leaves the default untouched."""
        lst: dict[str, Any] = create_list("Keep")
        client.put("/api/v1/settings", json={"default_list_id": lst["id"]})
        client.put("/api/v1/settings", json={"list_sort": "created_asc"})
        assert client.get("/api/v1/settings").json()["default_list_id"] == lst["id"]

    def test_unknown_list_accepted(self, client) -> None:
        """A list not yet replicated to the server can still become the default."""
        resp = client.put("/api/v1/settings", json={"default_list_id": "not-synced-yet"})
        assert resp.status_code == 200
        assert client.get("/api/v1/settings").json()["default_list_id"] == "not-synced-yet"

    def test_deleted_list_rejected(self, client, create_list) -> None:
        """A list already soft-deleted on the server cannot become the default."""
        lst: dict[str, Any] = create_list("Gone")
        client.delete(f"/api/v1/lists/{lst['id']}")
        resp: httpx.Response = client.put("/api/v1/settings", json={"default_list_id": lst["id"]})
        assert resp.status_code == 404
        assert resp.json()["error"]["code"] == "LIST_NOT_FOUND"
        assert "default_list_id" not in client.get("/api/v1/settings").json()

    def test_overlong_id_rejected(self, client) -> None:
        """An id exceeding the maximum length fails validation."""
        resp = client.put("/api/v1/settings", json={"default_list_id": "x" * (ID_MAX + 1)})
        assert resp.status_code == 422

    def test_invalid_sort_does_not_save_default(self, client, create_list) -> None:
        """A rejected list_sort aborts the whole update, including the default."""
        lst: dict[str, Any] = create_list("Mixed")
        resp: httpx.Response = client.put(
            "/api/v1/settings", json={"list_sort": "bogus", "default_list_id": lst["id"]}
        )
        assert resp.status_code == 400
        assert client.get("/api/v1/settings").json() == {"list_sort": "alphabetical"}

    def test_overlong_default_does_not_save_sort(self, client) -> None:
        """A rejected default_list_id aborts the whole update, including list_sort."""
        resp: httpx.Response = client.put(
            "/api/v1/settings",
            json={"list_sort": "custom", "default_list_id": "x" * (ID_MAX + 1)},
        )
        assert resp.status_code == 422
        assert client.get("/api/v1/settings").json() == {"list_sort": "alphabetical"}
