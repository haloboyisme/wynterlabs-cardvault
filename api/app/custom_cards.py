"""Custom records reuse collection/deck storage but never enter provider imports."""

from decimal import Decimal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import or_

from app.catalog.games import is_supported_game
from app.collection_constants import COLLECTION_CONDITIONS


def visible_to(model, user_id):
    return or_(model.custom_owner_id.is_(None), model.custom_owner_id == user_id)


class CustomCardInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    name: str = Field(min_length=1, max_length=512)
    game: str = Field(min_length=1, max_length=16)
    set_name: str = Field(default="", max_length=240)
    collector_number: str = Field(default="", max_length=64)
    image_url: str | None = Field(default=None, max_length=2048)
    value_usd: Decimal | None = Field(default=None, ge=0, le=999999.99, decimal_places=2)
    condition: str = "near_mint"
    quantity: int = Field(default=1, ge=1, le=9999)

    @field_validator("game")
    @classmethod
    def game_supported(cls, value):
        if value != "custom" and not is_supported_game(value):
            raise ValueError("Choose a supported game.")
        return value

    @field_validator("condition")
    @classmethod
    def valid_condition(cls, value):
        if value not in COLLECTION_CONDITIONS:
            raise ValueError("Choose a supported condition.")
        return value

    @field_validator("image_url")
    @classmethod
    def https_image(cls, value):
        if not value:
            return None
        parsed = urlsplit(value)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.port not in (None, 443)
        ):
            raise ValueError("Use an HTTPS image URL without credentials.")
        return value


class CustomCardFile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: int = Field(default=1, ge=1, le=1)
    cards: list[CustomCardInput] = Field(max_length=500)


async def remove_owned_custom_cards(database, user_id):
    """Remove private card records before the existing account deletion flow."""
    from sqlalchemy import delete, select

    from app.models import CardPrinting, CardSet, CollectionItem, DeckCard, OracleCard

    ids = select(CardPrinting.id).where(CardPrinting.custom_owner_id == user_id)
    await database.execute(delete(DeckCard).where(DeckCard.printing_id.in_(ids)))
    await database.execute(delete(CollectionItem).where(CollectionItem.printing_id.in_(ids)))
    for model in (CardPrinting, OracleCard, CardSet):
        await database.execute(delete(model).where(model.custom_owner_id == user_id))
