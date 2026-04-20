"""In-memory request metrics collection with thread-safe counters and response time tracking."""

import re
import time
from collections import defaultdict, deque
from threading import Lock

from .config import MAX_SSE_CLIENTS
from .events import legacy_broadcaster, sync_broadcaster

# Matches UUID v4 segments in URL paths
_UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)

# Matches trailing filename segments (e.g. /static/app.js)
_STATIC_FILE_RE = re.compile(r"(/static/).*")

# Paths hit most frequently that never carry dynamic segments — skip regex entirely.
# Keep this list tight: only paths that are guaranteed dynamic-free belong here.
# For everything else the cheap `"-" not in path` prefilter handles the common case.
_FAST_PATHS = frozenset(
    {
        "/api/v1/health",
        "/api/v1/metrics",
        "/api/v1/events",
        "/api/v1/sync/stream",
    }
)

# How long a computed percentile snapshot may be served from cache.
_PERCENTILE_CACHE_TTL = 1.0


class MetricsCollector:
    """Collect request counters and response time samples in memory.

    Thread-safe singleton that tracks total requests, breakdowns by method/status/path,
    and a bounded deque of recent response time samples for percentile calculation.
    """

    def __init__(self, max_samples: int = 10_000) -> None:
        self._lock = Lock()
        self._started_at = time.time()
        self.total_requests = 0
        self.by_method: dict[str, int] = defaultdict(int)
        self.by_status: dict[str, int] = defaultdict(int)
        self.by_path: dict[str, int] = defaultdict(int)
        self._response_times: deque[tuple[float, float]] = deque(maxlen=max_samples)
        # (monotonic_computed_at, window_seconds, snapshot_dict)
        self._percentile_cache: tuple[float, int, dict] | None = None

    def record(self, method: str, path: str, status_code: int, duration_ms: float) -> None:
        """Record a single request's metrics.

        Args:
            method: HTTP method (GET, POST, etc.).
            path: Request URL path (will be normalized).
            status_code: HTTP response status code.
            duration_ms: Request duration in milliseconds.
        """
        normalized = self._normalize_path(path)
        now = time.time()

        with self._lock:
            self.total_requests += 1
            self.by_method[method] += 1
            self.by_status[str(status_code)] += 1
            self.by_path[normalized] += 1
            self._response_times.append((now, duration_ms))

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

    def get_percentiles(self, window_seconds: int = 300) -> dict:
        """Compute response time percentiles over a recent time window.

        Results are cached for ``_PERCENTILE_CACHE_TTL`` seconds per window so
        frequent scrapes (e.g. from Prometheus) don't re-sort the full sample
        buffer on every call.
        """
        with self._lock:
            cached = self._percentile_cache
            if (
                cached is not None
                and cached[1] == window_seconds
                and time.monotonic() - cached[0] < _PERCENTILE_CACHE_TTL
            ):
                return dict(cached[2])

            snapshot = self._compute_percentiles_locked(window_seconds)
            self._percentile_cache = (time.monotonic(), window_seconds, snapshot)
            return dict(snapshot)

    def _compute_percentiles_locked(self, window_seconds: int) -> dict:
        """Compute percentile snapshot; caller must hold ``self._lock``."""
        cutoff = time.time() - window_seconds
        samples = [d for ts, d in self._response_times if ts > cutoff]

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
        n = len(samples)
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

    def get_snapshot(self) -> dict:
        """Build a full metrics snapshot including request counters, percentiles, and SSE gauges."""
        now = time.time()

        with self._lock:
            requests = {
                "total": self.total_requests,
                "by_method": dict(self.by_method),
                "by_status": dict(self.by_status),
                "by_path": dict(self.by_path),
            }

        return {
            "uptime_seconds": round(now - self._started_at, 1),
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(self._started_at)),
            "requests": requests,
            "response_times": self.get_percentiles(),
            "connections": {
                "sse_legacy": legacy_broadcaster.client_count(),
                "sse_sync": sync_broadcaster.client_count(),
                "sse_max": MAX_SSE_CLIENTS,
            },
        }


collector = MetricsCollector()
