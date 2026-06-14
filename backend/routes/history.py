"""History endpoints."""

import sqlite3

from fastapi import APIRouter, Depends, Query

from ..database import get_db
from ..models import SuccessResponse

router = APIRouter(prefix="/api/v1")


@router.get("/lists/{list_id}/history")
def get_history(list_id: str, db: sqlite3.Connection = Depends(get_db)):
    """Return all visible history entries for a list."""
    cursor = db.cursor()
    cursor.execute(
        """
        SELECT * FROM history
        WHERE list_id = ? AND hidden = 0 AND action NOT LIKE 'undo_%'
        ORDER BY timestamp DESC
    """,
        (list_id,),
    )
    rows = cursor.fetchall()
    return [dict(row) for row in rows]


@router.post("/lists/{list_id}/history/hide", response_model=SuccessResponse)
def hide_item_history(
    list_id: str,
    item_id: str = Query(..., min_length=1),
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Soft-hide every history entry for one item ("remove from history")."""
    cursor = db.cursor()
    cursor.execute(
        "UPDATE history SET hidden = 1 WHERE list_id = ? AND item_id = ?",
        (list_id, item_id),
    )
    db.commit()
    return {"success": True}
