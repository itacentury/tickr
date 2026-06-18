"""Shared test fixtures for Tickr API tests."""

import sqlite3
from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from backend import config
from backend.database import get_db, init_db
from backend.main import app, rate_limit_store


@pytest.fixture()
def db_connection() -> Iterator[sqlite3.Connection]:
    """Create a fresh in-memory SQLite database per test via `init_db(conn)`.

    Function-scope means every test gets a clean slate without hand-written
    teardown SQL. Schema lives in `backend.database._SCHEMA_SQL` — one
    source of truth shared with production.
    """
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    init_db(conn)
    yield conn
    conn.close()


@pytest.fixture(autouse=True)
def db(db_connection) -> Iterator[sqlite3.Connection]:
    """Override get_db to yield the per-test in-memory connection."""

    def override_get_db() -> Iterator[sqlite3.Connection]:
        """Yield the shared per-test connection in place of the real dependency."""
        yield db_connection

    app.dependency_overrides[get_db] = override_get_db
    yield db_connection
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def clear_rate_limits() -> None:
    """Reset the rate limit store before each test."""
    rate_limit_store.clear()


@pytest.fixture()
def client() -> TestClient:
    """Provide a TestClient that returns HTTP error responses instead of raising."""
    return TestClient(app, raise_server_exceptions=False)


# The suite runs with AUTH_ENABLED=false by default (see backend.config), so the
# existing tests need no changes. The fixtures below opt specific tests into the
# authenticated paths by monkeypatching the live config module — both the
# middleware (main.py) and auth helpers (auth.py) read config attributes lazily.
TEST_PASSWORD = "test-password"


@pytest.fixture()
def auth_enabled(monkeypatch) -> str:
    """Turn on auth with a known plaintext password and an insecure cookie.

    Returns the configured password so tests can log in.
    """
    monkeypatch.setattr(config, "AUTH_ENABLED", True)
    monkeypatch.setattr(config, "SESSION_SECRET", "test-secret")
    monkeypatch.setattr(config, "PASSWORD_HASH", "")
    monkeypatch.setattr(config, "PASSWORD_PLAINTEXT", TEST_PASSWORD)
    monkeypatch.setattr(config, "COOKIE_SECURE", False)
    return TEST_PASSWORD


@pytest.fixture()
def authed_client(auth_enabled) -> TestClient:
    """A TestClient with auth enabled and a valid session cookie."""
    test_client = TestClient(app, raise_server_exceptions=False)
    resp = test_client.post(
        "/api/v1/auth/login", json={"password": auth_enabled, "remember": False}
    )
    assert resp.status_code == 200
    return test_client


@pytest.fixture()
def create_list(client) -> Callable[..., dict[str, Any]]:
    """Factory fixture that creates a list via the API and returns the response JSON."""

    def _create(name="Test List", icon="list", undo=False) -> dict[str, Any]:
        """Create a list via the API and return its JSON body."""
        resp = client.post("/api/v1/lists", json={"name": name, "icon": icon, "undo": undo})
        assert resp.status_code == 200
        return resp.json()

    return _create


@pytest.fixture()
def create_item(client) -> Callable[..., dict[str, Any]]:
    """Factory fixture that creates an item via the API and returns the response JSON."""

    def _create(list_id, text="Test Item", undo=False) -> dict[str, Any]:
        """Create an item in the given list via the API and return its JSON body."""
        resp = client.post(f"/api/v1/lists/{list_id}/items", json={"text": text, "undo": undo})
        assert resp.status_code == 200
        return resp.json()

    return _create
