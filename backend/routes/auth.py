"""Authentication endpoints: login, logout, and session status.

These routes are exempt from the auth middleware (see ``_PUBLIC_EXACT_PATHS``
in ``main.py``) and perform their own cookie checks where needed.
"""

from typing import Literal, cast

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel

from .. import config
from ..auth import (
    SESSION_COOKIE_NAME,
    create_session_token,
    is_authenticated,
    verify_password,
)
from ..errors import AppError, ErrorCode

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


class LoginRequest(BaseModel):
    """Login payload."""

    password: str
    remember: bool = False


def _set_session_cookie(response: Response, *, remember: bool) -> None:
    """Attach a signed session cookie to the response.

    With ``remember`` the cookie persists for ``SESSION_DAYS_DEFAULT`` days;
    otherwise it is a session cookie that the browser drops on close.
    """
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=create_session_token(),
        max_age=config.SESSION_DAYS_DEFAULT * 86400 if remember else None,
        httponly=True,
        secure=config.COOKIE_SECURE,
        samesite=cast(Literal["lax", "strict", "none"], config.COOKIE_SAMESITE),
        path="/",
    )


@router.post("/login")
def login(body: LoginRequest, response: Response) -> dict[str, bool]:
    """Verify the password and start a session on success."""
    if not verify_password(body.password):
        raise AppError(ErrorCode.UNAUTHORIZED, "Invalid password", 401)
    _set_session_cookie(response, remember=body.remember)
    return {"authed": True}


@router.post("/logout")
def logout(response: Response) -> dict[str, bool]:
    """Clear the session cookie. Always succeeds."""
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    return {"authed": False}


@router.get("/me")
def me(request: Request) -> dict[str, bool]:
    """Report authentication status for the client-side login gate.

    Returns 200 in both cases (not 401) so the gate can poll without producing
    console errors. When auth is disabled the user is always considered authed.
    ``enabled`` lets the client decide whether to show a logout control.
    """
    authed = not config.AUTH_ENABLED or is_authenticated(request)
    return {"authed": authed, "enabled": config.AUTH_ENABLED}
