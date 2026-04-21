"""Health check and metrics endpoints for application monitoring."""

import sqlite3
import time

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from ..config import MAX_SSE_CLIENTS
from ..database import get_db
from ..events import get_connection_counts
from ..metrics import collector

router = APIRouter(prefix="/api/v1", tags=["monitoring"])

_app_start_time = time.time()


@router.get("/health")
async def health_check(db: sqlite3.Connection = Depends(get_db)):
    """Return application health status including database connectivity."""
    try:
        db.execute("SELECT 1").fetchone()
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

    return {
        "status": "healthy",
        "uptime_seconds": round(time.time() - _app_start_time, 1),
        "database": "ok",
        "connections": {**get_connection_counts(), "sse_max": MAX_SSE_CLIENTS},
    }


@router.get("/metrics")
async def metrics_snapshot():
    """Return collected request metrics as JSON."""
    return collector.get_snapshot()
