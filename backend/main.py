"""Tickr Backend - FastAPI REST API with SQLite persistence.

Provides endpoints for managing todo lists, items, history tracking,
and RxDB-compatible sync endpoints for offline-first replication.

Deployment note — single-process only:
    Rate-limit state (``rate_limit_store``) and request metrics
    (``backend.metrics.collector``) live in process-local memory. Running
    with multiple workers (``uvicorn --workers N``) silently breaks both:
    each worker sees only its own slice of traffic. Deploy as a single
    process, or move rate limiting to ``slowapi`` + Redis and metrics to
    ``prometheus_client`` with a multiprocess directory.

Deployment note — behind a reverse proxy:
    ``request.client.host`` is read by the rate limiter and the frontend
    error reporter. Without extra flags, Starlette reports the immediate
    peer socket, which behind nginx/traefik collapses every real client
    onto the proxy IP. To get the real IP, pass ``--proxy-headers`` and
    ``--forwarded-allow-ips=<trusted proxy IP(s)>`` to uvicorn (the
    Dockerfile CMD does this via the ``TICKR_TRUSTED_PROXIES`` env var,
    default ``127.0.0.1``). uvicorn only rewrites the client address
    when the peer matches that allow-list, so a misconfigured or absent
    env var fails closed: everyone looks like the proxy, never the
    attacker-controlled ``X-Forwarded-For`` value.
"""

import asyncio
import logging
import time
from collections import defaultdict
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from threading import Lock

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from .config import RATE_LIMIT_MAX_IPS, RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW
from .database import init_db
from .errors import ErrorCode, register_error_handlers
from .events import bind_loop, initiate_shutdown
from .metrics import collector
from .routes import all_routers
from .routes.static import mount_static

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Initialize database on startup."""
    logger.info("Starting Tickr application")
    init_db()
    bind_loop(asyncio.get_running_loop())
    logger.info("Application startup complete")
    yield
    logger.info("Shutting down Tickr application")
    await initiate_shutdown()


app = FastAPI(title="Tickr", version="2.0.0", lifespan=lifespan)
register_error_handlers(app)

rate_limit_store: dict[str, list[float]] = defaultdict(list)
rate_limit_lock = Lock()


def _evict_stale_entries(now: float) -> None:
    """Remove expired entries and evict oldest if store still exceeds max size."""
    cutoff = now - RATE_LIMIT_WINDOW
    stale_keys = [ip for ip, ts in rate_limit_store.items() if not ts or ts[-1] <= cutoff]
    for key in stale_keys:
        del rate_limit_store[key]

    if len(rate_limit_store) <= RATE_LIMIT_MAX_IPS:
        return

    by_staleness = sorted(rate_limit_store.items(), key=lambda kv: kv[1][-1])
    to_remove = len(rate_limit_store) - RATE_LIMIT_MAX_IPS
    for ip, _ in by_staleness[:to_remove]:
        del rate_limit_store[ip]


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next) -> Response:
    """Attach security headers to every response."""
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; "
        "font-src 'self' https://fonts.gstatic.com; "
        "img-src 'self' data:; "
        "connect-src 'self'"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    return response


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next) -> Response:
    """Enforce per-IP sliding window rate limiting, excluding SSE."""
    if request.url.path in (
        "/api/v1/events",
        "/api/v1/sync/stream",
        "/api/v1/health",
        "/api/v1/metrics",
    ):
        return await call_next(request)

    client_ip = request.client.host if request.client else "unknown"
    now = time.time()

    with rate_limit_lock:
        timestamps = rate_limit_store[client_ip]
        cutoff = now - RATE_LIMIT_WINDOW
        rate_limit_store[client_ip] = [t for t in timestamps if t > cutoff]
        timestamps = rate_limit_store[client_ip]

        if len(rate_limit_store) > RATE_LIMIT_MAX_IPS:
            _evict_stale_entries(now)

        if len(timestamps) >= RATE_LIMIT_REQUESTS:
            retry_after = max(1, int(timestamps[0] - cutoff) + 1)
            logger.warning("Rate limit exceeded for %s (retry after %ds)", client_ip, retry_after)
            return JSONResponse(
                status_code=429,
                content={
                    "error": {
                        "code": ErrorCode.RATE_LIMITED,
                        "message": "Too many requests",
                        "status": 429,
                    }
                },
                headers={"Retry-After": str(retry_after)},
            )

        timestamps.append(now)

    return await call_next(request)


SSE_PATHS = frozenset({"/api/v1/events", "/api/v1/sync/stream"})
MONITORING_PATHS = frozenset({"/api/v1/health", "/api/v1/metrics"})


@app.middleware("http")
async def access_log_and_metrics_middleware(request: Request, call_next) -> Response:
    """Wrap every request with one access log line and (non-monitoring) metrics.

    Declared last so it becomes the outermost middleware — that way 429 responses
    returned from ``rate_limit_middleware`` still pass through here and get
    logged. One ``time.monotonic()`` pair serves both the log line and the
    metrics sample, so we pay only one coroutine frame for both.
    """
    client_ip = request.client.host if request.client else "unknown"
    method = request.method
    path = request.url.path

    if path in SSE_PATHS:
        response = await call_next(request)
        logger.info('%s - "%s %s" %d [SSE]', client_ip, method, path, response.status_code)
        return response

    start = time.monotonic()
    response = await call_next(request)
    duration_ms = (time.monotonic() - start) * 1000
    logger.info(
        '%s - "%s %s" %d %.1fms', client_ip, method, path, response.status_code, duration_ms
    )
    if path not in MONITORING_PATHS:
        collector.record(method, path, response.status_code, duration_ms)
    return response


# Include all API routers
for router in all_routers:
    app.include_router(router)

# Mount static file directories (must be after routers to avoid shadowing)
mount_static(app)
