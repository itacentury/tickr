"""Tests for static file endpoints and icon index caching."""

from pathlib import Path

from backend.routes import static as static_module


class TestIconIndex:
    """Tests for the cached icon index in backend.routes.static."""

    def test_icon_index_prefers_dist_over_legacy(self, tmp_path, monkeypatch) -> None:
        """When a filename exists in both dirs, the dist copy wins."""
        legacy = tmp_path / "legacy"
        dist = tmp_path / "dist"
        (legacy / "icons").mkdir(parents=True)
        (dist / "icons").mkdir(parents=True)

        shared = "shared.svg"
        (legacy / "icons" / shared).write_text("legacy")
        (dist / "icons" / shared).write_text("dist")
        (legacy / "icons" / "only-legacy.svg").write_text("x")

        monkeypatch.setattr(static_module, "LEGACY_ICON_DIR", legacy / "icons")
        monkeypatch.setattr(static_module, "DIST_DIR", dist)
        static_module._icon_index.cache_clear()

        index = static_module._icon_index()
        assert index[shared] == dist / "icons" / shared
        assert index["only-legacy.svg"] == legacy / "icons" / "only-legacy.svg"

        static_module._icon_index.cache_clear()

    def test_icon_index_missing_dirs_yields_empty(self, tmp_path, monkeypatch) -> None:
        """If neither icon dir exists, the index is empty (no crash)."""
        monkeypatch.setattr(static_module, "LEGACY_ICON_DIR", tmp_path / "nope-a")
        monkeypatch.setattr(static_module, "DIST_DIR", tmp_path / "nope-b")
        static_module._icon_index.cache_clear()

        assert static_module._icon_index() == {}

        static_module._icon_index.cache_clear()

    def test_serve_icon_404_for_missing(self, client, tmp_path, monkeypatch) -> None:
        """Unknown icon filename returns 404 ICON_NOT_FOUND."""
        monkeypatch.setattr(static_module, "LEGACY_ICON_DIR", tmp_path)
        monkeypatch.setattr(static_module, "DIST_DIR", tmp_path / "dist")
        static_module._icon_index.cache_clear()

        resp = client.get("/icons/ghost.svg")
        assert resp.status_code == 404
        assert resp.json()["error"]["code"] == "ICON_NOT_FOUND"

        static_module._icon_index.cache_clear()

    def test_serve_icon_returns_indexed_file(self, client, tmp_path, monkeypatch) -> None:
        """A known icon is served from the indexed path."""
        icons = tmp_path / "icons"
        icons.mkdir()
        target = icons / "check.svg"
        target.write_text("<svg/>")

        monkeypatch.setattr(static_module, "LEGACY_ICON_DIR", icons)
        monkeypatch.setattr(static_module, "DIST_DIR", Path("does-not-exist"))
        static_module._icon_index.cache_clear()

        resp = client.get("/icons/check.svg")
        assert resp.status_code == 200
        assert resp.text == "<svg/>"

        static_module._icon_index.cache_clear()
