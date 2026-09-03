import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class CommunityActivityItem(BaseModel):
    kind: Literal["card_added", "new_member", "catalog_updated", "set_updated"]
    occurred_at: datetime
    display_name: str | None = None
    printing_id: uuid.UUID | None = None
    card_name: str | None = None
    set_name: str | None = None
    set_code: str | None = None
    collector_number: str | None = None
    image_uris: dict[str, str] = Field(default_factory=dict)
    game: str | None = None
    printing_count: int | None = None
    set_count: int | None = None
    released_at: str | None = None


class CommunityActivityOut(BaseModel):
    items: list[CommunityActivityItem]
