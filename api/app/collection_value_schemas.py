from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class CollectionValuePointOut(BaseModel):
    timestamp: datetime
    estimated_value_usd: str
    priced_copies: int = Field(ge=0)
    unpriced_copies: int = Field(ge=0)
    total_copies: int = Field(ge=0)
    oldest_price_snapshot_at: datetime | None


class CollectionValueHistoryOut(BaseModel):
    range: Literal["hour", "day", "week", "month", "quarter", "year", "all"]
    points: list[CollectionValuePointOut]
    current_value_usd: str
    change_usd: str
    change_percent: str | None
    priced_copies: int = Field(ge=0)
    unpriced_copies: int = Field(ge=0)
    total_copies: int = Field(ge=0)
