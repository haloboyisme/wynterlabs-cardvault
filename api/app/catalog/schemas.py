import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field


class CatalogCounts(BaseModel):
    sets: int = Field(ge=0)
    oracle_cards: int = Field(ge=0)
    printings: int = Field(ge=0)


class CatalogStatusOut(BaseModel):
    ready: bool
    stale: bool
    source_updated_at: datetime | None
    completed_at: datetime | None
    counts: CatalogCounts


class CardSetOut(BaseModel):
    game: str
    id: uuid.UUID
    code: str
    name: str
    set_type: str
    released_at: date | None
    card_count: int
    digital: bool
    icon_svg_uri: str | None


class CardFaceOut(BaseModel):
    face_index: int
    name: str
    mana_cost: str | None
    type_line: str | None
    oracle_text: str | None
    colors: list[str]
    image_uris: dict[str, str]
    artist: str | None


class CardSummaryOut(BaseModel):
    printing_id: uuid.UUID
    oracle_id: uuid.UUID
    name: str
    mana_cost: str | None
    type_line: str | None
    set: CardSetOut
    collector_number: str
    rarity: str
    released_at: date | None
    language: str
    layout: str
    image_uris: dict[str, str]
    prices: dict[str, str | None]
    finishes: list[str]
    colors: list[str]
    active: bool


class ScanCandidateOut(CardSummaryOut):
    rank_reason: str


class CardPageOut(BaseModel):
    items: list[CardSummaryOut]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=100)
    total: int = Field(ge=0)
    pages: int = Field(ge=0)


class CardDetailOut(CardSummaryOut):
    oracle_text: str | None
    cmc: float
    color_identity: list[str]
    keywords: list[str]
    legalities: dict[str, str]
    artist: str | None
    digital: bool
    promo: bool
    frame: str | None
    border_color: str | None
    image_status: str | None
    source_uri: str | None
    price_snapshot_at: datetime | None
    games: list[str]
    faces: list[CardFaceOut]


class PrintingListOut(BaseModel):
    items: list[CardSummaryOut]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=200)
    total: int = Field(ge=0)
    pages: int = Field(ge=0)


class SetPageOut(BaseModel):
    items: list[CardSetOut]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=200)
    total: int = Field(ge=0)
    pages: int = Field(ge=0)
