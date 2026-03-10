"""Tests for health check and metrics endpoints."""

from unittest.mock import patch


class TestHealthCheck:
    """Tests for GET /api/v1/health."""

    @patch("backend.routes.monitoring.DATABASE", ":memory:")
    def test_health_check(self, client):
        """Health endpoint returns healthy status with database ok."""
        resp = client.get("/api/v1/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "healthy"
        assert data["database"] == "ok"

    @patch("backend.routes.monitoring.DATABASE", ":memory:")
    def test_health_check_connections(self, client):
        """Health response includes the connections sub-object."""
        resp = client.get("/api/v1/health")
        conns = resp.json()["connections"]
        assert "sse_legacy" in conns
        assert "sse_sync" in conns
        assert "sse_max" in conns


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
