"""Shared test fixtures for Tickr API tests."""

import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend.database import get_db, init_db
from backend.main import app, rate_limit_store


@pytest.fixture()
def db_connection():
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
def db(db_connection):
    """Override get_db to yield the per-test in-memory connection."""

    def override_get_db():
        yield db_connection

    app.dependency_overrides[get_db] = override_get_db
    yield db_connection
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def clear_rate_limits():
    """Reset the rate limit store before each test."""
    rate_limit_store.clear()


@pytest.fixture()
def client():
    """Provide a TestClient that returns HTTP error responses instead of raising."""
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture()
def create_list(client):
    """Factory fixture that creates a list via the API and returns the response JSON."""

    def _create(name="Test List", icon="list", undo=False):
        resp = client.post("/api/v1/lists", json={"name": name, "icon": icon, "undo": undo})
        assert resp.status_code == 200
        return resp.json()

    return _create


@pytest.fixture()
def create_item(client):
    """Factory fixture that creates an item via the API and returns the response JSON."""

    def _create(list_id, text="Test Item", undo=False):
        resp = client.post(f"/api/v1/lists/{list_id}/items", json={"text": text, "undo": undo})
        assert resp.status_code == 200
        return resp.json()

    return _create
