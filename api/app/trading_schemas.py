import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.collection_constants import COLLECTION_CONDITIONS
from app.trading_constants import REPORT_REASONS


class TradingAccountOut(BaseModel):
    status: Literal["active", "suspended"]
    active_strikes: int = Field(ge=0, le=3)
    revision: int = Field(ge=1)
    suspended_at: datetime | None
    support_email: str


class TradeCreate(BaseModel):
    collection_item_id: uuid.UUID
    quantity: int = Field(ge=1, le=9999)


class TradeUpdate(BaseModel):
    quantity: int = Field(ge=1, le=9999)
    status: Literal["active", "removed"] = "active"
    expected_revision: int = Field(ge=1)


class TradeOut(BaseModel):
    id: uuid.UUID
    collection_item_id: uuid.UUID
    printing_id: uuid.UUID
    oracle_id: uuid.UUID
    card_name: str
    set_code: str
    set_name: str
    collector_number: str
    finish: str
    condition: str
    owned_quantity: int
    quantity: int
    status: str
    revision: int


class TradePageOut(BaseModel):
    items: list[TradeOut]
    page: int
    page_size: int
    total: int
    pages: int


class WantCreate(BaseModel):
    oracle_id: uuid.UUID
    printing_id: uuid.UUID | None = None
    finish: str | None = Field(default=None, max_length=16)
    condition: str | None = None
    quantity: int = Field(ge=1, le=9999)

    @field_validator("condition")
    @classmethod
    def valid_condition(cls, value):
        if value is not None and value not in COLLECTION_CONDITIONS:
            raise ValueError("Invalid condition")
        return value


class WantUpdate(WantCreate):
    status: Literal["active", "removed"] = "active"
    expected_revision: int = Field(ge=1)


class WantOut(WantCreate):
    id: uuid.UUID
    card_name: str
    status: str
    revision: int


class WantPageOut(BaseModel):
    items: list[WantOut]
    page: int
    page_size: int
    total: int
    pages: int


class MatchOut(BaseModel):
    want_id: uuid.UUID
    listing_id: uuid.UUID
    member_display_name: str
    printing_id: uuid.UUID
    oracle_id: uuid.UUID
    card_name: str
    set_code: str
    set_name: str
    collector_number: str
    finish: str
    condition: str
    available_quantity: int


class MatchPageOut(BaseModel):
    items: list[MatchOut]
    page: int
    page_size: int
    total: int
    pages: int


class ReportCreate(BaseModel):
    listing_id: uuid.UUID
    reason: str
    details: str | None = Field(default=None, max_length=1000)

    @field_validator("reason")
    @classmethod
    def valid_reason(cls, value):
        if value not in REPORT_REASONS:
            raise ValueError("Invalid report reason")
        return value

    @field_validator("details")
    @classmethod
    def clean_details(cls, value):
        value = value.strip() if value else None
        return value or None


class ReportOut(BaseModel):
    id: uuid.UUID
    incident_reference: str
    reporter_display_name: str | None = None
    reported_user_id: uuid.UUID
    reported_display_name: str
    reported_trading_status: Literal["active", "suspended"] | None = None
    reported_active_strikes: int | None = Field(default=None, ge=0, le=3)
    reported_trading_revision: int | None = Field(default=None, ge=1)
    listing_id: uuid.UUID | None
    listing_revision: int | None = Field(default=None, ge=1)
    strike_id: uuid.UUID | None = None
    strike_revision: int | None = Field(default=None, ge=1)
    strike_status: Literal["active", "void"] | None = None
    reason: str
    details: str | None
    status: str
    revision: int
    created_at: datetime


class ModerationDecision(BaseModel):
    action: Literal["uphold", "dismiss"]
    expected_revision: int = Field(ge=1)
    note: str | None = Field(default=None, max_length=1000)


class ListingModeration(BaseModel):
    status: Literal["active", "removed"]
    expected_revision: int = Field(ge=1)
    note: str | None = Field(default=None, max_length=1000)


class StrikeVoid(BaseModel):
    expected_revision: int = Field(ge=1)
    note: str | None = Field(default=None, max_length=1000)


class TradingStatusUpdate(BaseModel):
    status: Literal["active", "suspended"]
    expected_revision: int = Field(ge=1)
    note: str | None = Field(default=None, max_length=1000)


class MemberAccountStatusUpdate(BaseModel):
    is_active: bool
    note: str | None = Field(default=None, max_length=1000)
