"""Pydantic request/response models and validation constants."""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .constants import (
    COLOR_HEX_MAX,
    ICON_MAX,
    ID_MAX,
    NAME_MAX,
    SORT_OPTION_MAX,
    TEXT_MAX,
    TIMESTAMP_MAX,
)

COLOR_HEX_PATTERN: str = r"^#[0-9a-fA-F]{6}$"


def _strip_str(cls, v: object) -> object:
    """Strip whitespace from strings; leave other types for Pydantic to reject."""
    return v.strip() if isinstance(v, str) else v


class ListCreate(BaseModel):
    """Request model for creating a new list."""

    name: str = Field(..., min_length=1, max_length=NAME_MAX)
    icon: str = Field("list", max_length=ICON_MAX)
    undo: bool = False

    _strip_name = field_validator("name", mode="before")(_strip_str)


class ListUpdate(BaseModel):
    """Request model for updating an existing list."""

    name: str | None = Field(None, min_length=1, max_length=NAME_MAX)
    icon: str | None = Field(None, max_length=ICON_MAX)
    item_sort: str | None = None

    _strip_name = field_validator("name", mode="before")(_strip_str)


class ItemCreate(BaseModel):
    """Request model for creating a new item."""

    text: str = Field(..., min_length=1, max_length=TEXT_MAX)
    category_id: str | None = Field(None, min_length=1, max_length=ID_MAX)
    undo: bool = False

    _strip_text = field_validator("text", mode="before")(_strip_str)


class ItemUpdate(BaseModel):
    """Request model for updating an existing item."""

    text: str | None = Field(None, min_length=1, max_length=TEXT_MAX)
    completed: bool | None = None
    category_id: str | None = Field(None, max_length=ID_MAX)
    undo: bool = False

    _strip_text = field_validator("text", mode="before")(_strip_str)


class CategoryCreate(BaseModel):
    """Request model for creating a new category."""

    name: str = Field(..., min_length=1, max_length=NAME_MAX)
    color: str = Field(
        ..., min_length=COLOR_HEX_MAX, max_length=COLOR_HEX_MAX, pattern=COLOR_HEX_PATTERN
    )

    _strip_name = field_validator("name", mode="before")(_strip_str)


class CategoryUpdate(BaseModel):
    """Request model for updating an existing category."""

    name: str | None = Field(None, min_length=1, max_length=NAME_MAX)
    color: str | None = Field(
        None, min_length=COLOR_HEX_MAX, max_length=COLOR_HEX_MAX, pattern=COLOR_HEX_PATTERN
    )

    _strip_name = field_validator("name", mode="before")(_strip_str)


class SettingsUpdate(BaseModel):
    """Request model for updating app settings."""

    list_sort: str | None = None


class ListReorder(BaseModel):
    """Request model for reordering lists."""

    list_ids: list[str]


class HistoryEntry(BaseModel):
    """Request model for a single history entry during restore."""

    action: str = Field(..., max_length=50)
    item_text: str | None = Field(None, max_length=TEXT_MAX)
    timestamp: str | None = Field(None, max_length=TIMESTAMP_MAX)


class SyncListState(BaseModel):
    """Validated ``newDocumentState`` for the ``lists`` RxDB collection.

    Fields mirror the REST ``ListCreate``/``ListUpdate`` length constraints so the
    sync path cannot be used to bypass them. All fields except ``id`` are optional
    because RxDB replication sends partial states.
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: str = Field(..., min_length=1, max_length=ID_MAX)
    name: str | None = Field(None, max_length=NAME_MAX)
    icon: str | None = Field(None, max_length=ICON_MAX)
    item_sort: str | None = Field(None, max_length=SORT_OPTION_MAX)
    sort_order: int | None = None
    created_at: str | None = Field(None, max_length=TIMESTAMP_MAX)
    updated_at: str | None = Field(None, max_length=TIMESTAMP_MAX)
    deleted: int | None = Field(None, ge=0, le=1, alias="_deleted")


class SyncItemState(BaseModel):
    """Validated ``newDocumentState`` for the ``items`` RxDB collection.

    Fields mirror the REST ``ItemCreate``/``ItemUpdate`` length constraints.
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: str = Field(..., min_length=1, max_length=ID_MAX)
    list_id: str | None = Field(None, min_length=1, max_length=ID_MAX)
    text: str | None = Field(None, max_length=TEXT_MAX)
    completed: int | None = Field(None, ge=0, le=1)
    category_id: str | None = Field(None, max_length=ID_MAX)
    created_at: str | None = Field(None, max_length=TIMESTAMP_MAX)
    updated_at: str | None = Field(None, max_length=TIMESTAMP_MAX)
    completed_at: str | None = Field(None, max_length=TIMESTAMP_MAX)
    deleted: int | None = Field(None, ge=0, le=1, alias="_deleted")


class SyncCategoryState(BaseModel):
    """Validated ``newDocumentState`` for the ``categories`` RxDB collection."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: str = Field(..., min_length=1, max_length=ID_MAX)
    list_id: str | None = Field(None, min_length=1, max_length=ID_MAX)
    name: str | None = Field(None, max_length=NAME_MAX)
    color: str | None = Field(
        None, min_length=COLOR_HEX_MAX, max_length=COLOR_HEX_MAX, pattern=COLOR_HEX_PATTERN
    )
    created_at: str | None = Field(None, max_length=TIMESTAMP_MAX)
    updated_at: str | None = Field(None, max_length=TIMESTAMP_MAX)
    deleted: int | None = Field(None, ge=0, le=1, alias="_deleted")


class SyncChange(BaseModel):
    """A single document change from an RxDB replication push.

    RxDB sends camelCase JSON keys; aliases map them to snake_case attributes.
    """

    model_config = ConfigDict(populate_by_name=True)

    new_document_state: dict[str, Any] = Field(alias="newDocumentState")
    assumed_master_state: dict[str, Any] | None = Field(default=None, alias="assumedMasterState")


class FrontendErrorReport(BaseModel):
    """Request model for frontend error reports sent to the server."""

    message: str = Field(..., min_length=1, max_length=2000)
    stack: str | None = Field(None, max_length=2000)
    action: str = Field(..., max_length=200)
    user_agent: str | None = Field(None, max_length=500)
    timestamp: str | None = Field(None, max_length=30)

    _strip_message = field_validator("message", mode="before")(_strip_str)


class ListResponse(BaseModel):
    """Response model for list endpoints; filters out internal fields like `_deleted`."""

    id: str
    name: str
    icon: str
    item_sort: str
    sort_order: int
    created_at: str
    updated_at: str
    total_items: int | None = None
    completed_items: int | None = None


class ItemResponse(BaseModel):
    """Response model for item endpoints; filters out internal fields like `_deleted`."""

    id: str
    list_id: str
    text: str
    completed: bool
    category_id: str | None = None
    created_at: str
    updated_at: str
    completed_at: str | None = None


class CategoryResponse(BaseModel):
    """Response model for category endpoints."""

    id: str
    list_id: str
    name: str
    color: str
    created_at: str
    updated_at: str


class SuccessResponse(BaseModel):
    """Generic success envelope returned by mutating endpoints without a resource body."""

    success: bool = True


# Valid sort options for items
VALID_SORT_OPTIONS: list[str] = [
    "alphabetical",
    "alphabetical_desc",
    "created_desc",
    "created_asc",
]

# Valid sort options for lists
VALID_LIST_SORT_OPTIONS: list[str] = [
    "alphabetical",
    "alphabetical_desc",
    "created_desc",
    "created_asc",
    "custom",
]

# Sort option to SQL ORDER BY mapping
SORT_SQL: dict[str, str] = {
    "alphabetical": "text COLLATE NOCASE ASC",
    "alphabetical_desc": "text COLLATE NOCASE DESC",
    "created_desc": "created_at DESC",
    "created_asc": "created_at ASC",
}
