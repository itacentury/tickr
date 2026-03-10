"""Tests for frontend error reporting endpoint."""


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
