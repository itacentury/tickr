"""Settings endpoints."""

import sqlite3

from fastapi import APIRouter, Depends

from ..database import get_db
from ..errors import AppError, ErrorCode
from ..models import VALID_LIST_SORT_OPTIONS, SettingsUpdate

router = APIRouter(prefix="/api/v1")


@router.get("/settings")
def get_settings(db: sqlite3.Connection = Depends(get_db)):
    """Return all app settings."""
    cursor = db.cursor()
    cursor.execute("SELECT key, value FROM settings")
    rows = cursor.fetchall()
    return {row["key"]: row["value"] for row in rows}


@router.put("/settings")
def update_settings(settings_data: SettingsUpdate, db: sqlite3.Connection = Depends(get_db)):
    """Update app settings."""
    cursor = db.cursor()

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

    db.commit()
    return {"success": True}
