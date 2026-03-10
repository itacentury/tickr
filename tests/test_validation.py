"""Tests for structured error response format across all endpoints."""


class TestValidationErrorFormat:
    """Tests for 422 validation error structure."""

    def test_validation_error_format(self, client):
        """422 responses have code=VALIDATION_ERROR and a details array."""
        resp = client.post("/api/v1/lists", json={})
        assert resp.status_code == 422
        error = resp.json()["error"]
        assert error["code"] == "VALIDATION_ERROR"
        assert error["status"] == 422
        assert isinstance(error["details"], list)
        assert len(error["details"]) > 0

    def test_validation_error_detail_fields(self, client):
        """Each validation detail has field, message, and type."""
        resp = client.post("/api/v1/lists", json={})
        detail = resp.json()["error"]["details"][0]
        assert "field" in detail
        assert "message" in detail
        assert "type" in detail


class TestAppErrorFormat:
    """Tests for application-level error structure."""

    def test_app_error_format(self, client):
        """400/404 errors have code, message, and status in the error object."""
        resp = client.put(
            "/api/v1/items/00000000-0000-0000-0000-000000000000",
            json={"text": "nope"},
        )
        assert resp.status_code == 404
        error = resp.json()["error"]
        assert error["code"] == "ITEM_NOT_FOUND"
        assert "message" in error
        assert error["status"] == 404


class TestUnknownRoute:
    """Tests for requests to nonexistent paths."""

    def test_unknown_route(self, client):
        """Nonexistent API path returns 404."""
        resp = client.get("/api/v1/nonexistent")
        assert resp.status_code == 404
