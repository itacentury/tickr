"""Legacy SSE endpoint for real-time updates."""

import asyncio
import logging
from queue import Empty, Queue

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from ..events import MAX_SSE_CLIENTS, clients_lock, connected_clients

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


@router.get("/events")
async def sse_events() -> StreamingResponse:
    """SSE endpoint for real-time updates to connected clients (legacy)."""
    with clients_lock:
        if len(connected_clients) >= MAX_SSE_CLIENTS:
            logger.warning("SSE connection rejected: max clients (%d) reached", MAX_SSE_CLIENTS)
            raise HTTPException(status_code=429, detail="Too many SSE connections")

    queue: Queue = Queue(maxsize=100)
    with clients_lock:
        connected_clients.append(queue)
        logger.info("SSE client connected (%d active)", len(connected_clients))

    async def event_generator():
        """Generate SSE events from the client's message queue."""
        heartbeat_interval = 15
        last_heartbeat = asyncio.get_event_loop().time()

        try:
            while True:
                current_time = asyncio.get_event_loop().time()

                if current_time - last_heartbeat >= heartbeat_interval:
                    yield ": heartbeat\n\n"
                    last_heartbeat = current_time

                try:
                    data = queue.get_nowait()
                    yield f"data: {data}\n\n"
                except Empty:
                    await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            pass
        finally:
            with clients_lock:
                if queue in connected_clients:
                    connected_clients.remove(queue)
                logger.info("SSE client disconnected (%d active)", len(connected_clients))

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
