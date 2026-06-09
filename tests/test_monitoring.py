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
        assert isinstance(data["list_count"], int)
        assert "timestamp" in data

    def test_health_check_connections(self, client):
        """Health response includes the connections sub-object."""
        resp = client.get("/api/v1/health")
        conns = resp.json()["connections"]
        assert "sse_legacy" in conns
        assert "sse_sync" in conns
        assert "sse_max" in conns

    def test_health_check_db_failure_returns_503(self, client):
        """A broken DB dependency surfaces as 503 unhealthy."""

        def broken_db():
            conn = sqlite3.connect(":memory:")
            conn.close()  # closed before the handler runs — query fails
            yield conn

        app.dependency_overrides[get_db] = broken_db
        try:
            resp = client.get("/api/v1/health")
            assert resp.status_code == 503
            body = resp.json()
            assert body["status"] == "unhealthy"
            assert body["database"].startswith("database_error:")
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

    def test_metrics_snapshot_extended_sections(self, client):
        """The dashboard snapshot includes every observability section."""
        data = client.get("/api/v1/metrics").json()
        for key in (
            "kpis",
            "traffic",
            "latency_histogram",
            "endpoints",
            "sync",
            "system",
            "version",
        ):
            assert key in data

    def test_metrics_valid_window(self, client):
        """A supported window preset is honored."""
        data = client.get("/api/v1/metrics?window=3600").json()
        assert data["window_seconds"] == 3600

    def test_metrics_invalid_window_falls_back(self, client):
        """An unsupported window falls back to the default rather than erroring."""
        resp = client.get("/api/v1/metrics?window=999")
        assert resp.status_code == 200
        assert resp.json()["window_seconds"] == 86_400
