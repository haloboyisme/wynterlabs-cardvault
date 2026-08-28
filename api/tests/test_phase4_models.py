import asyncio
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.collection_constants import (
    COLLECTION_CONDITIONS,
    DECK_SECTIONS,
    FORMATS,
    allowed_deck_sections,
)
from app.database import Base
from app.models import CollectionItem, Deck, DeckCard


def test_collection_and_deck_models_persist_private_rows_with_revisions_and_timestamps(
    tmp_path,
) -> None:
    asyncio.run(_persist_private_rows(tmp_path))


async def _persist_private_rows(tmp_path) -> None:
    engine = _engine(tmp_path / "phase4.db")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    user_id = uuid.uuid4()
    printing_id = uuid.uuid4()
    collection_item = CollectionItem(
        id=uuid.uuid4(),
        user_id=user_id,
        printing_id=printing_id,
        finish="foil",
        condition="near_mint",
        quantity=3,
    )
    deck = Deck(
        id=uuid.uuid4(),
        user_id=user_id,
        name="Aurora Control",
        name_normalized="aurora control",
        format="commander",
        description="A private test deck.",
    )
    deck_card = DeckCard(
        id=uuid.uuid4(),
        deck_id=deck.id,
        printing_id=printing_id,
        section="commander",
        quantity=1,
    )

    async with session_factory() as session:
        session.add_all([collection_item, deck, deck_card])
        await session.commit()

    async with session_factory() as session:
        saved_item = await session.get(CollectionItem, collection_item.id)
        saved_deck = await session.get(Deck, deck.id)
        saved_card = await session.get(DeckCard, deck_card.id)

    assert saved_item is not None
    assert saved_item.user_id == user_id
    assert saved_item.printing_id == printing_id
    assert saved_item.quantity == 3
    assert saved_item.revision == 1
    assert saved_item.created_at is not None
    assert saved_item.updated_at is not None
    assert saved_deck is not None
    assert saved_deck.user_id == user_id
    assert saved_deck.name == "Aurora Control"
    assert saved_deck.format == "commander"
    assert saved_deck.revision == 1
    assert saved_deck.created_at is not None
    assert saved_deck.updated_at is not None
    assert saved_card is not None
    assert saved_card.deck_id == deck.id
    assert saved_card.printing_id == printing_id
    assert saved_card.section == "commander"
    assert saved_card.revision == 1
    assert saved_card.created_at is not None
    assert saved_card.updated_at is not None
    await engine.dispose()


def test_phase4_models_reject_duplicate_private_keys_and_invalid_bounds(tmp_path) -> None:
    asyncio.run(_reject_invalid_private_rows(tmp_path))


async def _reject_invalid_private_rows(tmp_path) -> None:
    engine = _engine(tmp_path / "phase4-constraints.db")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    user_id = uuid.uuid4()
    printing_id = uuid.uuid4()
    deck_id = uuid.uuid4()
    valid_item = CollectionItem(
        id=uuid.uuid4(),
        user_id=user_id,
        printing_id=printing_id,
        finish="nonfoil",
        condition="near_mint",
        quantity=1,
    )
    valid_deck = Deck(
        id=deck_id,
        user_id=user_id,
        name="Aurora",
        name_normalized="aurora",
        format="modern",
    )
    valid_card = DeckCard(
        id=uuid.uuid4(),
        deck_id=deck_id,
        printing_id=printing_id,
        section="mainboard",
        quantity=1,
    )
    async with session_factory() as session:
        session.add_all([valid_item, valid_deck, valid_card])
        await session.commit()

    invalid_rows = [
        CollectionItem(
            id=uuid.uuid4(),
            user_id=user_id,
            printing_id=printing_id,
            finish="nonfoil",
            condition="near_mint",
            quantity=2,
        ),
        CollectionItem(
            id=uuid.uuid4(),
            user_id=user_id,
            printing_id=uuid.uuid4(),
            finish="",
            condition="near_mint",
            quantity=1,
        ),
        CollectionItem(
            id=uuid.uuid4(),
            user_id=user_id,
            printing_id=uuid.uuid4(),
            finish="foil",
            condition="unknown",
            quantity=1,
        ),
        CollectionItem(
            id=uuid.uuid4(),
            user_id=user_id,
            printing_id=uuid.uuid4(),
            finish="foil",
            condition="near_mint",
            quantity=0,
        ),
        Deck(
            id=uuid.uuid4(),
            user_id=user_id,
            name="Other",
            name_normalized="aurora",
            format="modern",
        ),
        Deck(
            id=uuid.uuid4(),
            user_id=user_id,
            name="Other Format",
            name_normalized="other format",
            format="not-a-format",
        ),
        Deck(
            id=uuid.uuid4(),
            user_id=user_id,
            name="Long Description",
            name_normalized="long description",
            format="modern",
            description="x" * 2001,
        ),
        DeckCard(
            id=uuid.uuid4(),
            deck_id=deck_id,
            printing_id=printing_id,
            section="mainboard",
            quantity=2,
        ),
        DeckCard(
            id=uuid.uuid4(),
            deck_id=deck_id,
            printing_id=uuid.uuid4(),
            section="not-a-section",
            quantity=1,
        ),
        DeckCard(
            id=uuid.uuid4(),
            deck_id=deck_id,
            printing_id=uuid.uuid4(),
            section="sideboard",
            quantity=10000,
        ),
    ]
    for row in invalid_rows:
        async with session_factory() as session:
            session.add(row)
            with pytest.raises(IntegrityError):
                await session.commit()

    await engine.dispose()


def test_phase4_models_restrict_catalog_deletion_and_cascade_deck_cards(tmp_path) -> None:
    asyncio.run(_protect_catalog_references_and_cascade_deck_cards(tmp_path))


async def _protect_catalog_references_and_cascade_deck_cards(tmp_path) -> None:
    engine = _engine(tmp_path / "phase4-foreign-keys.db")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    collection_foreign_keys = CollectionItem.__table__.foreign_keys
    deck_card_foreign_keys = DeckCard.__table__.foreign_keys
    assert (
        next(
            key for key in collection_foreign_keys if key.column.table.name == "card_printings"
        ).ondelete
        == "RESTRICT"
    )
    assert (
        next(
            key for key in deck_card_foreign_keys if key.column.table.name == "card_printings"
        ).ondelete
        == "RESTRICT"
    )
    assert (
        next(key for key in deck_card_foreign_keys if key.column.table.name == "decks").ondelete
        == "CASCADE"
    )

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    deck = Deck(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        name="Cascade Test",
        name_normalized="cascade test",
        format="modern",
    )
    card = DeckCard(
        id=uuid.uuid4(),
        deck_id=deck.id,
        printing_id=uuid.uuid4(),
        section="mainboard",
        quantity=1,
    )
    async with session_factory() as session:
        session.add_all([deck, card])
        await session.commit()
        await session.delete(deck)
        await session.commit()
        assert await session.scalar(select(DeckCard.id).where(DeckCard.id == card.id)) is None

    await engine.dispose()


def test_collection_and_deck_constants_cover_phase4_supported_values() -> None:
    assert COLLECTION_CONDITIONS == (
        "near_mint",
        "lightly_played",
        "moderately_played",
        "heavily_played",
        "damaged",
    )
    assert DECK_SECTIONS == (
        "mainboard",
        "sideboard",
        "companion",
        "maybeboard",
        "commander",
        "oathbreaker",
        "signature_spell",
    )
    assert "commander" in FORMATS
    assert allowed_deck_sections("modern") == (
        "mainboard",
        "sideboard",
        "companion",
        "maybeboard",
    )
    assert allowed_deck_sections("commander") == (
        "commander",
        "mainboard",
        "sideboard",
        "companion",
        "maybeboard",
    )
    assert allowed_deck_sections("oathbreaker") == (
        "oathbreaker",
        "signature_spell",
        "mainboard",
        "sideboard",
        "companion",
        "maybeboard",
    )


def _engine(path):
    return create_async_engine(f"sqlite+aiosqlite:///{path}")
