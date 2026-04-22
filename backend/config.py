"""Centralized configuration loaded from environment variables."""

import os

DATABASE: str = os.getenv("TICKR_DATABASE", "data/tickr.db")

RATE_LIMIT_REQUESTS: int = int(os.getenv("TICKR_RATE_LIMIT_REQUESTS", "100"))
RATE_LIMIT_WINDOW: int = int(os.getenv("TICKR_RATE_LIMIT_WINDOW", "60"))
RATE_LIMIT_MAX_IPS: int = int(os.getenv("TICKR_RATE_LIMIT_MAX_IPS", "10000"))

MAX_SSE_CLIENTS: int = int(os.getenv("TICKR_MAX_SSE_CLIENTS", "10"))
SSE_HEARTBEAT_INTERVAL: int = int(os.getenv("TICKR_SSE_HEARTBEAT_INTERVAL", "15"))

CORS_ORIGINS: list[str] = [
    origin.strip()
    for origin in os.getenv("TICKR_CORS_ORIGINS", "http://localhost:8000").split(",")
    if origin.strip()
]

# CSP `connect-src` must mirror the CORS allow-list: browsers enforce the
# page's own CSP before the server's CORS response is even consulted, so a
# permissive CORS policy without a matching `connect-src` silently fails.
CSP_CONNECT_SRC: str = " ".join(["'self'", *CORS_ORIGINS])

# Comma-separated list of trusted proxy IPs whose X-Forwarded-For header uvicorn
# will honor (passed as `--forwarded-allow-ips`). Consumed in the Dockerfile CMD
# and in deployment docs — the Python app itself does not read it at runtime.
TRUSTED_PROXIES: str = os.getenv("TICKR_TRUSTED_PROXIES", "127.0.0.1")
