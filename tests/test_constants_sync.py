"""Guard against drift between backend and frontend field-length constants.

``backend/constants.py`` and ``frontend/src/db/constants.js`` are kept in lockstep
by hand (there is no build step). This test fails the moment the two diverge.
"""

import re
from pathlib import Path

from backend import constants

# Field-length constants that MUST agree on both sides of the wire.
SHARED_KEYS: list[str] = [
    "NAME_MAX",
    "ICON_MAX",
    "TEXT_MAX",
    "ID_MAX",
    "SORT_OPTION_MAX",
    "TIMESTAMP_MAX",
    "COLOR_HEX_MAX",
]

_FRONTEND_CONSTANTS: Path = (
    Path(__file__).resolve().parent.parent / "frontend" / "src" / "db" / "constants.js"
)


def _parse_frontend_constants() -> dict[str, int]:
    """Extract ``export const NAME = <int>;`` declarations from the JS mirror."""
    source: str = _FRONTEND_CONSTANTS.read_text(encoding="utf-8")
    pattern: re.Pattern[str] = re.compile(r"export\s+const\s+(\w+)\s*=\s*(\d+)\s*;")
    return {name: int(value) for name, value in pattern.findall(source)}


def test_field_length_constants_match() -> None:
    """Each shared constant has an identical value in backend and frontend."""
    frontend: dict[str, int] = _parse_frontend_constants()

    for key in SHARED_KEYS:
        backend_value: int = getattr(constants, key)
        assert key in frontend, f"{key} missing from {_FRONTEND_CONSTANTS.name}"
        assert frontend[key] == backend_value, (
            f"{key} drifted: backend={backend_value}, frontend={frontend[key]}"
        )
