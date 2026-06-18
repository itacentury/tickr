"""Sync/SSE routes must be gated by auth when it is enabled."""

import pytest
from fastapi.testclient import TestClient

from backend.main import app


@pytest.fixture()
def unauth_client(auth_enabled) -> TestClient:
    """Auth enabled, but no session cookie."""
    return TestClient(app, raise_server_exceptions=False)


def test_sync_pull_requires_session(unauth_client) -> None:
    """Sync pull is rejected with 401 when no session is present."""
    resp = unauth_client.get("/api/v1/sync/lists/pull")
    assert resp.status_code == 401


def test_sync_push_requires_session(unauth_client) -> None:
    """Sync push is rejected with 401 when no session is present."""
    resp = unauth_client.post("/api/v1/sync/lists/push", json=[])
    assert resp.status_code == 401


def test_sync_pull_works_with_session(authed_client) -> None:
    """Sync pull succeeds and returns documents for an authenticated client."""
    resp = authed_client.get("/api/v1/sync/lists/pull")
    assert resp.status_code == 200
    assert "documents" in resp.json()
