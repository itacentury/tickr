"""Frontend error reporting endpoint."""

from fastapi import APIRouter, Request
from fastapi.responses import Response

from ..logging_config import get_logger
from ..models import FrontendErrorReport

logger = get_logger(__name__)

router = APIRouter(prefix="/api/v1", tags=["monitoring"])


@router.post("/errors", status_code=204, response_class=Response)
async def report_frontend_error(report: FrontendErrorReport, request: Request):
    """Receive and log a frontend error report."""
    logger.warning(
        "frontend_error",
        action=report.action,
        message=report.message,
        client_ip=request.client.host if request.client else "unknown",
        user_agent=report.user_agent or "unknown",
        stack=report.stack or "none",
    )
