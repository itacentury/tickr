"""Tests for the auth middleware: protected routes vs. public exemptions."""

import pytest
from fastapi.testclient import TestClient

from backend.main import app


@pytest.fixture()
def unauth_client(auth_enabled):
    """Auth enabled, but no session cookie."""
    return TestClient(app, raise_server_exceptions=False)


def test_protected_route_requires_session(unauth_client):
    resp = unauth_client.get("/api/v1/lists")
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "UNAUTHORIZED"


def test_metrics_is_protected(unauth_client):
    resp = unauth_client.get("/api/v1/metrics")
    assert resp.status_code == 401


def test_metrics_reachable_with_session(authed_client):
    resp = authed_client.get("/api/v1/metrics")
    assert resp.status_code == 200


@pytest.mark.parametrize(
    "path",
    [
        "/",
        "/api/v1/health",
        "/manifest.json",
        "/sw.js",
        "/assets/anything.js",
        "/icons/favicon.ico",
    ],
)
def test_public_paths_are_not_blocked(unauth_client, path):
    # The file may or may not exist in the test env, but it must never be a 401.
    resp = unauth_client.get(path)
    assert resp.status_code != 401


def test_login_endpoint_reachable_without_session(unauth_client):
    # A correct password must succeed even without a prior session, proving the
    # login endpoint itself is exempt from the middleware.
    from tests.conftest import TEST_PASSWORD

    ok = unauth_client.post("/api/v1/auth/login", json={"password": TEST_PASSWORD})
    assert ok.status_code == 200


def test_routes_open_when_auth_disabled(client):
    # Default config: AUTH_ENABLED is false → no gating.
    resp = client.get("/api/v1/lists")
    assert resp.status_code == 200
