"""Shared field-length constraints for REST and sync validation.

Single source of truth for backend Pydantic models. ``frontend/src/db/constants.js``
mirrors these values for the RxDB schemas; the two files MUST stay in lockstep —
there is no build step that derives one from the other.
"""

NAME_MAX: int = 200
ICON_MAX: int = 50
TEXT_MAX: int = 500
ID_MAX: int = 36
SORT_OPTION_MAX: int = 50
TIMESTAMP_MAX: int = 30
COLOR_HEX_MAX: int = 7  # "#rrggbb"
