"""API route modules collected into a single list for easy inclusion."""

from .history import router as history_router
from .items import router as items_router
from .lists import router as lists_router
from .monitoring import router as monitoring_router
from .settings import router as settings_router
from .sse import router as sse_router
from .static import router as static_router
from .sync import router as sync_router

all_routers = [
    monitoring_router,
    lists_router,
    items_router,
    settings_router,
    history_router,
    sync_router,
    sse_router,
    static_router,
]
