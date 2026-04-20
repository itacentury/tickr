"""Tests for path normalization fast-path and percentile snapshot cache."""

import time

import pytest

from backend.metrics import MetricsCollector


@pytest.fixture()
def collector():
    """Fresh MetricsCollector per test so cache state doesn't leak."""
    return MetricsCollector(max_samples=1_000)


class TestPathNormalization:
    """Fast-path and regex behaviour for _normalize_path."""

    @pytest.mark.parametrize(
        "path",
        [
            "/api/v1/health",
            "/api/v1/metrics",
            "/api/v1/events",
            "/api/v1/sync/stream",
        ],
    )
    def test_known_fast_paths_pass_through(self, path):
        """The known-static monitoring/SSE paths are returned verbatim."""
        assert MetricsCollector._normalize_path(path) == path

    def test_dash_free_path_skips_regex(self):
        """Paths without '-' and without '/static/' skip the regex entirely."""
        assert MetricsCollector._normalize_path("/api/v1/settings") == "/api/v1/settings"
        assert MetricsCollector._normalize_path("/api/v1/lists") == "/api/v1/lists"

    def test_uuid_is_collapsed(self):
        """A UUID segment is replaced by '{id}' for cardinality control."""
        uuid_path = "/api/v1/lists/550e8400-e29b-41d4-a716-446655440000/items"
        assert MetricsCollector._normalize_path(uuid_path) == "/api/v1/lists/{id}/items"

    def test_static_filename_is_collapsed(self):
        """Static file tails are replaced by '{file}'."""
        assert MetricsCollector._normalize_path("/static/app.js") == "/static/{file}"


class TestPercentileCache:
    """The percentile snapshot is served from cache within the TTL."""

    def test_cache_hit_returns_same_snapshot(self, collector):
        """A second call within the TTL reuses the first call's sample count."""
        for i in range(10):
            collector.record("GET", "/api/v1/settings", 200, float(i))

        first = collector.get_percentiles()
        # New record should NOT invalidate the cache
        collector.record("GET", "/api/v1/settings", 200, 999.0)
        second = collector.get_percentiles()

        assert first["sample_count"] == second["sample_count"]
        assert first["max_ms"] == second["max_ms"]

    def test_cache_invalidates_after_ttl(self, collector, monkeypatch):
        """Past the TTL the snapshot is recomputed and reflects new samples."""
        for i in range(10):
            collector.record("GET", "/api/v1/settings", 200, float(i))

        first = collector.get_percentiles()

        # Jump monotonic forward past the cache TTL
        original_monotonic = time.monotonic
        offset = 5.0
        monkeypatch.setattr(time, "monotonic", lambda: original_monotonic() + offset)
        collector.record("GET", "/api/v1/settings", 200, 42.0)

        second = collector.get_percentiles()
        assert second["sample_count"] == first["sample_count"] + 1

    def test_different_window_bypasses_cache(self, collector):
        """Requesting a different window recomputes rather than returning the cached one."""
        for i in range(5):
            collector.record("GET", "/api/v1/settings", 200, float(i))

        snap_300 = collector.get_percentiles(window_seconds=300)
        snap_60 = collector.get_percentiles(window_seconds=60)
        assert snap_300["window_seconds"] == 300
        assert snap_60["window_seconds"] == 60
