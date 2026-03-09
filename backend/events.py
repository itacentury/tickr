"""SSE client management and broadcast utilities."""

import json
import logging
from queue import Full, Queue
from threading import Lock

logger = logging.getLogger(__name__)

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
