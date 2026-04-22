"""Structured JSON logging for production observability.

Bridges stdlib ``logging`` (used by uvicorn, third-party libs) into
``structlog`` so every log line — ours or theirs — leaves the process as
a single JSON document on stdout. Container log shippers (ELK, Datadog,
CloudWatch) can then parse fields directly without regex.
"""

import logging
import sys
from typing import Any

import structlog

from backend.config import LOG_LEVEL


def configure_logging() -> None:
    """Configure structlog + stdlib logging to emit JSON to stdout.

    Call once at process startup, before any logger is used.
    """
    timestamper: structlog.processors.TimeStamper = structlog.processors.TimeStamper(fmt="iso")
    shared_processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        timestamper,
    ]

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    formatter: structlog.stdlib.ProcessorFormatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=shared_processors,
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.processors.JSONRenderer(),
        ],
    )

    handler: logging.StreamHandler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root: logging.Logger = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(LOG_LEVEL.upper())


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    """Return a structlog logger bound to ``name``."""
    return structlog.stdlib.get_logger(name)
