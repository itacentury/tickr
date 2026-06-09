"""Tests for path normalization fast-path and percentile snapshot cache."""

import time

import pytest

from backend.metrics import MetricsCollector, SyncMetrics


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


class TestSnapshot:
    """Windowed snapshot aggregation, traffic series, and trend deltas."""

    def test_windowed_aggregation(self, collector):
        """Requests aggregate into windowed totals and per-method/status breakdowns."""
        for _ in range(5):
            collector.record("GET", "/api/v1/settings", 200, 10.0)
        collector.record("POST", "/api/v1/auth/login", 500, 50.0)

        snap = collector.get_snapshot(3600)
        assert snap["window_seconds"] == 3600
        assert snap["requests"]["total"] == 6
        assert snap["requests"]["by_method"]["GET"] == 5
        assert snap["requests"]["by_status"]["500"] == 1
        assert snap["error_count"] == 1

    def test_last_error_recorded(self, collector):
        """The most recent 4xx/5xx request surfaces as last_error."""
        collector.record("GET", "/api/v1/settings", 200, 5.0)
        collector.record("POST", "/api/v1/auth/login", 401, 30.0)

        snap = collector.get_snapshot(3600)
        assert snap["last_error"]["status"] == 401
        assert snap["last_error"]["path"] == "/api/v1/auth/login"
        assert "ago_seconds" in snap["last_error"]

    def test_traffic_series_length(self, collector):
        """The traffic series always has a fixed number of downsampled points."""
        collector.record("GET", "/api/v1/settings", 200, 5.0)
        snap = collector.get_snapshot(3600)
        assert len(snap["traffic"]["points"]) == 48
        assert snap["traffic"]["peak_value"] >= 1

    def test_delta_flat_without_previous_window(self, collector):
        """With no prior window, deltas report flat rather than a misleading spike."""
        collector.record("GET", "/api/v1/settings", 200, 5.0)
        snap = collector.get_snapshot(3600)
        assert snap["kpis"]["total"]["direction"] == "flat"
        assert snap["kpis"]["total"]["pct"] is None

    def test_snapshot_has_all_sections(self, collector):
        """The snapshot exposes every dashboard section."""
        collector.record("GET", "/api/v1/settings", 200, 5.0)
        snap = collector.get_snapshot(86_400)
        for key in (
            "kpis",
            "traffic",
            "response_times",
            "latency_histogram",
            "endpoints",
            "connections",
            "sync",
            "system",
        ):
            assert key in snap


class TestEndpointStats:
    """Per-endpoint count, p95, errors, and dominant method."""

    def test_endpoint_aggregation(self, collector):
        """Each endpoint reports its request count, dominant method, and error count."""
        for _ in range(3):
            collector.record("GET", "/api/v1/lists", 200, 5.0)
        collector.record("POST", "/api/v1/settings", 500, 80.0)

        rows = {r["path"]: r for r in collector.get_endpoint_stats(3600)}
        assert rows["/api/v1/lists"]["count"] == 3
        assert rows["/api/v1/lists"]["method"] == "GET"
        assert rows["/api/v1/lists"]["errors"] == 0
        assert rows["/api/v1/settings"]["errors"] == 1

    def test_static_assets_grouped_into_single_row(self, collector):
        """Static asset paths collapse into one STAT row, dynamic endpoints stay separate."""
        for path in ("/", "/", "/sw.js", "/assets/index-abc.js", "/icons/x.png"):
            collector.record("GET", path, 200, 3.0)
        collector.record("GET", "/api/v1/settings", 200, 5.0)

        rows = {r["path"]: r for r in collector.get_endpoint_stats(3600)}
        stat_rows = [r for r in rows.values() if r["method"] == "STAT"]
        assert len(stat_rows) == 1
        assert stat_rows[0]["count"] == 5
        assert "/api/v1/settings" in rows
        assert not any(p.startswith(("/assets/", "/icons/")) for p in rows)


class TestLatencyHistogram:
    """Windowed response-time histogram binning."""

    def test_histogram_bins(self, collector):
        """All samples in the window are distributed across the fixed bins."""
        for d in (1.0, 2.0, 3.0, 100.0):
            collector.record("GET", "/api/v1/settings", 200, d)
        hist = collector.get_latency_histogram(3600)
        assert len(hist["bins"]) == 14
        assert sum(hist["bins"]) == 4


class TestSyncMetrics:
    """Sync activity counters."""

    def test_pull_and_push_counters(self):
        """Pulls and pushes accumulate, conflicts are tracked, last sync is set."""
        sm = SyncMetrics()
        sm.record_pull(5)
        sm.record_push(3, 1)
        snap = sm.snapshot()
        assert snap["items_pulled"] == 5
        assert snap["items_pushed"] == 3
        assert snap["conflicts_resolved"] == 1
        assert snap["last_sync_ago_seconds"] is not None

    def test_empty_pull_does_not_set_last_sync(self):
        """Empty pulls (frequent RxDB polls) must not advance last_sync."""
        sm = SyncMetrics()
        sm.record_pull(0)
        snap = sm.snapshot()
        assert snap["items_pulled"] == 0
        assert snap["last_sync_ago_seconds"] is None
