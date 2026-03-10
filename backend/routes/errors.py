"""Frontend error reporting endpoint."""

import logging

from fastapi import APIRouter, Request
from fastapi.responses import Response

from ..models import FrontendErrorReport

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["monitoring"])


@router.post("/errors", status_code=204, response_class=Response)
async def report_frontend_error(report: FrontendErrorReport, request: Request):
    """Receive and log a frontend error report."""
    logger.error(
        "Frontend error | action=%s | message=%s | ip=%s | user_agent=%s | stack=%s",
        report.action,
        report.message,
        request.client.host if request.client else "unknown",
        report.user_agent or "unknown",
        report.stack or "none",
    )
