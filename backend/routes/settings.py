"""Settings endpoints."""

import sqlite3

from fastapi import APIRouter, Depends

from .. import config
from ..database import get_db
from ..errors import AppError, ErrorCode
from ..models import VALID_LIST_SORT_OPTIONS, SettingsUpdate, SuccessResponse

router = APIRouter(prefix="/api/v1")


@router.get("/settings")
def get_settings(db: sqlite3.Connection = Depends(get_db)) -> dict[str, str]:
    """Return all app settings plus the read-only default-list timeout."""
    cursor: sqlite3.Cursor = db.cursor()
    cursor.execute("SELECT key, value FROM settings")
    rows: list[sqlite3.Row] = cursor.fetchall()
    settings: dict[str, str] = {row["key"]: row["value"] for row in rows}
    settings["default_list_timeout_minutes"] = str(config.DEFAULT_LIST_TIMEOUT_MINUTES)
    return settings


def _save_default_list(cursor: sqlite3.Cursor, list_id: str) -> None:
    """Set the default list, or clear it when ``list_id`` is empty.

    The id is not checked against ``lists``: a list created offline may not have
    replicated yet, and the client ignores default ids it cannot resolve.
    """
    if not list_id:
        cursor.execute("DELETE FROM settings WHERE key = 'default_list_id'")
        return

    cursor.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
        ("default_list_id", list_id),
    )


def clear_default_list_if_matches(cursor: sqlite3.Cursor, list_id: str) -> None:
    """Drop the default-list setting if it points at ``list_id``."""
    cursor.execute("DELETE FROM settings WHERE key = 'default_list_id' AND value = ?", (list_id,))


@router.put("/settings", response_model=SuccessResponse)
def update_settings(
    settings_data: SettingsUpdate, db: sqlite3.Connection = Depends(get_db)
) -> dict[str, bool]:
    """Update app settings."""
    cursor: sqlite3.Cursor = db.cursor()

    if settings_data.list_sort is not None:
        if settings_data.list_sort not in VALID_LIST_SORT_OPTIONS:
            raise AppError(
                ErrorCode.INVALID_SORT_OPTION,
                f"Invalid list sort option. Valid: {', '.join(VALID_LIST_SORT_OPTIONS)}",
                400,
            )
        cursor.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            ("list_sort", settings_data.list_sort),
        )

    if settings_data.default_list_id is not None:
        _save_default_list(cursor, settings_data.default_list_id)

    db.commit()
    return {"success": True}
