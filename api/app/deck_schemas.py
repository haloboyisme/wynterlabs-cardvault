import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.catalog.games import CURRENT_GAME_KEY, is_supported_game, normalize_game
from app.catalog.schemas import CardSummaryOut
from app.collection_constants import FORMATS


class DeckMetadata(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    format: str
    description: str | None = Field(default=None, max_length=2000)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("name is required")
        return cleaned

    @field_validator("format")
    @classmethod
    def valid_format(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in FORMATS:
            raise ValueError("invalid format")
        return normalized

    @field_validator("description", mode="before")
    @classmethod
    def clean_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class DeckCreate(DeckMetadata):
    game: str = CURRENT_GAME_KEY

    @field_validator("game")
    @classmethod
    def valid_game(cls, value: str) -> str:
        normalized = normalize_game(value)
        if not is_supported_game(normalized):
            raise ValueError("invalid game")
        return normalized


class DeckUpdate(DeckMetadata):
    expected_revision: int = Field(ge=1)


class DeckCardSet(BaseModel):
    printing_id: uuid.UUID
    section: str = Field(min_length=1, max_length=32)
    quantity: int = Field(ge=1, le=9999)
    expected_revision: int | None = Field(default=None, ge=1)

    @field_validator("section")
    @classmethod
    def clean_section(cls, value: str) -> str:
        return value.strip().lower()


class DeckCardUpdate(BaseModel):
    section: str = Field(min_length=1, max_length=32)
    quantity: int = Field(ge=1, le=9999)
    expected_revision: int = Field(ge=1)

    @field_validator("section")
    @classmethod
    def clean_section(cls, value: str) -> str:
        return value.strip().lower()


class DeckWarningOut(BaseModel):
    code: str
    message: str
    printing_id: uuid.UUID | None = None


class DeckCardOut(BaseModel):
    id: uuid.UUID
    printing_id: uuid.UUID
    section: str
    quantity: int
    revision: int
    owned_quantity: int = Field(ge=0)
    card: CardSummaryOut


class DeckOut(BaseModel):
    id: uuid.UUID
    name: str
    game: str
    format: str
    description: str | None
    revision: int
    created_at: datetime
    updated_at: datetime


class DeckDetailOut(DeckOut):
    cards: list[DeckCardOut]
    mainboard_count: int = Field(ge=0)
    sideboard_count: int = Field(ge=0)
    warnings: list[DeckWarningOut]


class DeckPageOut(BaseModel):
    items: list[DeckOut]
    total: int = Field(ge=0)
