"""Structured error handling for the Tickr API.

Provides a centralized error code enum, a custom exception class, and
FastAPI exception handlers that produce machine-readable JSON responses
in the shape ``{"error": {"code": "...", "message": "...", "status": ...}}``.
"""

from enum import StrEnum

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ErrorCode(StrEnum):
    """Machine-readable error codes returned by the API."""

    ITEM_NOT_FOUND = "ITEM_NOT_FOUND"
    ICON_NOT_FOUND = "ICON_NOT_FOUND"
    INVALID_SORT_OPTION = "INVALID_SORT_OPTION"
    INVALID_COLLECTION = "INVALID_COLLECTION"
    RATE_LIMITED = "RATE_LIMITED"
    TOO_MANY_CONNECTIONS = "TOO_MANY_CONNECTIONS"
    CONFLICT = "CONFLICT"
    VALIDATION_ERROR = "VALIDATION_ERROR"


class AppError(Exception):
    """Application-level error that renders as a structured JSON response.

    Args:
        code: A stable machine-readable error code from ``ErrorCode``.
        message: A human-readable description of the error.
        status_code: The HTTP status code for the response.
    """

    def __init__(self, code: ErrorCode, message: str, status_code: int) -> None:
        self.code = code
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def _error_body(code: str, message: str, status: int) -> dict:
    """Build the canonical error response body."""
    return {"error": {"code": code, "message": message, "status": status}}


async def _app_error_handler(_request: Request, exc: Exception) -> JSONResponse:
    """Handle AppError exceptions with structured JSON."""
    assert isinstance(exc, AppError)
    return JSONResponse(
        status_code=exc.status_code,
        content=_error_body(exc.code, exc.message, exc.status_code),
    )


async def _validation_error_handler(_request: Request, exc: Exception) -> JSONResponse:
    """Handle Pydantic validation errors with structured JSON and field details."""
    assert isinstance(exc, RequestValidationError)
    details = []
    for err in exc.errors():
        details.append(
            {
                "field": " → ".join(str(loc) for loc in err["loc"]),
                "message": err["msg"],
                "type": err["type"],
            }
        )

    body = _error_body(ErrorCode.VALIDATION_ERROR, "Validation error", 422)
    body["error"]["details"] = details
    return JSONResponse(status_code=422, content=body)


def register_error_handlers(app: FastAPI) -> None:
    """Register all custom exception handlers on the FastAPI app."""
    app.add_exception_handler(AppError, _app_error_handler)
    app.add_exception_handler(RequestValidationError, _validation_error_handler)
