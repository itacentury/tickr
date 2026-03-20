"""Centralized configuration loaded from environment variables."""

import os

DATABASE: str = os.getenv("TICKR_DATABASE", "data/tickr.db")

RATE_LIMIT_REQUESTS: int = int(os.getenv("TICKR_RATE_LIMIT_REQUESTS", "100"))
RATE_LIMIT_WINDOW: int = int(os.getenv("TICKR_RATE_LIMIT_WINDOW", "60"))
RATE_LIMIT_MAX_IPS: int = int(os.getenv("TICKR_RATE_LIMIT_MAX_IPS", "10000"))

MAX_SSE_CLIENTS: int = int(os.getenv("TICKR_MAX_SSE_CLIENTS", "10"))
SSE_HEARTBEAT_INTERVAL: int = int(os.getenv("TICKR_SSE_HEARTBEAT_INTERVAL", "15"))
