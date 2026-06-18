"""Unit tests for the ``CollectionSpec`` table that drives sync helpers."""

import uuid

import pytest

from backend.routes.sync import (
    COLLECTIONS,
    _insert_doc,
    _pull_docs,
    _require_spec,
    _select_doc,
    _update_doc,
)


def _uuid() -> str:
    """Generate a random UUID for test documents."""
    return str(uuid.uuid4())


@pytest.mark.parametrize("collection", ["lists", "items"])
def test_spec_sql_matches_table(collection) -> None:
    """Generated SQL references the spec's table name and uses positional placeholders."""
    spec = COLLECTIONS[collection]
    assert spec.table == collection
    assert spec.insert_sql.startswith(f"INSERT INTO {collection}")
    assert spec.update_sql.startswith(f"UPDATE {collection}")
    assert spec.select_sql == f"SELECT * FROM {collection} WHERE id = ?"
    # Placeholder count must match field count
    assert spec.insert_sql.count("?") == len(spec.insert_fields)
    assert spec.update_sql.count("?") == len(spec.update_fields) + 1  # +1 for WHERE id=?


def test_require_spec_rejects_unknown_collection() -> None:
    """Unknown collection names raise an AppError with 400 status."""
    from backend.errors import AppError, ErrorCode

    with pytest.raises(AppError) as exc:
        _require_spec("widgets")
    assert exc.value.code == ErrorCode.INVALID_COLLECTION
    assert exc.value.status_code == 400


def test_insert_and_select_list_via_spec(db) -> None:
    """A minimal list doc round-trips through _insert_doc and _select_doc."""
    spec = COLLECTIONS["lists"]
    doc = {"id": _uuid(), "name": "Spec Test"}
    cursor = db.cursor()

    _insert_doc(cursor, spec, doc)
    db.commit()

    row = _select_doc(cursor, spec, doc["id"])
    assert row is not None
    assert row["name"] == "Spec Test"
    assert row["icon"] == "list"  # from defaults
    assert row["item_sort"] == "alphabetical"  # from defaults
    assert row["_deleted"] == 0


def test_insert_and_select_item_via_spec(db, create_list) -> None:
    """A minimal item doc round-trips through _insert_doc and _select_doc."""
    parent = create_list(name="Parent")
    spec = COLLECTIONS["items"]
    doc = {"id": _uuid(), "list_id": parent["id"], "text": "buy milk"}
    cursor = db.cursor()

    _insert_doc(cursor, spec, doc)
    db.commit()

    row = _select_doc(cursor, spec, doc["id"])
    assert row is not None
    assert row["text"] == "buy milk"
    assert row["completed"] == 0
    assert row["completed_at"] is None


def test_update_doc_rewrites_fields(db) -> None:
    """_update_doc overwrites update_fields and keys by id."""
    spec = COLLECTIONS["lists"]
    doc_id = _uuid()
    cursor = db.cursor()

    _insert_doc(cursor, spec, {"id": doc_id, "name": "Before"})
    inserted = _select_doc(cursor, spec, doc_id)
    assert inserted is not None
    current = dict(inserted)
    _update_doc(cursor, spec, {"id": doc_id, "name": "After", "icon": "star"}, current)
    db.commit()

    row = _select_doc(cursor, spec, doc_id)
    assert row is not None
    assert row["name"] == "After"
    assert row["icon"] == "star"


def test_pull_docs_without_checkpoint_respects_limit(db) -> None:
    """_pull_docs returns at most ``limit`` rows when no checkpoint is given."""
    spec = COLLECTIONS["lists"]
    cursor = db.cursor()
    for i in range(3):
        _insert_doc(cursor, spec, {"id": _uuid(), "name": f"L{i}"})
    db.commit()

    rows = _pull_docs(cursor, spec, updated_at=None, id=None, limit=2)
    assert len(rows) == 2


def test_push_endpoint_still_routes_through_spec(client, create_list) -> None:
    """The refactored sync_push keeps its end-to-end contract on both collections."""
    lst = create_list(name="Integration")
    resp = client.post(
        "/api/v1/sync/items/push",
        json=[
            {
                "newDocumentState": {
                    "id": _uuid(),
                    "list_id": lst["id"],
                    "text": "from push",
                }
            }
        ],
    )
    assert resp.status_code == 200
    assert resp.json() == []
