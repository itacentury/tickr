"""Tests for rate limiting and security headers middleware."""

import logging
import time

from fastapi.testclient import TestClient

import backend.main as main_module
from backend.main import RATE_LIMIT_REQUESTS, app, rate_limit_store


class TestRateLimit:
    """Tests for the rate_limit_middleware in backend.main."""

    def test_rate_limit_allows_normal_traffic(self, client):
        """Requests under the limit succeed with 200."""
        resp = client.get("/api/v1/settings")
        assert resp.status_code == 200

    def test_rate_limit_returns_429(self, client):
        """Exceeding the limit returns 429 with RATE_LIMITED error code."""
        # Fill the store with timestamps all within the current window
        now = time.time()
        rate_limit_store["testclient"] = [now] * RATE_LIMIT_REQUESTS

        resp = client.get("/api/v1/settings")
        assert resp.status_code == 429
        assert resp.json()["error"]["code"] == "RATE_LIMITED"

    def test_rate_limit_excludes_sse_paths(self):
        """SSE, health, and metrics paths bypass rate limiting."""
        now = time.time()
        rate_limit_store.clear()
        rate_limit_store["testclient"] = [now] * RATE_LIMIT_REQUESTS

        c = TestClient(app, raise_server_exceptions=False)
        for path in ["/api/v1/health", "/api/v1/metrics"]:
            resp = c.get(path)
            # These should NOT be 429 since they're exempt
            assert resp.status_code != 429, f"{path} should be exempt from rate limiting"

    def test_rate_limit_excludes_static_shell(self):
        """The app shell and PWA assets stay reachable even when rate limited."""
        now = time.time()
        rate_limit_store.clear()
        rate_limit_store["testclient"] = [now] * RATE_LIMIT_REQUESTS

        c = TestClient(app, raise_server_exceptions=False)
        for path in ["/", "/sw.js", "/manifest.json"]:
            resp = c.get(path)
            assert resp.status_code != 429, f"{path} should be exempt from rate limiting"

    def test_rate_limit_retry_after_header(self, client):
        """429 response includes a Retry-After header."""
        now = time.time()
        rate_limit_store["testclient"] = [now] * RATE_LIMIT_REQUESTS

        resp = client.get("/api/v1/settings")
        assert resp.status_code == 429
        assert "retry-after" in resp.headers

    def test_store_evicts_stale_entries_when_over_max(self, client, monkeypatch):
        """Stale IPs are removed when the store exceeds the max size."""
        monkeypatch.setattr(main_module, "RATE_LIMIT_MAX_IPS", 3)
        rate_limit_store.clear()

        stale_time = time.time() - 120  # well outside the window
        for i in range(5):
            rate_limit_store[f"stale-{i}"] = [stale_time]

        resp = client.get("/api/v1/settings")
        assert resp.status_code == 200
        # Stale entries should be evicted; only the requesting client remains
        assert len(rate_limit_store) <= 3

    def test_store_evicts_oldest_when_all_active(self, client, monkeypatch):
        """When all IPs are active, the oldest are evicted to stay under the cap."""
        monkeypatch.setattr(main_module, "RATE_LIMIT_MAX_IPS", 3)
        rate_limit_store.clear()

        now = time.time()
        for i in range(5):
            rate_limit_store[f"active-{i}"] = [now - 10 + i]

        resp = client.get("/api/v1/settings")
        assert resp.status_code == 200
        assert len(rate_limit_store) <= 3

    def test_request_tracked_when_eviction_triggered(self, client, monkeypatch):
        """Regression: the current client's request must be tracked even when its
        filtered timestamps are empty and eviction runs in the same request."""
        monkeypatch.setattr(main_module, "RATE_LIMIT_MAX_IPS", 3)
        rate_limit_store.clear()

        stale_time: float = time.time() - 120  # outside the window
        # Pre-seed the current client with only stale timestamps so the filter
        # leaves an empty list — this is the condition that used to trigger the bug.
        rate_limit_store["testclient"] = [stale_time]
        for i in range(4):
            rate_limit_store[f"other-{i}"] = [stale_time]

        resp = client.get("/api/v1/settings")
        assert resp.status_code == 200
        # The request must be tracked: testclient entry is present and has the new timestamp.
        assert "testclient" in rate_limit_store
        assert len(rate_limit_store["testclient"]) == 1

    def test_store_no_eviction_under_max(self, client, monkeypatch):
        """No eviction occurs when the store is under the max size."""
        monkeypatch.setattr(main_module, "RATE_LIMIT_MAX_IPS", 100)
        rate_limit_store.clear()

        now = time.time()
        for i in range(5):
            rate_limit_store[f"ip-{i}"] = [now]

        resp = client.get("/api/v1/settings")
        assert resp.status_code == 200
        # All 5 original IPs + the test client should still be present
        assert len(rate_limit_store) >= 5


class TestAccessLog:
    """Tests for the merged access_log_and_metrics_middleware."""

    def test_rate_limited_requests_are_access_logged(self, client, caplog):
        """A 429 from the rate limiter must still appear in the access log."""
        now = time.time()
        rate_limit_store["testclient"] = [now] * RATE_LIMIT_REQUESTS

        with caplog.at_level(logging.INFO, logger="backend.main"):
            resp = client.get("/api/v1/settings")

        assert resp.status_code == 429
        matching = [
            rec
            for rec in caplog.records
            if rec.name == "backend.main"
            and "/api/v1/settings" in rec.getMessage()
            and "429" in rec.getMessage()
        ]
        assert matching, "Expected a backend.main log record for the 429 response"

    def test_successful_requests_are_access_logged(self, client, caplog):
        """Normal 2xx traffic is logged with method, path, status, and duration."""
        with caplog.at_level(logging.INFO, logger="backend.main"):
            resp = client.get("/api/v1/settings")

        assert resp.status_code == 200
        matching = [
            rec
            for rec in caplog.records
            if rec.name == "backend.main"
            and "GET" in rec.getMessage()
            and "/api/v1/settings" in rec.getMessage()
        ]
        assert matching, "Expected access log record for successful request"


class TestSecurityHeaders:
    """Tests for the security_headers_middleware in backend.main."""

    def test_security_headers_present(self, client):
        """Every response includes required security headers."""
        resp = client.get("/api/v1/settings")
        assert "content-security-policy" in resp.headers
        assert resp.headers["x-content-type-options"] == "nosniff"
        assert resp.headers["x-frame-options"] == "DENY"
        assert "referrer-policy" in resp.headers
        assert "permissions-policy" in resp.headers

    def test_hsts_absent_on_http(self, client):
        """HSTS must not be emitted over plain HTTP."""
        resp = client.get("/api/v1/settings")
        assert "strict-transport-security" not in resp.headers

    def test_hsts_present_on_https(self):
        """HSTS is emitted when the request arrives over HTTPS."""
        https_client = TestClient(app, base_url="https://testserver", raise_server_exceptions=False)
        resp = https_client.get("/api/v1/settings")
        assert resp.headers["strict-transport-security"] == ("max-age=31536000; includeSubDomains")
