"""Pydantic request/response models and validation constants."""

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _strip_str(cls, v: object) -> object:
    """Strip whitespace from strings; leave other types for Pydantic to reject."""
    return v.strip() if isinstance(v, str) else v


class ListCreate(BaseModel):
    """Request model for creating a new list."""

    name: str = Field(..., min_length=1, max_length=200)
    icon: str = Field("list", max_length=50)
    undo: bool = False

    _strip_name = field_validator("name", mode="before")(_strip_str)


class ListUpdate(BaseModel):
    """Request model for updating an existing list."""

    name: str | None = Field(None, min_length=1, max_length=200)
    icon: str | None = Field(None, max_length=50)
    item_sort: str | None = None

    _strip_name = field_validator("name", mode="before")(_strip_str)


class ItemCreate(BaseModel):
    """Request model for creating a new item."""

    text: str = Field(..., min_length=1, max_length=1000)
    undo: bool = False

    _strip_text = field_validator("text", mode="before")(_strip_str)


class ItemUpdate(BaseModel):
    """Request model for updating an existing item."""

    text: str | None = Field(None, min_length=1, max_length=1000)
    completed: bool | None = None
    undo: bool = False

    _strip_text = field_validator("text", mode="before")(_strip_str)


class SettingsUpdate(BaseModel):
    """Request model for updating app settings."""

    list_sort: str | None = None


class ListReorder(BaseModel):
    """Request model for reordering lists."""

    list_ids: list[str]


class HistoryEntry(BaseModel):
    """Request model for a single history entry during restore."""

    action: str = Field(..., max_length=50)
    item_text: str | None = Field(None, max_length=1000)
    timestamp: str | None = Field(None, max_length=30)


class SyncChange(BaseModel):
    """A single document change from an RxDB replication push.

    RxDB sends camelCase JSON keys; aliases map them to snake_case attributes.
    """

    model_config = ConfigDict(populate_by_name=True)

    new_document_state: dict = Field(alias="newDocumentState")
    assumed_master_state: dict | None = Field(default=None, alias="assumedMasterState")


class FrontendErrorReport(BaseModel):
    """Request model for frontend error reports sent to the server."""

    message: str = Field(..., min_length=1, max_length=2000)
    stack: str | None = Field(None, max_length=10000)
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
    created_at: str
    updated_at: str
    completed_at: str | None = None


class SuccessResponse(BaseModel):
    """Generic success envelope returned by mutating endpoints without a resource body."""

    success: bool = True


# Valid sort options for items
VALID_SORT_OPTIONS = ["alphabetical", "alphabetical_desc", "created_desc", "created_asc"]

# Valid sort options for lists
VALID_LIST_SORT_OPTIONS = [
    "alphabetical",
    "alphabetical_desc",
    "created_desc",
    "created_asc",
    "custom",
]

# Sort option to SQL ORDER BY mapping
SORT_SQL = {
    "alphabetical": "text COLLATE NOCASE ASC",
    "alphabetical_desc": "text COLLATE NOCASE DESC",
    "created_desc": "created_at DESC",
    "created_asc": "created_at ASC",
}
