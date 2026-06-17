"""Single-password authentication helpers.

Encapsulates password verification (argon2) and stateless, signed session
cookies (itsdangerous) so the middleware in ``main.py`` and the routes in
``routes/auth.py`` stay thin.

Design notes:
    Sessions are *stateless*: the cookie carries a signed, timestamped payload
    and is verified on every request. There is no server-side session store,
    so sessions cannot be revoked individually — acceptable for a single-user
    deployment. Logout simply clears the cookie in the browser.

    All configuration (secret, password, cookie flags) is read lazily from
    ``backend.config`` at call time rather than captured at import, so tests can
    monkeypatch the config module to exercise the authenticated paths.
"""

import secrets

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Request
from itsdangerous import BadSignature, URLSafeTimedSerializer

from . import config
from .logging_config import get_logger

logger = get_logger(__name__)

SESSION_COOKIE_NAME = "tickr_session"

# Opaque marker stored in the signed cookie. The cookie's security comes from
# the signature + timestamp, not from this value.
_SESSION_PAYLOAD = "tickr"
_SESSION_SALT = "tickr-session"

_password_hasher = PasswordHasher()


def _serializer() -> URLSafeTimedSerializer:
    """Build a serializer from the current session secret."""
    return URLSafeTimedSerializer(config.SESSION_SECRET, salt=_SESSION_SALT)


def verify_password(password: str) -> bool:
    """Check a candidate password against the configured hash or plaintext.

    Prefers ``PASSWORD_HASH`` (argon2). Falls back to a constant-time
    comparison against ``PASSWORD_PLAINTEXT`` for local development.
    """
    if config.PASSWORD_HASH:
        try:
            return _password_hasher.verify(config.PASSWORD_HASH, password)
        except VerifyMismatchError:
            return False
        except Exception:
            logger.warning("auth_password_hash_invalid")
            return False

    if config.PASSWORD_PLAINTEXT:
        return secrets.compare_digest(password, config.PASSWORD_PLAINTEXT)

    return False


def create_session_token() -> str:
    """Create a signed, timestamped session token."""
    return _serializer().dumps(_SESSION_PAYLOAD)


def verify_session_token(token: str, max_age_seconds: int) -> bool:
    """Verify a session token's signature and age."""
    try:
        _serializer().loads(token, max_age=max_age_seconds)
        return True
    except BadSignature:
        # Covers SignatureExpired (a BadSignature subclass) too.
        return False


def is_authenticated(request: Request) -> bool:
    """Return whether the request carries a valid session cookie."""
    token: str | None = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        return False
    return verify_session_token(token, config.SESSION_DAYS_DEFAULT * 86400)


def auth_config_warnings() -> list[str]:
    """Return startup misconfiguration warnings (empty when fine).

    Only meaningful when ``AUTH_ENABLED`` is true.
    """
    warnings: list[str] = []
    if not config.SESSION_SECRET:
        warnings.append("TICKR_SESSION_SECRET is not set — sessions cannot be signed")
    if not config.PASSWORD_HASH and not config.PASSWORD_PLAINTEXT:
        warnings.append("No password configured (set TICKR_PASSWORD_HASH or TICKR_PASSWORD)")
    elif not config.PASSWORD_HASH and config.PASSWORD_PLAINTEXT:
        warnings.append("Using plaintext TICKR_PASSWORD — set TICKR_PASSWORD_HASH for production")
    return warnings
