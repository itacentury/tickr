"""Tests for frontend error reporting endpoint."""

import logging


class TestReportError:
    """Tests for POST /api/v1/errors."""

    def test_report_error(self, client):
        """Full error report with all fields returns 204."""
        resp = client.post(
            "/api/v1/errors",
            json={
                "message": "TypeError: Cannot read properties of null",
                "stack": "at App.render (app.js:42)",
                "action": "addItem",
                "user_agent": "Mozilla/5.0",
                "timestamp": "2025-01-15T10:30:00",
            },
        )
        assert resp.status_code == 204

    def test_report_error_minimal(self, client):
        """Minimal report with only required fields (message, action) returns 204."""
        resp = client.post(
            "/api/v1/errors",
            json={"message": "Something went wrong", "action": "loadLists"},
        )
        assert resp.status_code == 204

    def test_report_error_validation(self, client):
        """Missing required fields returns 422."""
        resp = client.post("/api/v1/errors", json={"message": "no action"})
        assert resp.status_code == 422

    def test_report_error_logs_at_warning_level(self, client, caplog):
        """Frontend error reports log at WARNING to avoid flooding ERROR pipelines."""
        with caplog.at_level(logging.WARNING, logger="backend.routes.errors"):
            client.post(
                "/api/v1/errors",
                json={"message": "boom", "action": "click"},
            )
        matching = [
            rec
            for rec in caplog.records
            if rec.name == "backend.routes.errors" and "Frontend error" in rec.getMessage()
        ]
        assert matching, "Expected a WARNING log record for the frontend error report"
        assert all(rec.levelno == logging.WARNING for rec in matching)
