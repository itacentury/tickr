"""Centralized configuration loaded from environment variables."""

import os


def _env_bool(name: str, default: bool) -> bool:
    """Read a boolean env var (``true``/``false``, case-insensitive)."""
    return os.getenv(name, str(default).lower()).lower() == "true"


def _env_int(name: str, default: int) -> int:
    """Read an integer env var, falling back to ``default``."""
    return int(os.getenv(name, str(default)))


DATABASE: str = os.getenv("TICKR_DATABASE", "data/tickr.db")

LOG_LEVEL: str = os.getenv("TICKR_LOG_LEVEL", "INFO")

RATE_LIMIT_REQUESTS: int = _env_int("TICKR_RATE_LIMIT_REQUESTS", 100)
RATE_LIMIT_WINDOW: int = _env_int("TICKR_RATE_LIMIT_WINDOW", 60)
RATE_LIMIT_MAX_IPS: int = _env_int("TICKR_RATE_LIMIT_MAX_IPS", 10000)

MAX_SSE_CLIENTS: int = _env_int("TICKR_MAX_SSE_CLIENTS", 10)
SSE_HEARTBEAT_INTERVAL: int = _env_int("TICKR_SSE_HEARTBEAT_INTERVAL", 15)

BACKUP_DIR: str = os.getenv("TICKR_BACKUP_DIR", "data/backups")
BACKUP_RETAIN: int = _env_int("TICKR_BACKUP_RETAIN", 7)

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

# --- Authentication ---------------------------------------------------------
# Single-password gate. Defaults to OFF so the existing test suite (which never
# authenticates) and unconfigured deployments keep working unchanged.
AUTH_ENABLED: bool = _env_bool("TICKR_AUTH_ENABLED", False)

# Password source. The argon2 hash is preferred; the plaintext fallback exists
# only for local development and emits a startup warning when used.
PASSWORD_HASH: str = os.getenv("TICKR_PASSWORD_HASH", "")
PASSWORD_PLAINTEXT: str = os.getenv("TICKR_PASSWORD", "")

# Secret used to sign session cookies (itsdangerous). Required when auth is on.
SESSION_SECRET: str = os.getenv("TICKR_SESSION_SECRET", "")

# How long a "remember me" session stays valid, in days.
SESSION_DAYS_DEFAULT: int = _env_int("TICKR_SESSION_DAYS", 30)

# Cookie flags. `Secure` must be off for local dev over plain HTTP, on in prod.
COOKIE_SECURE: bool = _env_bool("TICKR_COOKIE_SECURE", True)
COOKIE_SAMESITE: str = os.getenv("TICKR_COOKIE_SAMESITE", "lax")
