"""Tests for the SSE broadcaster abstraction."""

import asyncio

import pytest

from backend.errors import AppError, ErrorCode
from backend.events import SseBroadcaster, shutdown_event


def _run(coro):
    """Run an async coroutine on a fresh event loop without pytest-asyncio."""
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def _reset_shutdown():
    """Ensure the shutdown flag doesn't leak between tests."""
    shutdown_event.clear()
    yield
    shutdown_event.clear()


def test_register_returns_queue():
    """Register yields a fresh asyncio queue and increments the client count."""

    async def _test():
        bc = SseBroadcaster("test", max_clients=3, queue_size=4)
        bc.bind_loop(asyncio.get_running_loop())
        queue = await bc.register()
        assert isinstance(queue, asyncio.Queue)
        assert bc.client_count() == 1
        await bc.unregister(queue)
        assert bc.client_count() == 0

    _run(_test())


def test_register_rejects_over_capacity():
    """Past max_clients the broadcaster raises an AppError with 429 status."""

    async def _test():
        bc = SseBroadcaster("test", max_clients=3, queue_size=4)
        bc.bind_loop(asyncio.get_running_loop())
        for _ in range(3):
            await bc.register()
        with pytest.raises(AppError) as exc_info:
            await bc.register()
        assert exc_info.value.code == ErrorCode.TOO_MANY_CONNECTIONS
        assert exc_info.value.status_code == 429

    _run(_test())


def test_broadcast_fans_out_to_all_clients():
    """A broadcast message reaches every registered client's queue."""

    async def _test():
        bc = SseBroadcaster("test", max_clients=3, queue_size=4)
        bc.bind_loop(asyncio.get_running_loop())
        q1 = await bc.register()
        q2 = await bc.register()
        bc.broadcast("hello")
        await asyncio.sleep(0)
        assert q1.get_nowait() == "hello"
        assert q2.get_nowait() == "hello"

    _run(_test())


def test_broadcast_drops_when_queue_full():
    """Full client queues silently drop messages instead of blocking publishers."""

    async def _test():
        bc = SseBroadcaster("test", max_clients=3, queue_size=4)
        bc.bind_loop(asyncio.get_running_loop())
        q = await bc.register()
        for i in range(4):
            bc.broadcast(f"msg-{i}")
        bc.broadcast("overflow")
        await asyncio.sleep(0)
        assert q.qsize() == 4

    _run(_test())


def test_stream_emits_heartbeat_on_timeout():
    """When no message arrives within the heartbeat window, a named heartbeat event is yielded."""

    async def _test():
        bc = SseBroadcaster("test", max_clients=3, queue_size=4)
        bc.bind_loop(asyncio.get_running_loop())
        q = await bc.register()
        gen = bc.stream(q, heartbeat=0.05)
        frame = await asyncio.wait_for(gen.__anext__(), timeout=1.0)
        assert frame == "event: heartbeat\ndata: {}\n\n"
        await gen.aclose()

    _run(_test())


def test_stream_delivers_broadcast_message():
    """A broadcast message surfaces in the stream as an SSE data frame."""

    async def _test():
        bc = SseBroadcaster("test", max_clients=3, queue_size=4)
        bc.bind_loop(asyncio.get_running_loop())
        q = await bc.register()
        gen = bc.stream(q, heartbeat=5.0)
        bc.broadcast("payload")
        await asyncio.sleep(0)
        frame = await asyncio.wait_for(gen.__anext__(), timeout=1.0)
        assert frame == "data: payload\n\n"
        await gen.aclose()

    _run(_test())
