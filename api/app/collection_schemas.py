import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator

from app.catalog.schemas import CardSummaryOut
from app.collection_constants import COLLECTION_CONDITIONS


class _CollectionItemFields(BaseModel):
    finish: str | None = None
    condition: str | None = None
    quantity: int | None = Field(default=None, ge=1, le=9999)

    @field_validator("finish")
    @classmethod
    def normalize_finish(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        if not 1 <= len(normalized) <= 16:
            raise ValueError("finish must be between 1 and 16 characters")
        return normalized

    @field_validator("condition")
    @classmethod
    def validate_condition(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if value not in COLLECTION_CONDITIONS:
            raise ValueError("invalid condition")
        return value


class CollectionItemCreate(_CollectionItemFields):
    printing_id: uuid.UUID
    finish: str
    condition: str
    quantity: int = Field(ge=1, le=9999)


class CollectionItemUpdate(_CollectionItemFields):
    expected_revision: int = Field(ge=1)


class CollectionItemOut(BaseModel):
    id: uuid.UUID
    printing_id: uuid.UUID
    finish: str
    condition: str
    quantity: int
    revision: int
    created_at: datetime
    updated_at: datetime
    card: CardSummaryOut


class CollectionBreakdownOut(BaseModel):
    value: str
    copies: int = Field(ge=0)


class CollectionSetSummaryOut(BaseModel):
    game: str
    code: str
    name: str
    copies: int = Field(ge=0)
    distinct_items: int = Field(ge=0)


class CollectionSummaryOut(BaseModel):
    total_copies: int = Field(ge=0)
    distinct_items: int = Field(ge=0)
    distinct_oracle_cards: int = Field(ge=0)
    distinct_sets: int = Field(ge=0)
    estimated_value_usd: str
    priced_copies: int = Field(ge=0)
    unpriced_copies: int = Field(ge=0)
    price_snapshot_at: datetime | None
    finishes: list[CollectionBreakdownOut]
    conditions: list[CollectionBreakdownOut]
    sets: list[CollectionSetSummaryOut]


class CollectionPageOut(BaseModel):
    items: list[CollectionItemOut]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=100)
    total: int = Field(ge=0)
    pages: int = Field(ge=0)


class CollectionMissingPriceItemOut(BaseModel):
    id: uuid.UUID
    printing_id: uuid.UUID
    finish: str
    condition: str
    quantity: int
    revision: int
    manual_price_usd: str | None
    source_uri: str | None
    card: CardSummaryOut


class CollectionMissingPricePageOut(BaseModel):
    items: list[CollectionMissingPriceItemOut]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=100)
    total: int = Field(ge=0)
    pages: int = Field(ge=0)


class CollectionManualPriceUpdate(BaseModel):
    manual_price_usd: Decimal = Field(ge=0, le=Decimal("999999.99"), max_digits=8, decimal_places=2)
    expected_revision: int = Field(ge=1)


class CollectionManualPriceOut(BaseModel):
    id: uuid.UUID
    manual_price_usd: str
    revision: int
