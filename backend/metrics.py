"""In-memory request metrics with time-bucketed aggregation, percentiles, and per-endpoint stats.

The collector keeps two complementary stores, both bounded:

* A ring of one-minute *buckets* (counts, status/method breakdowns, latency sums) used for
  windowed totals, the traffic time series, sparklines, and trend deltas.
* A bounded deque of recent ``(timestamp, duration_ms)`` samples used for percentile and
  histogram computation, plus per-endpoint sample deques for the top-endpoints table.

Everything is guarded by a single lock; the public read methods accept a ``window_seconds``
argument so the API can serve 1h / 24h / 7d views from the same data.
"""

import re
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from pathlib import Path
from threading import Lock
from typing import Any

from .config import DATABASE, MAX_SSE_CLIENTS
from .events import get_connection_counts

try:  # System stats are best-effort: degrade gracefully if psutil is unavailable.
    import psutil

    _PROCESS: "psutil.Process | None" = psutil.Process()
except Exception:  # pragma: no cover - exercised only when psutil is missing
    psutil = None  # type: ignore[assignment]
    _PROCESS = None

# Matches UUID v4 segments in URL paths
_UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)

# Matches trailing filename segments (e.g. /static/app.js)
_STATIC_FILE_RE = re.compile(r"(/static/).*")

# Static-asset routes collapsed into a single endpoints-table row (mirrors the public
# static rules in main.py; kept local to avoid a main -> metrics import cycle).
_STATIC_PREFIXES: tuple[str, ...] = ("/assets/", "/static/", "/icons/")
_STATIC_EXACT: frozenset[str] = frozenset({"/", "/manifest.json", "/sw.js"})


def _is_static_path(path: str) -> bool:
    """Return whether a path is a static asset that should be grouped in the table."""
    return path in _STATIC_EXACT or path.startswith(_STATIC_PREFIXES)


# Paths hit most frequently that never carry dynamic segments — skip regex entirely.
# Keep this list tight: only paths that are guaranteed dynamic-free belong here.
# For everything else the cheap `"-" not in path` prefilter handles the common case.
_FAST_PATHS: frozenset[str] = frozenset(
    {
        "/api/v1/health",
        "/api/v1/metrics",
        "/api/v1/events",
        "/api/v1/sync/stream",
    }
)

# How long a computed percentile snapshot may be served from cache.
_PERCENTILE_CACHE_TTL: float = 1.0

# Time-window presets accepted by the API (seconds): 1h / 24h / 7d.
WINDOW_OPTIONS: frozenset[int] = frozenset({3600, 86_400, 604_800})
DEFAULT_WINDOW: int = 86_400

_BUCKET_SECONDS: int = 60
_BUCKET_RETENTION: int = 604_800 // _BUCKET_SECONDS + 2  # ~7d of minute buckets, plus slack
_TRAFFIC_POINTS: int = 48
_SPARK_POINTS: int = 8
_HISTOGRAM_BINS: int = 14
# How many tail bins of the latency histogram to highlight as the slow tail.
_HISTOGRAM_TAIL_BINS: int = 2

_MAX_ENDPOINTS: int = 100
_ENDPOINT_SAMPLES: int = 500
_TOP_ENDPOINTS: int = 8


@dataclass
class _Bucket:
    """Aggregated counters for a single one-minute time bucket."""

    count: int = 0
    errors: int = 0
    latency_sum: float = 0.0
    latency_count: int = 0
    by_method: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    by_status: dict[str, int] = field(default_factory=lambda: defaultdict(int))


def _percentile(sorted_samples: list[float], pct: int) -> float:
    """Return the ``pct`` percentile of an already-sorted, non-empty sample list."""
    n: int = len(sorted_samples)
    idx: int = max(0, min(n - 1, n * pct // 100 - (1 if pct >= 95 else 0)))
    return round(sorted_samples[idx], 2)


class MetricsCollector:
    """Collect request counters and response time samples in memory.

    Thread-safe singleton tracking minute-bucketed request volume, status/method
    breakdowns, a bounded deque of recent response time samples for percentiles, and
    per-endpoint samples for the top-endpoints table.
    """

    def __init__(self, max_samples: int = 10_000) -> None:
        self._lock: Lock = Lock()
        self._started_at: float = time.time()
        self.total_requests: int = 0
        self.by_method: dict[str, int] = defaultdict(int)
        self.by_status: dict[str, int] = defaultdict(int)
        self.by_path: dict[str, int] = defaultdict(int)
        self._response_times: deque[tuple[float, float]] = deque(maxlen=max_samples)
        # minute-epoch -> bucket; pruned to _BUCKET_RETENTION newest entries.
        self._buckets: dict[int, _Bucket] = {}
        # normalized path -> bounded deque of (timestamp, duration_ms, status, method).
        self._endpoints: dict[str, deque[tuple[float, float, int, str]]] = {}
        self._last_error: dict[str, Any] | None = None
        # (monotonic_computed_at, window_seconds, snapshot_dict)
        self._percentile_cache: tuple[float, int, dict[str, Any]] | None = None

    def record(self, method: str, path: str, status_code: int, duration_ms: float) -> None:
        """Record a single request's metrics.

        Args:
            method: HTTP method (GET, POST, etc.).
            path: Request URL path (will be normalized).
            status_code: HTTP response status code.
            duration_ms: Request duration in milliseconds.
        """
        normalized: str = self._normalize_path(path)
        now: float = time.time()
        is_error: bool = status_code >= 400
        status_str: str = str(status_code)

        with self._lock:
            self.total_requests += 1
            self.by_method[method] += 1
            self.by_status[status_str] += 1
            self.by_path[normalized] += 1
            self._response_times.append((now, duration_ms))

            bucket: _Bucket = self._bucket_for_locked(int(now // _BUCKET_SECONDS))
            bucket.count += 1
            bucket.latency_sum += duration_ms
            bucket.latency_count += 1
            bucket.by_method[method] += 1
            bucket.by_status[status_str] += 1
            if is_error:
                bucket.errors += 1

            self._record_endpoint_locked(normalized, now, duration_ms, status_code, method)

            if is_error:
                self._last_error = {"status": status_code, "path": normalized, "at": now}

    def _bucket_for_locked(self, minute: int) -> _Bucket:
        """Return (creating if needed) the bucket for ``minute``; caller holds the lock."""
        bucket: _Bucket | None = self._buckets.get(minute)
        if bucket is None:
            bucket = _Bucket()
            self._buckets[minute] = bucket
            if len(self._buckets) > _BUCKET_RETENTION:
                oldest: int = min(self._buckets)
                del self._buckets[oldest]
        return bucket

    def _record_endpoint_locked(
        self, path: str, now: float, duration_ms: float, status: int, method: str
    ) -> None:
        """Append a per-endpoint sample; caller holds the lock."""
        samples: deque[tuple[float, float, int, str]] | None = self._endpoints.get(path)
        if samples is None:
            if len(self._endpoints) >= _MAX_ENDPOINTS:
                return  # Cardinality guard: ignore new paths once the cap is reached.
            samples = deque(maxlen=_ENDPOINT_SAMPLES)
            self._endpoints[path] = samples
        samples.append((now, duration_ms, status, method))

    @staticmethod
    def _normalize_path(path: str) -> str:
        """Collapse dynamic path segments to prevent cardinality explosion.

        Fast paths (known-static endpoints and paths without the characters that
        UUIDs or static-file routes require) short-circuit before touching the
        regexes. Otherwise UUIDs become ``{id}`` and static filenames ``{file}``.
        """
        if path in _FAST_PATHS:
            return path
        if "-" not in path and "/static/" not in path:
            return path
        path = _UUID_RE.sub("{id}", path)
        path = _STATIC_FILE_RE.sub(r"\1{file}", path)
        return path

    # ------------------------------------------------------------------ percentiles

    def get_percentiles(self, window_seconds: int = 300) -> dict[str, Any]:
        """Compute response time percentiles over a recent time window.

        Results are cached for ``_PERCENTILE_CACHE_TTL`` seconds per window so
        frequent scrapes (e.g. from Prometheus) don't re-sort the full sample
        buffer on every call.
        """
        with self._lock:
            cached: tuple[float, int, dict[str, Any]] | None = self._percentile_cache
            if (
                cached is not None
                and cached[1] == window_seconds
                and time.monotonic() - cached[0] < _PERCENTILE_CACHE_TTL
            ):
                return dict(cached[2])

            snapshot: dict[str, Any] = self._compute_percentiles_locked(window_seconds)
            self._percentile_cache = (time.monotonic(), window_seconds, snapshot)
            return dict(snapshot)

    def _windowed_samples_locked(self, window_seconds: int) -> list[float]:
        """Return response-time samples within the window; caller holds the lock."""
        cutoff: float = time.time() - window_seconds
        return [d for timestamp, d in self._response_times if timestamp > cutoff]

    def _compute_percentiles_locked(self, window_seconds: int) -> dict[str, Any]:
        """Compute percentile snapshot; caller must hold ``self._lock``."""
        samples: list[float] = self._windowed_samples_locked(window_seconds)

        if not samples:
            return {
                "p50_ms": 0,
                "p95_ms": 0,
                "p99_ms": 0,
                "min_ms": 0,
                "max_ms": 0,
                "avg_ms": 0,
                "sample_count": 0,
                "window_seconds": window_seconds,
            }

        samples.sort()
        n: int = len(samples)
        return {
            "p50_ms": round(samples[n * 50 // 100], 2),
            "p95_ms": round(samples[n * 95 // 100 - 1] if n >= 20 else samples[-1], 2),
            "p99_ms": round(samples[n * 99 // 100 - 1] if n >= 100 else samples[-1], 2),
            "min_ms": round(samples[0], 2),
            "max_ms": round(samples[-1], 2),
            "avg_ms": round(sum(samples) / n, 2),
            "sample_count": n,
            "window_seconds": window_seconds,
        }

    def get_latency_histogram(self, window_seconds: int) -> dict[str, Any]:
        """Bin windowed response times into a fixed-width histogram for visualization."""
        with self._lock:
            samples: list[float] = self._windowed_samples_locked(window_seconds)

        if not samples:
            return {
                "bins": [0] * _HISTOGRAM_BINS,
                "tail_from": _HISTOGRAM_BINS - _HISTOGRAM_TAIL_BINS,
            }

        hi: float = max(samples)
        width: float = hi / _HISTOGRAM_BINS if hi > 0 else 1.0
        bins: list[int] = [0] * _HISTOGRAM_BINS
        for value in samples:
            idx: int = min(_HISTOGRAM_BINS - 1, int(value / width))
            bins[idx] += 1
        return {"bins": bins, "tail_from": _HISTOGRAM_BINS - _HISTOGRAM_TAIL_BINS}

    # ------------------------------------------------------------------ buckets

    def _sum_buckets_locked(self, start: float, end: float) -> _Bucket:
        """Aggregate all buckets whose minute falls in ``[start, end)``; caller holds lock."""
        first: int = int(start // _BUCKET_SECONDS)
        last: int = int(end // _BUCKET_SECONDS)
        total: _Bucket = _Bucket()
        for minute, bucket in self._buckets.items():
            if first <= minute <= last:
                total.count += bucket.count
                total.errors += bucket.errors
                total.latency_sum += bucket.latency_sum
                total.latency_count += bucket.latency_count
                for method, value in bucket.by_method.items():
                    total.by_method[method] += value
                for status, value in bucket.by_status.items():
                    total.by_status[status] += value
        return total

    def _series_locked(self, start: float, end: float, points: int) -> list[int]:
        """Downsample request counts in ``[start, end)`` into ``points`` slots."""
        span: float = max(end - start, 1.0)
        slot: float = span / points
        series: list[int] = [0] * points
        first: int = int(start // _BUCKET_SECONDS)
        last: int = int(end // _BUCKET_SECONDS)
        for minute, bucket in self._buckets.items():
            if not (first <= minute <= last):
                continue
            ts: float = minute * _BUCKET_SECONDS
            idx: int = min(points - 1, max(0, int((ts - start) / slot)))
            series[idx] += bucket.count
        return series

    def _latency_series_locked(self, start: float, end: float, points: int) -> list[float]:
        """Downsample average latency in ``[start, end)`` into ``points`` slots."""
        span: float = max(end - start, 1.0)
        slot: float = span / points
        sums: list[float] = [0.0] * points
        counts: list[int] = [0] * points
        first: int = int(start // _BUCKET_SECONDS)
        last: int = int(end // _BUCKET_SECONDS)
        for minute, bucket in self._buckets.items():
            if not (first <= minute <= last) or bucket.latency_count == 0:
                continue
            ts: float = minute * _BUCKET_SECONDS
            idx: int = min(points - 1, max(0, int((ts - start) / slot)))
            sums[idx] += bucket.latency_sum
            counts[idx] += bucket.latency_count
        return [round(sums[i] / counts[i], 2) if counts[i] else 0.0 for i in range(points)]

    @staticmethod
    def _delta(current: float, previous: float) -> dict[str, Any]:
        """Build a percentage delta descriptor comparing two window totals."""
        if previous <= 0:
            return {"pct": None, "direction": "flat"}
        change: float = (current - previous) / previous * 100
        direction: str = "flat"
        if change > 1:
            direction = "up"
        elif change < -1:
            direction = "down"
        return {"pct": round(change, 1), "direction": direction}

    def get_endpoint_stats(self, window_seconds: int) -> list[dict[str, Any]]:
        """Return per-endpoint count, p95 latency, error count, and dominant method."""
        cutoff: float = time.time() - window_seconds
        with self._lock:
            snapshot: dict[str, deque[tuple[float, float, int, str]]] = dict(self._endpoints)

        rows: list[dict[str, Any]] = []
        static_durations: list[float] = []
        static_errors: int = 0
        static_count: int = 0
        for path, samples in snapshot.items():
            durations: list[float] = []
            errors: int = 0
            methods: dict[str, int] = defaultdict(int)
            for ts, duration, status, method in samples:
                if ts <= cutoff:
                    continue
                durations.append(duration)
                methods[method] += 1
                if status >= 400:
                    errors += 1
            if not durations:
                continue
            if _is_static_path(path):
                static_durations.extend(durations)
                static_errors += errors
                static_count += len(durations)
                continue
            durations.sort()
            dominant: str = max(methods, key=lambda m: methods[m])
            rows.append(
                {
                    "path": path,
                    "method": dominant,
                    "count": len(durations),
                    "p95_ms": _percentile(durations, 95),
                    "errors": errors,
                }
            )

        # Static assets collapse into one row so raw asset paths stay out of the table.
        if static_count:
            static_durations.sort()
            rows.append(
                {
                    "path": "Static assets",
                    "method": "STAT",
                    "count": static_count,
                    "p95_ms": _percentile(static_durations, 95),
                    "errors": static_errors,
                }
            )

        rows.sort(key=lambda r: r["count"], reverse=True)
        return rows[:_TOP_ENDPOINTS]

    # ------------------------------------------------------------------ snapshot

    def get_snapshot(self, window_seconds: int = DEFAULT_WINDOW) -> dict[str, Any]:
        """Build a full windowed metrics snapshot for the dashboard."""
        now: float = time.time()
        cur_start: float = now - window_seconds
        prev_start: float = now - 2 * window_seconds

        with self._lock:
            current: _Bucket = self._sum_buckets_locked(cur_start, now)
            previous: _Bucket = self._sum_buckets_locked(prev_start, cur_start)
            traffic_points: list[int] = self._series_locked(cur_start, now, _TRAFFIC_POINTS)
            spark_counts: list[int] = self._series_locked(cur_start, now, _SPARK_POINTS)
            spark_latency: list[float] = self._latency_series_locked(cur_start, now, _SPARK_POINTS)
            last_error: dict[str, Any] | None = dict(self._last_error) if self._last_error else None

        cur_avg: float = current.latency_sum / current.latency_count if current.latency_count else 0
        prev_avg: float = (
            previous.latency_sum / previous.latency_count if previous.latency_count else 0
        )
        cur_err_rate: float = current.errors / current.count * 100 if current.count else 0
        prev_err_rate: float = previous.errors / previous.count * 100 if previous.count else 0
        throughput: float = current.count / window_seconds if window_seconds else 0

        peak_value: int = max(traffic_points) if traffic_points else 0
        peak_index: int = traffic_points.index(peak_value) if peak_value else 0

        kpis: dict[str, Any] = {
            "total": {
                "value": current.count,
                "spark": spark_counts,
                **self._delta(current.count, previous.count),
            },
            "throughput": {
                "value": round(throughput, 2),
                "spark": spark_counts,
                **self._delta(current.count, previous.count),
            },
            "error_rate": {
                "value": round(cur_err_rate, 1),
                "spark": spark_counts,
                **self._delta(cur_err_rate, prev_err_rate),
            },
            "avg_response_ms": {
                "value": round(cur_avg, 1),
                "spark": spark_latency,
                **self._delta(cur_avg, prev_avg),
            },
        }

        if last_error is not None:
            last_error["ago_seconds"] = round(now - last_error.pop("at"), 1)

        return {
            "window_seconds": window_seconds,
            "uptime_seconds": round(now - self._started_at, 1),
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(self._started_at)),
            "last_error": last_error,
            "error_count": current.errors,
            "requests": {
                "total": current.count,
                "throughput_per_s": round(throughput, 2),
                "error_rate_pct": round(cur_err_rate, 1),
                "by_method": dict(current.by_method),
                "by_status": dict(current.by_status),
            },
            "kpis": kpis,
            "traffic": {
                "points": traffic_points,
                "peak_value": peak_value,
                "peak_index": peak_index,
            },
            "response_times": self.get_percentiles(window_seconds),
            "latency_histogram": self.get_latency_histogram(window_seconds),
            "endpoints": self.get_endpoint_stats(window_seconds),
            "connections": {**get_connection_counts(), "sse_max": MAX_SSE_CLIENTS},
            "sync": sync_metrics.snapshot(),
            "system": get_system_stats(),
        }


class SyncMetrics:
    """Thread-safe counters for RxDB replication activity (pull/push/conflicts)."""

    def __init__(self) -> None:
        self._lock: Lock = Lock()
        self.items_pulled: int = 0
        self.items_pushed: int = 0
        self.conflicts_resolved: int = 0
        self._last_sync_at: float | None = None

    def record_pull(self, count: int) -> None:
        """Record ``count`` documents served by a pull.

        Only non-empty pulls advance ``last_sync``; RxDB polls frequently with empty
        results, which would otherwise pin "last sync" to the present forever.
        """
        if count == 0:
            return
        with self._lock:
            self.items_pulled += count
            self._last_sync_at = time.time()

    def record_push(self, count: int, conflicts: int) -> None:
        """Record a push of ``count`` changes, ``conflicts`` of which conflicted."""
        with self._lock:
            self.items_pushed += count
            self.conflicts_resolved += conflicts
            self._last_sync_at = time.time()

    def snapshot(self) -> dict[str, Any]:
        """Return the current sync counters plus seconds since the last sync."""
        with self._lock:
            ago: float | None = (
                round(time.time() - self._last_sync_at, 1) if self._last_sync_at else None
            )
            return {
                "items_pulled": self.items_pulled,
                "items_pushed": self.items_pushed,
                "conflicts_resolved": self.conflicts_resolved,
                "last_sync_ago_seconds": ago,
            }


# Event-loop lag is sampled by a background task in the app lifespan and stored here.
_event_loop_lag_ms: float = 0.0


def set_event_loop_lag(lag_ms: float) -> None:
    """Store the most recent measured event-loop lag (called by the lifespan sampler)."""
    global _event_loop_lag_ms
    _event_loop_lag_ms = lag_ms


def _db_size_mb() -> float | None:
    """Return the SQLite database file size in MB, or None for in-memory/missing DBs."""
    if DATABASE == ":memory:":
        return None
    path: Path = Path(DATABASE)
    if not path.exists():
        return None
    return round(path.stat().st_size / 1_048_576, 1)


def get_system_stats() -> dict[str, Any]:
    """Return process memory, CPU, event-loop lag, and DB size (psutil-dependent)."""
    memory_mb: float | None = None
    cpu_pct: float | None = None
    if _PROCESS is not None:
        memory_mb = round(_PROCESS.memory_info().rss / 1_048_576, 1)
        cpu_pct = round(_PROCESS.cpu_percent(interval=None), 1)
    return {
        "memory_mb": memory_mb,
        "cpu_pct": cpu_pct,
        "event_loop_lag_ms": round(_event_loop_lag_ms, 2),
        "db_size_mb": _db_size_mb(),
    }


collector: MetricsCollector = MetricsCollector()
sync_metrics: SyncMetrics = SyncMetrics()
