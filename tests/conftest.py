"""Shared test fixtures for Tickr API tests."""

import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend.database import get_db
from backend.main import app, rate_limit_store


@pytest.fixture(scope="session")
def db_connection():
    """Create an in-memory SQLite database with all tables for the test session."""
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")

    conn.executescript("""
        CREATE TABLE lists (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            icon TEXT DEFAULT 'list',
            item_sort TEXT DEFAULT 'alphabetical',
            sort_order INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            _deleted INTEGER DEFAULT 0
        );

        CREATE TABLE items (
            id TEXT PRIMARY KEY,
            list_id TEXT NOT NULL,
            text TEXT NOT NULL,
            completed INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            completed_at TEXT,
            _deleted INTEGER DEFAULT 0,
            FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE
        );

        CREATE TABLE history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            list_id TEXT NOT NULL,
            item_id TEXT,
            action TEXT NOT NULL,
            item_text TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE
        );

        CREATE TABLE settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        INSERT INTO settings (key, value) VALUES ('list_sort', 'alphabetical');
    """)

    yield conn
    conn.close()


@pytest.fixture(autouse=True)
def db(db_connection):
    """Override get_db to use the shared in-memory connection and clean up after each test."""

    def override_get_db():
        yield db_connection

    app.dependency_overrides[get_db] = override_get_db
    yield db_connection

    # Clean all tables after each test
    db_connection.execute("DELETE FROM history")
    db_connection.execute("DELETE FROM items")
    db_connection.execute("DELETE FROM lists")
    db_connection.execute("DELETE FROM settings")
    db_connection.execute("INSERT INTO settings (key, value) VALUES ('list_sort', 'alphabetical')")
    db_connection.commit()

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
