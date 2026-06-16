"""Diff-based history logging shared by the REST and sync write paths."""

import sqlite3
from collections.abc import Mapping
from typing import Any

from .database import log_history

ARROW: str = "→"  # →


def log_list_diff(
    cursor: sqlite3.Cursor,
    old_row: Mapping[str, Any] | None,
    new_values: Mapping[str, Any],
    *,
    undo: bool = False,
) -> None:
    """Log list lifecycle events implied by the diff between old and new state.

    ``old_row`` is ``None`` for inserts. ``new_values`` must be the *complete*
    new document state. Reorder-only updates (``sort_order`` changes) are
    intentionally ignored — they reflect UI preference, not a meaningful change.
    ``undo=True`` suppresses all logging.
    """
    if undo:
        return

    if old_row is None:
        if not new_values.get("_deleted"):
            log_history(cursor, new_values["id"], "list_created", new_values.get("name"))
        return

    if not old_row.get("_deleted") and new_values.get("_deleted"):
        return

    list_id: str = new_values["id"]

    old_name: str | None = old_row.get("name")
    new_name: str | None = new_values.get("name")
    if new_name is not None and old_name != new_name:
        log_history(cursor, list_id, "list_renamed", f"{old_name} {ARROW} {new_name}")

    old_icon: str | None = old_row.get("icon")
    new_icon: str | None = new_values.get("icon")
    if new_icon is not None and old_icon != new_icon:
        log_history(cursor, list_id, "list_icon_changed", f"{old_icon} {ARROW} {new_icon}")

    old_sort: str | None = old_row.get("item_sort")
    new_sort: str | None = new_values.get("item_sort")
    if new_sort is not None and old_sort != new_sort:
        log_history(cursor, list_id, "list_sort_changed", f"{old_sort} {ARROW} {new_sort}")


def log_item_diff(
    cursor: sqlite3.Cursor,
    old_row: Mapping[str, Any] | None,
    new_values: Mapping[str, Any],
    *,
    undo: bool = False,
) -> None:
    """Log item lifecycle events implied by the diff between old and new state.

    ``old_row`` is ``None`` for inserts. ``new_values`` must be the *complete*
    new document state (callers merge partial updates onto the stored row first),
    otherwise omitted fields read as ``None`` and produce spurious diffs.
    ``undo=True`` suppresses all logging.
    """
    if undo:
        return

    list_id: str | None = new_values.get("list_id") or (old_row or {}).get("list_id")
    item_id: str = new_values["id"]

    if old_row is None:
        if not new_values.get("_deleted"):
            log_history(cursor, list_id, "item_created", new_values.get("text"), item_id)
        return

    if not old_row.get("_deleted") and new_values.get("_deleted"):
        log_history(cursor, list_id, "item_deleted", old_row.get("text"), item_id)
        return

    if old_row.get("_deleted") and not new_values.get("_deleted"):
        log_history(cursor, list_id, "item_restored", new_values.get("text"), item_id)
        return

    old_text: str | None = old_row.get("text")
    new_text: str | None = new_values.get("text")
    if old_text != new_text:
        log_history(cursor, list_id, "item_renamed", f"{old_text} {ARROW} {new_text}", item_id)

    old_completed: bool = bool(old_row.get("completed"))
    new_completed: bool = bool(new_values.get("completed"))
    if old_completed != new_completed:
        action: str = "item_completed" if new_completed else "item_uncompleted"
        log_history(cursor, list_id, action, new_text, item_id)

    old_category: str | None = old_row.get("category_id")
    new_category: str | None = new_values.get("category_id")
    if old_category != new_category:
        log_history(
            cursor,
            list_id,
            "item_category_changed",
            f"{old_category or ''} {ARROW} {new_category or ''}",
            item_id,
        )
