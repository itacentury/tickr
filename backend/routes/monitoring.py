"""Health check and metrics endpoints for application monitoring."""

import sqlite3
import time
from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from ..config import MAX_SSE_CLIENTS
from ..database import get_db
from ..events import get_connection_counts
from ..logging_config import get_logger
from ..metrics import collector

router = APIRouter(prefix="/api/v1", tags=["monitoring"])

logger = get_logger(__name__)

_app_start_time: float = time.time()


@router.get("/health")
async def health_check(db: sqlite3.Connection = Depends(get_db)):
    """Return application health status including database connectivity."""
    now: str = datetime.now(UTC).isoformat()

    try:
        row: tuple[int] = db.execute("SELECT COUNT(*) FROM lists WHERE _deleted = 0").fetchone()
        list_count: int = row[0]
    except sqlite3.Error as e:
        logger.error("health_check_failed", error=str(e))
        return JSONResponse(
            status_code=503,
            content={
                "status": "unhealthy",
                "database": f"database_error: {e}",
                "timestamp": now,
            },
        )
    except Exception as e:
        logger.error("health_check_error", error=str(e))
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "error": str(e),
                "timestamp": now,
            },
        )

    return {
        "status": "healthy",
        "database": "ok",
        "list_count": list_count,
        "uptime_seconds": round(time.time() - _app_start_time, 1),
        "connections": {**get_connection_counts(), "sse_max": MAX_SSE_CLIENTS},
        "timestamp": now,
    }


@router.get("/metrics")
async def metrics_snapshot():
    """Return collected request metrics as JSON."""
    return collector.get_snapshot()
