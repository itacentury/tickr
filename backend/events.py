"""SSE client management and broadcast utilities.

All SSE streams share one ``SseBroadcaster`` abstraction that owns its client set,
per-client ``asyncio.Queue``, and shared event generator. Publishers may be sync
DB handlers running in worker threads — they call ``broadcast()`` which hops onto
the asyncio loop via ``call_soon_threadsafe`` so the queue is only touched from
the loop thread.
"""

import asyncio
import json
import time
from collections.abc import AsyncIterator
from contextlib import suppress

from .config import MAX_SSE_CLIENTS, SSE_HEARTBEAT_INTERVAL
from .errors import AppError, ErrorCode
from .logging_config import get_logger

logger = get_logger(__name__)


shutdown_event: asyncio.Event = asyncio.Event()


class SseBroadcaster:
    """Owns a pool of SSE client queues plus the shared event generator."""

    def __init__(self, name: str, max_clients: int, queue_size: int = 100) -> None:
        self._name = name
        self._max_clients = max_clients
        self._queue_size = queue_size
        self._clients: set[asyncio.Queue[str]] = set()
        self._loop: asyncio.AbstractEventLoop | None = None
        # Lifetime metrics for the observability dashboard.
        self._events_sent: int = 0
        self._connections_opened: int = 0
        self._duration_sum: float = 0.0
        self._connected_at: dict[asyncio.Queue[str], float] = {}

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Capture the running event loop for thread-safe broadcast calls."""
        self._loop = loop

    def client_count(self) -> int:
        """Return the number of currently connected clients."""
        return len(self._clients)

    def stats(self) -> dict[str, float]:
        """Return lifetime SSE metrics: active clients, events sent, opens, avg duration."""
        closed: int = self._connections_opened - len(self._clients)
        avg_duration: float = self._duration_sum / closed if closed > 0 else 0.0
        return {
            "active": len(self._clients),
            "events_sent": self._events_sent,
            "opened_total": self._connections_opened,
            "avg_duration_seconds": round(avg_duration, 1),
        }

    async def register(self) -> asyncio.Queue[str]:
        """Create a new client queue; raise 429 if at capacity."""
        if len(self._clients) >= self._max_clients:
            logger.warning(
                "sse_connection_rejected",
                broadcaster=self._name,
                reason="max_clients_reached",
                max_clients=self._max_clients,
            )
            raise AppError(ErrorCode.TOO_MANY_CONNECTIONS, "Too many SSE connections", 429)
        queue: asyncio.Queue[str] = asyncio.Queue(maxsize=self._queue_size)
        self._clients.add(queue)
        self._connections_opened += 1
        self._connected_at[queue] = time.monotonic()
        logger.info("sse_client_connected", broadcaster=self._name, active=len(self._clients))
        return queue

    async def unregister(self, queue: asyncio.Queue[str]) -> None:
        """Remove a client queue from the active set."""
        self._clients.discard(queue)
        opened_at: float | None = self._connected_at.pop(queue, None)
        if opened_at is not None:
            self._duration_sum += time.monotonic() - opened_at
        logger.info("sse_client_disconnected", broadcaster=self._name, active=len(self._clients))

    def broadcast(self, message: str) -> None:
        """Fan out a message to every client queue.

        Safe to call from sync worker threads: hops onto the bound loop via
        ``call_soon_threadsafe`` so the queues are only mutated from the loop.
        Drops messages on ``QueueFull`` without blocking the publisher.
        """
        loop: asyncio.AbstractEventLoop | None = self._loop
        if loop is None:
            logger.debug("sse_broadcast_skipped", broadcaster=self._name, reason="no_loop_bound")
            return
        for queue in tuple(self._clients):
            loop.call_soon_threadsafe(self._enqueue, queue, message)

    @staticmethod
    def _enqueue(queue: asyncio.Queue[str], message: str) -> None:
        """Put a message on a single client queue; drop on overflow."""
        try:
            queue.put_nowait(message)
        except asyncio.QueueFull:
            logger.warning("sse_queue_full_drop")

    async def stream(self, queue: asyncio.Queue[str], heartbeat: float) -> AsyncIterator[str]:
        """Yield SSE frames from the given client queue until shutdown or cancel.

        The caller is expected to have obtained ``queue`` via ``register()`` so
        a capacity rejection surfaces as a proper HTTP 429 instead of a mid-stream
        exception.
        """
        try:
            while not shutdown_event.is_set():
                try:
                    data: str = await asyncio.wait_for(queue.get(), timeout=heartbeat)
                except TimeoutError:
                    yield ": heartbeat\n\n"
                    continue
                self._events_sent += 1
                yield f"data: {data}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            await self.unregister(queue)


legacy_broadcaster: SseBroadcaster = SseBroadcaster("legacy", MAX_SSE_CLIENTS)
sync_broadcaster: SseBroadcaster = SseBroadcaster("sync", MAX_SSE_CLIENTS)


def get_connection_counts() -> dict[str, float]:
    """Return SSE client counts plus aggregated lifetime stats for health/metrics."""
    legacy: dict[str, float] = legacy_broadcaster.stats()
    sync: dict[str, float] = sync_broadcaster.stats()
    closed_total: float = (
        legacy["opened_total"] + sync["opened_total"] - legacy["active"] - sync["active"]
    )
    duration_sum: float = legacy["avg_duration_seconds"] * max(
        legacy["opened_total"] - legacy["active"], 0
    ) + sync["avg_duration_seconds"] * max(sync["opened_total"] - sync["active"], 0)
    return {
        "sse_legacy": legacy["active"],
        "sse_sync": sync["active"],
        "events_sent": legacy["events_sent"] + sync["events_sent"],
        "opened_total": legacy["opened_total"] + sync["opened_total"],
        "avg_duration_seconds": round(duration_sum / closed_total, 1) if closed_total > 0 else 0.0,
    }


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
    message: str = json.dumps({"type": "server_shutdown"})
    legacy_broadcaster.broadcast(message)
    sync_broadcaster.broadcast(message)


async def initiate_shutdown(drain_timeout: float = 2.0) -> None:
    """Broadcast shutdown to SSE clients, then wait for them to drain."""
    _broadcast_shutdown_message()
    shutdown_event.set()

    elapsed: float = 0.0
    poll_interval: float = 0.1
    while elapsed < drain_timeout:
        legacy_count: int = legacy_broadcaster.client_count()
        sync_count: int = sync_broadcaster.client_count()
        if legacy_count == 0 and sync_count == 0:
            logger.info("sse_shutdown_drained")
            return
        with suppress(asyncio.CancelledError):
            await asyncio.sleep(poll_interval)
        elapsed += poll_interval

    logger.warning(
        "sse_shutdown_drain_timeout",
        legacy_clients=legacy_broadcaster.client_count(),
        sync_clients=sync_broadcaster.client_count(),
    )


__all__ = [
    "SSE_HEARTBEAT_INTERVAL",
    "SseBroadcaster",
    "bind_loop",
    "broadcast_sync",
    "broadcast_update",
    "get_connection_counts",
    "initiate_shutdown",
    "legacy_broadcaster",
    "shutdown_event",
    "sync_broadcaster",
]
