import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import case, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog.summary import card_summary, first_face_images
from app.collection_constants import allowed_deck_sections
from app.database import get_db
from app.deck_analysis import analyze_deck
from app.deck_schemas import (
    DeckCardOut,
    DeckCardSet,
    DeckCardUpdate,
    DeckCreate,
    DeckDetailOut,
    DeckOut,
    DeckPageOut,
    DeckUpdate,
    DeckWarningOut,
)
from app.dependencies import CurrentAuth, require_ready_auth
from app.errors import AppError
from app.models import CardPrinting, CardSet, CollectionItem, Deck, DeckCard, OracleCard

router = APIRouter(prefix="/api/v1/decks", tags=["decks"])


@router.get("", response_model=DeckPageOut)
async def list_decks(
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> DeckPageOut:
    decks = list(
        (
            await database.scalars(
                select(Deck)
                .where(Deck.user_id == auth.user.id)
                .order_by(Deck.updated_at.desc(), Deck.id)
            )
        ).all()
    )
    return DeckPageOut(items=[_out(deck) for deck in decks], total=len(decks))


@router.post("", response_model=DeckOut, status_code=201)
async def create_deck(
    payload: DeckCreate,
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> DeckOut:
    deck = Deck(
        user_id=auth.user.id,
        name=payload.name,
        name_normalized=payload.name.casefold(),
        game=payload.game,
        format=payload.format,
        description=payload.description,
    )
    database.add(deck)
    try:
        await database.commit()
    except IntegrityError as error:
        await database.rollback()
        raise AppError(
            409, "deck_name_conflict", "You already have a deck with that name."
        ) from error
    return _out(deck)


@router.get("/{deck_id}", response_model=DeckDetailOut)
async def get_deck(
    deck_id: uuid.UUID,
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> DeckDetailOut:
    return await _detail(database, await _deck(database, deck_id, auth.user.id), auth.user.id)


@router.patch("/{deck_id}", response_model=DeckOut)
async def update_deck(
    deck_id: uuid.UUID,
    payload: DeckUpdate,
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> DeckOut:
    async with database.begin():
        deck = await _deck(database, deck_id, auth.user.id, lock=True)
        _revision(deck.revision, payload.expected_revision, "deck_stale")
        if payload.format != deck.format:
            cards = list(
                (await database.scalars(select(DeckCard).where(DeckCard.deck_id == deck.id))).all()
            )
            if any(card.section not in allowed_deck_sections(payload.format) for card in cards):
                raise AppError(
                    422, "deck_section_not_allowed", "Move deck cards before changing format."
                )
        deck.name = payload.name
        deck.name_normalized = payload.name.casefold()
        deck.format = payload.format
        deck.description = payload.description
        deck.revision += 1
        try:
            await database.flush()
        except IntegrityError as error:
            raise AppError(
                409, "deck_name_conflict", "You already have a deck with that name."
            ) from error
    return _out(deck)


@router.delete("/{deck_id}", status_code=204)
async def delete_deck(
    deck_id: uuid.UUID,
    expected_revision: Annotated[int, Query(ge=1)],
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> Response:
    async with database.begin():
        deck = await _deck(database, deck_id, auth.user.id, lock=True)
        _revision(deck.revision, expected_revision, "deck_stale")
        await database.delete(deck)
    return Response(status_code=204)


@router.put("/{deck_id}/cards", response_model=DeckDetailOut)
async def set_deck_card(
    deck_id: uuid.UUID,
    payload: DeckCardSet,
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> DeckDetailOut:
    async with database.begin():
        deck = await _deck(database, deck_id, auth.user.id, lock=True)
        if payload.section not in allowed_deck_sections(deck.format):
            raise AppError(
                422, "deck_section_not_allowed", "That section is not available for this format."
            )
        target = await database.scalar(
            select(DeckCard)
            .where(
                DeckCard.deck_id == deck.id,
                DeckCard.printing_id == payload.printing_id,
                DeckCard.section == payload.section,
            )
            .with_for_update()
        )
        if target is None:
            if payload.expected_revision is not None:
                raise AppError(
                    409,
                    "deck_card_stale",
                    "This deck card no longer exists in the selected section.",
                )
            printing = await database.scalar(
                select(CardPrinting).where(
                    CardPrinting.id == payload.printing_id, CardPrinting.active.is_(True)
                )
            )
            if printing is None:
                raise AppError(404, "printing_not_found", "Card printing was not found.")
            if printing.game != deck.game:
                raise AppError(
                    422,
                    "deck_game_mismatch",
                    "That printing belongs to a different game.",
                )
            target = DeckCard(
                deck_id=deck.id,
                printing_id=payload.printing_id,
                section=payload.section,
                quantity=payload.quantity,
            )
            database.add(target)
        else:
            if payload.expected_revision is None:
                raise AppError(
                    422,
                    "deck_card_revision_required",
                    "Refresh this deck card before changing it.",
                )
            _revision(target.revision, payload.expected_revision, "deck_card_stale")
            target.revision += 1
            target.quantity = payload.quantity
        deck.revision += 1
    return await _detail(database, deck, auth.user.id)


@router.patch("/{deck_id}/cards/{card_id}", response_model=DeckDetailOut)
async def update_deck_card(
    deck_id: uuid.UUID,
    card_id: uuid.UUID,
    payload: DeckCardUpdate,
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> DeckDetailOut:
    async with database.begin():
        deck = await _deck(database, deck_id, auth.user.id, lock=True)
        if payload.section not in allowed_deck_sections(deck.format):
            raise AppError(
                422, "deck_section_not_allowed", "That section is not available for this format."
            )
        card = await database.scalar(
            select(DeckCard)
            .where(DeckCard.id == card_id, DeckCard.deck_id == deck.id)
            .with_for_update()
        )
        if card is None:
            raise AppError(404, "deck_card_not_found", "Deck card was not found.")
        _revision(card.revision, payload.expected_revision, "deck_card_stale")
        collision = await database.scalar(
            select(DeckCard.id).where(
                DeckCard.deck_id == deck.id,
                DeckCard.printing_id == card.printing_id,
                DeckCard.section == payload.section,
                DeckCard.id != card.id,
            )
        )
        if collision is not None:
            raise AppError(
                409,
                "deck_card_conflict",
                "That printing is already in the selected section.",
            )
        card.section = payload.section
        card.quantity = payload.quantity
        card.revision += 1
        deck.revision += 1
    return await _detail(database, deck, auth.user.id)


@router.delete("/{deck_id}/cards/{card_id}", status_code=204)
async def remove_deck_card(
    deck_id: uuid.UUID,
    card_id: uuid.UUID,
    expected_revision: Annotated[int, Query(ge=1)],
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> Response:
    async with database.begin():
        deck = await _deck(database, deck_id, auth.user.id, lock=True)
        card = await database.scalar(
            select(DeckCard)
            .where(DeckCard.id == card_id, DeckCard.deck_id == deck.id)
            .with_for_update()
        )
        if card is None:
            raise AppError(404, "deck_card_not_found", "Deck card was not found.")
        _revision(card.revision, expected_revision, "deck_card_stale")
        await database.delete(card)
        deck.revision += 1
    return Response(status_code=204)


async def _deck(
    database: AsyncSession, deck_id: uuid.UUID, user_id: uuid.UUID, lock: bool = False
) -> Deck:
    statement = select(Deck).where(Deck.id == deck_id, Deck.user_id == user_id)
    if lock:
        statement = statement.with_for_update()
    deck = await database.scalar(statement)
    if deck is None:
        raise AppError(404, "deck_not_found", "Deck was not found.")
    return deck


def _revision(current: int, expected: int, code: str) -> None:
    if current != expected:
        raise AppError(409, code, "This record has changed. Refresh and retry.")


def _out(deck: Deck) -> DeckOut:
    return DeckOut(
        id=deck.id,
        name=deck.name,
        game=deck.game,
        format=deck.format,
        description=deck.description,
        revision=deck.revision,
        created_at=deck.created_at,
        updated_at=deck.updated_at,
    )


async def _detail(database: AsyncSession, deck: Deck, user_id: uuid.UUID) -> DeckDetailOut:
    sections = allowed_deck_sections(deck.format)
    section_order = case(
        {section: position for position, section in enumerate(sections)},
        value=DeckCard.section,
        else_=len(sections),
    )
    rows = list(
        (
            await database.execute(
                select(DeckCard, CardPrinting, OracleCard, CardSet)
                .join(CardPrinting, CardPrinting.id == DeckCard.printing_id)
                .join(OracleCard, OracleCard.id == CardPrinting.oracle_card_id)
                .join(CardSet, CardSet.id == CardPrinting.card_set_id)
                .where(DeckCard.deck_id == deck.id)
                .order_by(
                    section_order,
                    OracleCard.name_normalized,
                    CardPrinting.collector_number,
                    DeckCard.id,
                )
            )
        ).all()
    )
    printing_ids = [printing.id for _, printing, _, _ in rows]
    images = await first_face_images(database, printing_ids)
    ownership_rows = (
        list(
            (
                await database.execute(
                    select(
                        CollectionItem.printing_id,
                        func.coalesce(func.sum(CollectionItem.quantity), 0),
                    )
                    .where(
                        CollectionItem.user_id == user_id,
                        CollectionItem.printing_id.in_(printing_ids),
                    )
                    .group_by(CollectionItem.printing_id)
                )
            ).all()
        )
        if printing_ids
        else []
    )
    owned = {printing_id: int(quantity) for printing_id, quantity in ownership_rows}
    cards = [
        DeckCardOut(
            id=card.id,
            printing_id=printing.id,
            section=card.section,
            quantity=card.quantity,
            revision=card.revision,
            owned_quantity=owned.get(printing.id, 0),
            card=card_summary(printing, oracle, card_set, images),
        )
        for card, printing, oracle, card_set in rows
    ]
    analysis = analyze_deck(
        deck_format=deck.format,
        cards=[
            {
                "printing_id": printing.id,
                "section": card.section,
                "quantity": card.quantity,
                "oracle_id": oracle.id,
                "legalities": oracle.legalities,
                "owned_quantity": owned.get(printing.id, 0),
            }
            for card, printing, oracle, _ in rows
        ],
    )
    return DeckDetailOut(
        **_out(deck).model_dump(),
        cards=cards,
        mainboard_count=analysis.mainboard_count,
        sideboard_count=analysis.sideboard_count,
        warnings=[DeckWarningOut(**warning.__dict__) for warning in analysis.warnings],
    )
