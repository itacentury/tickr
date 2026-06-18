"""Tests for the auth endpoints: login, logout, and /me."""

from fastapi.testclient import TestClient

from backend.auth import SESSION_COOKIE_NAME
from backend.main import app
from tests.conftest import TEST_PASSWORD


def test_login_success_sets_cookie(auth_enabled) -> None:
    """A correct password returns authed=True and sets the session cookie."""
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post("/api/v1/auth/login", json={"password": TEST_PASSWORD})
    assert resp.status_code == 200
    assert resp.json() == {"authed": True}
    assert SESSION_COOKIE_NAME in resp.cookies


def test_login_wrong_password_returns_401(auth_enabled) -> None:
    """A wrong password returns 401 UNAUTHORIZED and sets no cookie."""
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post("/api/v1/auth/login", json={"password": "nope"})
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "UNAUTHORIZED"
    assert SESSION_COOKIE_NAME not in resp.cookies


def test_login_remember_sets_max_age(auth_enabled) -> None:
    """Logging in with remember=True sets a 30-day cookie Max-Age."""
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post("/api/v1/auth/login", json={"password": TEST_PASSWORD, "remember": True})
    assert resp.status_code == 200
    set_cookie = resp.headers["set-cookie"]
    assert "Max-Age=2592000" in set_cookie  # 30 days


def test_login_without_remember_has_no_max_age(auth_enabled) -> None:
    """Logging in with remember=False yields a session cookie without Max-Age."""
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post("/api/v1/auth/login", json={"password": TEST_PASSWORD, "remember": False})
    assert resp.status_code == 200
    assert "Max-Age" not in resp.headers["set-cookie"]


def test_logout_clears_cookie(authed_client) -> None:
    """Logout returns authed=False and the following /me reports no session."""
    resp = authed_client.post("/api/v1/auth/logout")
    assert resp.status_code == 200
    assert resp.json() == {"authed": False}
    # After logout the session is gone.
    me = authed_client.get("/api/v1/auth/me")
    assert me.json() == {"authed": False, "enabled": True}


def test_me_reports_true_when_authenticated(authed_client) -> None:
    """/me reports authed=True, enabled=True for a logged-in client."""
    resp = authed_client.get("/api/v1/auth/me")
    assert resp.status_code == 200
    assert resp.json() == {"authed": True, "enabled": True}


def test_me_reports_false_without_session(auth_enabled) -> None:
    """/me reports authed=False, enabled=True when auth is on but no session exists."""
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/api/v1/auth/me")
    assert resp.status_code == 200
    assert resp.json() == {"authed": False, "enabled": True}


def test_me_reports_enabled_false_when_auth_disabled(client) -> None:
    """/me reports authed=True, enabled=False when auth is globally disabled."""
    # Default config: AUTH_ENABLED is false, so everyone is authed but the
    # client can tell the gate is off (and hide the logout control).
    resp = client.get("/api/v1/auth/me")
    assert resp.status_code == 200
    assert resp.json() == {"authed": True, "enabled": False}
