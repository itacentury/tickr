"""In-memory request metrics collection with thread-safe counters and response time tracking."""

import re
import time
from collections import defaultdict, deque
from threading import Lock

from .events import (
    MAX_SSE_CLIENTS,
    clients_lock,
    connected_clients,
    sync_clients_lock,
    sync_connected_clients,
)

# Matches UUID v4 segments in URL paths
_UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)

# Matches trailing filename segments (e.g. /static/app.js)
_STATIC_FILE_RE = re.compile(r"(/static/).*")


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

        Replaces UUIDs with ``{id}`` and static filenames with ``{file}``.
        """
        path = _UUID_RE.sub("{id}", path)
        path = _STATIC_FILE_RE.sub(r"\1{file}", path)
        return path

    def get_percentiles(self, window_seconds: int = 300) -> dict:
        """Compute response time percentiles over a recent time window.

        Args:
            window_seconds: How far back (in seconds) to include samples.

        Returns:
            Dict with p50, p95, p99, min, max, avg, sample_count, and window_seconds.
        """
        cutoff = time.time() - window_seconds

        with self._lock:
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

        with clients_lock:
            legacy_count = len(connected_clients)
        with sync_clients_lock:
            sync_count = len(sync_connected_clients)

        return {
            "uptime_seconds": round(now - self._started_at, 1),
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(self._started_at)),
            "requests": requests,
            "response_times": self.get_percentiles(),
            "connections": {
                "sse_legacy": legacy_count,
                "sse_sync": sync_count,
                "sse_max": MAX_SSE_CLIENTS,
            },
        }


collector = MetricsCollector()
