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
import sqlite3
import time
from collections import defaultdict
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from threading import Lock

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import config
from .auth import auth_config_warnings, is_authenticated
from .config import (
    APP_VERSION,
    CORS_ORIGINS,
    CSP_CONNECT_SRC,
    DATABASE,
    RATE_LIMIT_MAX_IPS,
    RATE_LIMIT_REQUESTS,
    RATE_LIMIT_WINDOW,
    TOMBSTONE_PURGE_INTERVAL_HOURS,
    TOMBSTONE_RETAIN_DAYS,
)
from .database import init_db
from .errors import ErrorCode, _error_body, register_error_handlers
from .events import bind_loop, initiate_shutdown
from .logging_config import configure_logging, get_logger
from .metrics import collector, set_event_loop_lag
from .purge import purge_tombstones
from .routes import all_routers
from .routes.static import mount_static

configure_logging()
logger = get_logger(__name__)


# How often the event-loop lag sampler wakes up.
_LAG_SAMPLE_INTERVAL: float = 5.0


async def _sample_event_loop_lag() -> None:
    """Periodically measure scheduling delay as a proxy for event-loop lag."""
    while True:
        before: float = time.monotonic()
        await asyncio.sleep(_LAG_SAMPLE_INTERVAL)
        # Time slept beyond the requested interval is the loop's scheduling lag.
        lag_ms: float = (time.monotonic() - before - _LAG_SAMPLE_INTERVAL) * 1000
        set_event_loop_lag(max(0.0, lag_ms))


def _run_purge() -> int:
    """Open a short-lived connection and purge expired tombstones (blocking)."""
    conn: sqlite3.Connection = sqlite3.connect(DATABASE)
    try:
        return purge_tombstones(conn, TOMBSTONE_RETAIN_DAYS)
    finally:
        conn.close()


async def _purge_tombstones_loop() -> None:
    """Purge expired tombstones at startup and then on a fixed interval.

    The blocking SQLite delete runs in a worker thread so it never stalls the
    event loop. Failures are logged and the loop continues — a transient purge
    error must not take down the running app.
    """
    interval_seconds: float = TOMBSTONE_PURGE_INTERVAL_HOURS * 3600
    while True:
        try:
            deleted: int = await asyncio.to_thread(_run_purge)
            logger.info("tombstones_purged", count=deleted)
        except Exception:
            logger.exception("tombstone_purge_failed")
        await asyncio.sleep(interval_seconds)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Initialize database on startup."""
    logger.info("app_startup_begin")
    init_db()
    bind_loop(asyncio.get_running_loop())
    lag_task: asyncio.Task[None] = asyncio.create_task(_sample_event_loop_lag())
    purge_task: asyncio.Task[None] = asyncio.create_task(_purge_tombstones_loop())
    if config.AUTH_ENABLED:
        for warning in auth_config_warnings():
            logger.warning("auth_config_warning", detail=warning)
        logger.info("auth_enabled")
    logger.info("app_startup_complete")
    yield
    logger.info("app_shutdown_begin")
    lag_task.cancel()
    purge_task.cancel()
    await initiate_shutdown()


app: FastAPI = FastAPI(
    title="Tickr",
    version=APP_VERSION,
    description="Offline-first to-do app with real-time sync",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Type"],
)
register_error_handlers(app)

rate_limit_store: dict[str, list[float]] = defaultdict(list)
rate_limit_lock: Lock = Lock()


CallNext = Callable[[Request], Awaitable[Response]]


def _evict_stale_entries(now: float) -> None:
    """Remove expired entries and evict oldest if store still exceeds max size."""
    cutoff: float = now - RATE_LIMIT_WINDOW
    stale_keys: list[str] = [
        ip for ip, timestamp in rate_limit_store.items() if not timestamp or timestamp[-1] <= cutoff
    ]
    for key in stale_keys:
        del rate_limit_store[key]

    if len(rate_limit_store) <= RATE_LIMIT_MAX_IPS:
        return

    by_staleness: list[tuple[str, list[float]]] = sorted(
        rate_limit_store.items(), key=lambda kv: kv[1][-1]
    )
    to_remove: int = len(rate_limit_store) - RATE_LIMIT_MAX_IPS
    for ip, _ in by_staleness[:to_remove]:
        del rate_limit_store[ip]


# Routes reachable without a session. The app shell, PWA assets and the auth
# endpoints themselves must stay public — otherwise there is no UI to show the
# login, and the service worker would cache a 401 for "/".
_PUBLIC_EXACT_PATHS: frozenset[str] = frozenset(
    {
        "/",
        "/manifest.json",
        "/sw.js",
        "/circuit-breaker.js",
        "/api/v1/health",
        "/api/v1/auth/login",
        "/api/v1/auth/logout",
        "/api/v1/auth/me",
    }
)
_PUBLIC_PREFIXES: tuple[str, ...] = ("/assets/", "/static/", "/icons/")


def _is_public(path: str) -> bool:
    """Return whether a request path is reachable without authentication."""
    if path in _PUBLIC_EXACT_PATHS:
        return True
    return any(path.startswith(prefix) for prefix in _PUBLIC_PREFIXES)


# Paths exempt from per-IP rate limiting: real-time streams, monitoring probes,
# and the static app shell + PWA assets. Auth endpoints are deliberately NOT
# exempt so login stays brute-force limited. Locking a client out of the shell
# (``/``, ``/sw.js``, ...) is the worst failure mode — a request storm could
# brick the PWA — so these cheap FileResponses bypass the limiter while every
# ``/api/...`` call stays counted.
_RATE_LIMIT_EXEMPT_PATHS: frozenset[str] = frozenset(
    {
        "/",
        "/manifest.json",
        "/sw.js",
        "/circuit-breaker.js",
        "/api/v1/events",
        "/api/v1/sync/stream",
        "/api/v1/health",
        "/api/v1/metrics",
    }
)


def _is_rate_limit_exempt(path: str) -> bool:
    """Return whether a request path bypasses per-IP rate limiting."""
    if path in _RATE_LIMIT_EXEMPT_PATHS:
        return True
    return any(path.startswith(prefix) for prefix in _PUBLIC_PREFIXES)


# Declared first so it becomes the *innermost* middleware: rate limiting and
# access logging wrap it, so login attempts are rate-limited and 401s are logged
# and still receive security headers on the way out.
@app.middleware("http")
async def auth_middleware(request: Request, call_next: CallNext) -> Response:
    """Require a valid session cookie for protected (data/API) routes."""
    if not config.AUTH_ENABLED or _is_public(request.url.path):
        return await call_next(request)
    if is_authenticated(request):
        return await call_next(request)
    return JSONResponse(
        status_code=401,
        content=_error_body(ErrorCode.UNAUTHORIZED, "Authentication required", 401),
    )


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next: CallNext) -> Response:
    """Attach security headers to every response."""
    response: Response = await call_next(request)
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "style-src 'self' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; "
        "img-src 'self' data:; "
        f"connect-src {CSP_CONNECT_SRC}"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    # HSTS only on HTTPS — sending it over plain HTTP is meaningless (browsers
    # ignore it) and misleading. `request.url.scheme` reflects
    # X-Forwarded-Proto when uvicorn runs with --proxy-headers. No `preload`:
    # that is a near-irreversible deployer decision, not ours.
    if request.url.scheme == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next: CallNext) -> Response:
    """Enforce per-IP sliding window rate limiting, excluding exempt paths."""
    if _is_rate_limit_exempt(request.url.path):
        return await call_next(request)

    client_ip: str = request.client.host if request.client else "unknown"
    now: float = time.time()

    with rate_limit_lock:
        cutoff: float = now - RATE_LIMIT_WINDOW
        timestamps: list[float] = [t for t in rate_limit_store[client_ip] if t > cutoff]
        rate_limit_store[client_ip] = timestamps

        if len(timestamps) >= RATE_LIMIT_REQUESTS:
            retry_after: int = max(1, int(timestamps[0] - cutoff) + 1)
            logger.warning(
                "rate_limit_exceeded", client_ip=client_ip, retry_after_seconds=retry_after
            )
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

        # Evict only after appending so the current client's entry is non-empty
        # and won't be removed as "stale" by _evict_stale_entries.
        if len(rate_limit_store) > RATE_LIMIT_MAX_IPS:
            _evict_stale_entries(now)

    return await call_next(request)


SSE_PATHS: frozenset[str] = frozenset({"/api/v1/events", "/api/v1/sync/stream"})
MONITORING_PATHS: frozenset[str] = frozenset({"/api/v1/health", "/api/v1/metrics"})


@app.middleware("http")
async def access_log_and_metrics_middleware(request: Request, call_next: CallNext) -> Response:
    """Wrap every request with one access log line and (non-monitoring) metrics.

    Declared last so it becomes the outermost middleware — that way 429 responses
    returned from ``rate_limit_middleware`` still pass through here and get
    logged. One ``time.monotonic()`` pair serves both the log line and the
    metrics sample, so we pay only one coroutine frame for both.
    """
    client_ip: str = request.client.host if request.client else "unknown"
    method: str = request.method
    path: str = request.url.path

    if path in SSE_PATHS:
        response: Response = await call_next(request)
        logger.info(
            "http_access",
            client_ip=client_ip,
            method=method,
            path=path,
            status=response.status_code,
            sse=True,
        )
        return response

    start: float = time.monotonic()
    response = await call_next(request)
    duration_ms: float = (time.monotonic() - start) * 1000
    logger.info(
        "http_access",
        client_ip=client_ip,
        method=method,
        path=path,
        status=response.status_code,
        duration_ms=round(duration_ms, 1),
    )
    if path not in MONITORING_PATHS:
        collector.record(method, path, response.status_code, duration_ms)
    return response


# Include all API routers
for router in all_routers:
    app.include_router(router)

# Mount static file directories (must be after routers to avoid shadowing)
mount_static(app)
