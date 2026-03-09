"""History endpoints."""

import sqlite3

from fastapi import APIRouter, Depends

from ..database import get_db
from ..models import HistoryEntry

router = APIRouter(prefix="/api")


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


@router.post("/lists/{list_id}/history")
def restore_history(
    list_id: str, entries: list[HistoryEntry], db: sqlite3.Connection = Depends(get_db)
):
    """Bulk-insert validated history entries for a restored list."""
    cursor = db.cursor()
    for entry in entries:
        cursor.execute(
            "INSERT INTO history (list_id, action, item_text, timestamp) VALUES (?, ?, ?, ?)",
            (list_id, entry.action, entry.item_text, entry.timestamp),
        )
    db.commit()
    return {"success": True}
