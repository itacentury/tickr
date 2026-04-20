"""SSE client management and broadcast utilities.

All SSE streams share one ``SseBroadcaster`` abstraction that owns its client set,
per-client ``asyncio.Queue``, and shared event generator. Publishers may be sync
DB handlers running in worker threads — they call ``broadcast()`` which hops onto
the asyncio loop via ``call_soon_threadsafe`` so the queue is only touched from
the loop thread.
"""

import asyncio
import json
import logging
from contextlib import suppress

from .config import MAX_SSE_CLIENTS, SSE_HEARTBEAT_INTERVAL
from .errors import AppError, ErrorCode

logger = logging.getLogger(__name__)


shutdown_event = asyncio.Event()


class SseBroadcaster:
    """Owns a pool of SSE client queues plus the shared event generator."""

    def __init__(self, name: str, max_clients: int, queue_size: int = 100) -> None:
        self._name = name
        self._max_clients = max_clients
        self._queue_size = queue_size
        self._clients: set[asyncio.Queue[str]] = set()
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Capture the running event loop for thread-safe broadcast calls."""
        self._loop = loop

    def client_count(self) -> int:
        """Return the number of currently connected clients."""
        return len(self._clients)

    async def register(self) -> asyncio.Queue[str]:
        """Create a new client queue; raise 429 if at capacity."""
        if len(self._clients) >= self._max_clients:
            logger.warning(
                "%s SSE connection rejected: max clients (%d) reached",
                self._name,
                self._max_clients,
            )
            raise AppError(ErrorCode.TOO_MANY_CONNECTIONS, "Too many SSE connections", 429)
        queue: asyncio.Queue[str] = asyncio.Queue(maxsize=self._queue_size)
        self._clients.add(queue)
        logger.info("%s SSE client connected (%d active)", self._name, len(self._clients))
        return queue

    async def unregister(self, queue: asyncio.Queue[str]) -> None:
        """Remove a client queue from the active set."""
        self._clients.discard(queue)
        logger.info("%s SSE client disconnected (%d active)", self._name, len(self._clients))

    def broadcast(self, message: str) -> None:
        """Fan out a message to every client queue.

        Safe to call from sync worker threads: hops onto the bound loop via
        ``call_soon_threadsafe`` so the queues are only mutated from the loop.
        Drops messages on ``QueueFull`` without blocking the publisher.
        """
        loop = self._loop
        if loop is None:
            logger.debug("%s broadcast skipped — no loop bound", self._name)
            return
        for queue in tuple(self._clients):
            loop.call_soon_threadsafe(self._enqueue, queue, message)

    @staticmethod
    def _enqueue(queue: asyncio.Queue[str], message: str) -> None:
        """Put a message on a single client queue; drop on overflow."""
        try:
            queue.put_nowait(message)
        except asyncio.QueueFull:
            logger.warning("SSE client queue full, dropping message")

    async def stream(self, queue: asyncio.Queue[str], heartbeat: float):
        """Yield SSE frames from the given client queue until shutdown or cancel.

        The caller is expected to have obtained ``queue`` via ``register()`` so
        a capacity rejection surfaces as a proper HTTP 429 instead of a mid-stream
        exception.
        """
        try:
            while not shutdown_event.is_set():
                try:
                    data = await asyncio.wait_for(queue.get(), timeout=heartbeat)
                except TimeoutError:
                    yield ": heartbeat\n\n"
                    continue
                yield f"data: {data}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            await self.unregister(queue)


legacy_broadcaster = SseBroadcaster("legacy", MAX_SSE_CLIENTS)
sync_broadcaster = SseBroadcaster("sync", MAX_SSE_CLIENTS)


def broadcast_update(event_type: str, list_id: str | None = None) -> None:
    """Notify all legacy SSE clients of a data change."""
    legacy_broadcaster.broadcast(json.dumps({"type": event_type, "list_id": list_id}))


def broadcast_sync(collection: str) -> None:
    """Notify all sync SSE clients that a collection has changed."""
    sync_broadcaster.broadcast(json.dumps({"collection": collection}))


def bind_loop(loop: asyncio.AbstractEventLoop) -> None:
    """Bind the running event loop to every broadcaster (call once at startup)."""
    legacy_broadcaster.bind_loop(loop)
    sync_broadcaster.bind_loop(loop)


def _broadcast_shutdown_message() -> None:
    """Push a server_shutdown message to all SSE client queues."""
    message = json.dumps({"type": "server_shutdown"})
    legacy_broadcaster.broadcast(message)
    sync_broadcaster.broadcast(message)


async def initiate_shutdown(drain_timeout: float = 2.0) -> None:
    """Broadcast shutdown to SSE clients, then wait for them to drain."""
    _broadcast_shutdown_message()
    shutdown_event.set()

    elapsed = 0.0
    poll_interval = 0.1
    while elapsed < drain_timeout:
        legacy_count = legacy_broadcaster.client_count()
        sync_count = sync_broadcaster.client_count()
        if legacy_count == 0 and sync_count == 0:
            logger.info("All SSE clients disconnected")
            return
        with suppress(asyncio.CancelledError):
            await asyncio.sleep(poll_interval)
        elapsed += poll_interval

    logger.warning(
        "Shutdown drain timeout: %d legacy + %d sync clients still connected",
        legacy_broadcaster.client_count(),
        sync_broadcaster.client_count(),
    )


__all__ = [
    "SSE_HEARTBEAT_INTERVAL",
    "SseBroadcaster",
    "bind_loop",
    "broadcast_sync",
    "broadcast_update",
    "initiate_shutdown",
    "legacy_broadcaster",
    "shutdown_event",
    "sync_broadcaster",
]
