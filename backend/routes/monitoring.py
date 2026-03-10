"""Health check and metrics endpoints for application monitoring."""

import sqlite3
import time

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from ..database import DATABASE
from ..events import (
    MAX_SSE_CLIENTS,
    clients_lock,
    connected_clients,
    sync_clients_lock,
    sync_connected_clients,
)
from ..metrics import collector

router = APIRouter(prefix="/api/v1", tags=["monitoring"])

_app_start_time = time.time()


@router.get("/health")
async def health_check():
    """Return application health status including database connectivity."""
    try:
        conn = sqlite3.connect(DATABASE, timeout=2)
        conn.execute("SELECT 1")
        conn.close()
    except Exception as e:
        return JSONResponse(
            status_code=503,
            content={
                "error": {
                    "code": "SERVICE_UNAVAILABLE",
                    "message": f"Health check failed: {e}",
                    "status": 503,
                }
            },
        )

    with clients_lock:
        legacy_count = len(connected_clients)
    with sync_clients_lock:
        sync_count = len(sync_connected_clients)

    return {
        "status": "healthy",
        "uptime_seconds": round(time.time() - _app_start_time, 1),
        "database": "ok",
        "connections": {
            "sse_legacy": legacy_count,
            "sse_sync": sync_count,
            "sse_max": MAX_SSE_CLIENTS,
        },
    }


@router.get("/metrics")
async def metrics_snapshot():
    """Return collected request metrics as JSON."""
    return collector.get_snapshot()
