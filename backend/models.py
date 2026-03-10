"""Pydantic request models and validation constants."""

from pydantic import BaseModel, Field


class ListCreate(BaseModel):
    """Request model for creating a new list."""

    name: str = Field(..., max_length=200)
    icon: str = Field("list", max_length=50)
    undo: bool = False


class ListUpdate(BaseModel):
    """Request model for updating an existing list."""

    name: str | None = Field(None, max_length=200)
    icon: str | None = Field(None, max_length=50)
    item_sort: str | None = None


class ItemCreate(BaseModel):
    """Request model for creating a new item."""

    text: str = Field(..., max_length=1000)
    undo: bool = False


class ItemUpdate(BaseModel):
    """Request model for updating an existing item."""

    text: str | None = Field(None, max_length=1000)
    completed: bool | None = None
    undo: bool = False


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


class FrontendErrorReport(BaseModel):
    """Request model for frontend error reports sent to the server."""

    message: str = Field(..., max_length=2000)
    stack: str | None = Field(None, max_length=10000)
    action: str = Field(..., max_length=200)
    user_agent: str | None = Field(None, max_length=500)
    timestamp: str | None = Field(None, max_length=30)


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
