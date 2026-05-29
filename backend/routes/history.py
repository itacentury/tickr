"""History endpoints."""

import sqlite3

from fastapi import APIRouter, Depends

from ..database import get_db

router = APIRouter(prefix="/api/v1")


@router.get("/lists/{list_id}/history")
def get_history(list_id: str, db: sqlite3.Connection = Depends(get_db)):
    """Return all history entries for a list."""
    cursor = db.cursor()
    cursor.execute(
        """
        SELECT * FROM history
        WHERE list_id = ? AND action NOT LIKE 'undo_%'
        ORDER BY timestamp DESC
    """,
        (list_id,),
    )
    rows = cursor.fetchall()
    return [dict(row) for row in rows]
