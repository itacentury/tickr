"""SSE client management and broadcast utilities."""

import asyncio
import json
import logging
from contextlib import suppress
from queue import Full, Queue
from threading import Lock

logger = logging.getLogger(__name__)

# Signals SSE loops to stop when the server is shutting down
shutdown_event = asyncio.Event()

# Maximum concurrent SSE connections
MAX_SSE_CLIENTS = 10

# Legacy SSE client management (thread-safe)
clients_lock = Lock()
connected_clients: list[Queue] = []

# Sync SSE clients for RxDB replication
sync_clients_lock = Lock()
sync_connected_clients: list[Queue] = []


def broadcast_update(event_type: str, list_id: str | None = None) -> None:
    """Notify all connected legacy SSE clients of a data change."""
    message = json.dumps({"type": event_type, "list_id": list_id})
    with clients_lock:
        client_count = len(connected_clients)
        for queue in connected_clients:
            try:
                queue.put_nowait(message)
            except Full:
                logger.warning("SSE client queue full, dropping message")
    logger.debug("Broadcast '%s' (list_id=%s) to %d client(s)", event_type, list_id, client_count)


def broadcast_sync(collection: str) -> None:
    """Notify all sync SSE clients that a collection has changed."""
    message = json.dumps({"collection": collection})
    with sync_clients_lock:
        for queue in sync_connected_clients:
            try:
                queue.put_nowait(message)
            except Full:
                logger.warning("Sync SSE client queue full, dropping message")


def _broadcast_shutdown_message() -> None:
    """Push a server_shutdown message to all SSE client queues."""
    message = json.dumps({"type": "server_shutdown"})
    with clients_lock:
        for queue in connected_clients:
            with suppress(Full):
                queue.put_nowait(message)
    with sync_clients_lock:
        for queue in sync_connected_clients:
            with suppress(Full):
                queue.put_nowait(message)


async def initiate_shutdown(drain_timeout: float = 2.0) -> None:
    """Broadcast shutdown to SSE clients, then wait for them to drain.

    Args:
        drain_timeout: Maximum seconds to wait for clients to disconnect.
    """
    _broadcast_shutdown_message()
    shutdown_event.set()

    elapsed = 0.0
    poll_interval = 0.1
    while elapsed < drain_timeout:
        with clients_lock:
            legacy_count = len(connected_clients)
        with sync_clients_lock:
            sync_count = len(sync_connected_clients)
        if legacy_count == 0 and sync_count == 0:
            logger.info("All SSE clients disconnected")
            return
        await asyncio.sleep(poll_interval)
        elapsed += poll_interval

    logger.warning(
        "Shutdown drain timeout: %d legacy + %d sync clients still connected",
        legacy_count,
        sync_count,
    )
