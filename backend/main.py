"""Tickr Backend - FastAPI REST API with SQLite persistence.

Provides endpoints for managing todo lists, items, history tracking,
and RxDB-compatible sync endpoints for offline-first replication.
"""

import logging
import time
from collections import defaultdict
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from threading import Lock

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from .database import init_db
from .events import initiate_shutdown
from .routes import all_routers
from .routes.static import mount_static

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Initialize database on startup."""
    logger.info("Starting Tickr application")
    init_db()
    logger.info("Application startup complete")
    yield
    logger.info("Shutting down Tickr application")
    await initiate_shutdown()


app = FastAPI(title="Tickr", version="2.0.0", lifespan=lifespan)

# Rate limiting configuration
RATE_LIMIT_REQUESTS = 100
RATE_LIMIT_WINDOW = 60  # seconds
rate_limit_store: dict[str, list[float]] = defaultdict(list)
rate_limit_lock = Lock()


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
    if request.url.path in ("/api/events", "/api/sync/stream"):
        return await call_next(request)

    client_ip = request.client.host if request.client else "unknown"
    now = time.time()

    with rate_limit_lock:
        timestamps = rate_limit_store[client_ip]
        cutoff = now - RATE_LIMIT_WINDOW
        rate_limit_store[client_ip] = [t for t in timestamps if t > cutoff]
        timestamps = rate_limit_store[client_ip]

        if len(timestamps) >= RATE_LIMIT_REQUESTS:
            retry_after = int(timestamps[0] - cutoff) + 1
            logger.warning("Rate limit exceeded for %s (retry after %ds)", client_ip, retry_after)
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests"},
                headers={"Retry-After": str(retry_after)},
            )

        timestamps.append(now)

    return await call_next(request)


# Include all API routers
for router in all_routers:
    app.include_router(router)

# Mount static file directories (must be after routers to avoid shadowing)
mount_static(app)
