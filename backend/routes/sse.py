"""Legacy SSE endpoint for real-time updates."""

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..config import SSE_HEARTBEAT_INTERVAL
from ..events import legacy_broadcaster
from ..logging_config import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/v1")


@router.get("/events")
async def sse_events() -> StreamingResponse:
    """SSE endpoint for real-time updates to connected clients (legacy)."""
    queue = await legacy_broadcaster.register()
    return StreamingResponse(
        legacy_broadcaster.stream(queue, heartbeat=SSE_HEARTBEAT_INTERVAL),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
