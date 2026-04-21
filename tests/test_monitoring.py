"""Tests for health check and metrics endpoints."""

import sqlite3

from backend.database import get_db
from backend.main import app


class TestHealthCheck:
    """Tests for GET /api/v1/health."""

    def test_health_check(self, client):
        """Health endpoint returns healthy status with database ok."""
        resp = client.get("/api/v1/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "healthy"
        assert data["database"] == "ok"

    def test_health_check_connections(self, client):
        """Health response includes the connections sub-object."""
        resp = client.get("/api/v1/health")
        conns = resp.json()["connections"]
        assert "sse_legacy" in conns
        assert "sse_sync" in conns
        assert "sse_max" in conns

    def test_health_check_db_failure_returns_503(self, client):
        """A broken DB dependency surfaces as 503 SERVICE_UNAVAILABLE."""

        def broken_db():
            conn = sqlite3.connect(":memory:")
            conn.close()  # closed before the handler runs — SELECT 1 fails
            yield conn

        app.dependency_overrides[get_db] = broken_db
        try:
            resp = client.get("/api/v1/health")
            assert resp.status_code == 503
            assert resp.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
        finally:
            app.dependency_overrides.pop(get_db, None)


class TestMetrics:
    """Tests for GET /api/v1/metrics."""

    def test_metrics_snapshot(self, client):
        """Metrics endpoint returns a dict with expected top-level keys."""
        resp = client.get("/api/v1/metrics")
        assert resp.status_code == 200
        data = resp.json()
        assert "uptime_seconds" in data
        assert "requests" in data
        assert "response_times" in data
        assert "connections" in data
