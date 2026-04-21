"""Tests for the reverse-proxy trust configuration (item #27)."""

import importlib


class TestTrustedProxiesConfig:
    """Tests for TICKR_TRUSTED_PROXIES handling in backend.config."""

    def test_default_is_loopback(self, monkeypatch):
        """When the env var is unset, the default is 127.0.0.1."""
        monkeypatch.delenv("TICKR_TRUSTED_PROXIES", raising=False)
        import backend.config as config_module

        reloaded = importlib.reload(config_module)
        assert reloaded.TRUSTED_PROXIES == "127.0.0.1"

    def test_env_override_is_read(self, monkeypatch):
        """An explicit env value replaces the default."""
        monkeypatch.setenv("TICKR_TRUSTED_PROXIES", "10.0.0.1,10.0.0.2")
        import backend.config as config_module

        reloaded = importlib.reload(config_module)
        assert reloaded.TRUSTED_PROXIES == "10.0.0.1,10.0.0.2"
        # Reset back to process default so later tests see the original value
        monkeypatch.delenv("TICKR_TRUSTED_PROXIES", raising=False)
        importlib.reload(config_module)

    def test_forwarded_header_not_trusted_in_testclient(self, client):
        """TestClient bypasses uvicorn flags, so a forged X-Forwarded-For is ignored.

        Documents the limitation that we cannot exercise `--proxy-headers`
        through FastAPI's TestClient. End-to-end verification of the flag
        must run against a real uvicorn instance.
        """
        resp = client.get(
            "/api/v1/health",
            headers={"X-Forwarded-For": "198.51.100.42"},
        )
        # Still a 200 regardless of header — this is only here to assert
        # no middleware crashes when the header is present.
        assert resp.status_code == 200
