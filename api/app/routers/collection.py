import math
import uuid
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog.games import current_game_matches, normalize_game
from app.catalog.summary import card_rows, card_summary, first_face_images
from app.collection_constants import COLLECTION_CONDITIONS
from app.collection_csv import (
    MAX_COLLECTION_CSV_BYTES,
    CollectionCsvError,
    export_collection_csv,
    parse_collection_csv,
)
from app.collection_import_schemas import (
    CollectionImportConfirmOut,
    CollectionImportPreviewOut,
)
from app.collection_imports import (
    confirm_preview,
    create_preview,
    export_rows,
    get_preview,
)
from app.collection_schemas import (
    CollectionBreakdownOut,
    CollectionItemCreate,
    CollectionItemOut,
    CollectionItemUpdate,
    CollectionManualPriceOut,
    CollectionManualPriceUpdate,
    CollectionMissingPriceItemOut,
    CollectionMissingPricePageOut,
    CollectionPageOut,
    CollectionSetSummaryOut,
    CollectionSummaryOut,
)
from app.collection_value import (
    VALUE_QUANTUM,
    capture_collection_value,
    capture_collection_value_best_effort,
    collection_price,
    collection_valuation,
    finish_price,
    read_collection_value_history,
    utc_timestamp,
)
from app.collection_value_schemas import CollectionValueHistoryOut, CollectionValuePointOut
from app.database import get_db
from app.dependencies import CurrentAuth, require_ready_auth
from app.errors import AppError
from app.models import CardPrinting, CardSet, CollectionItem, OracleCard, TradeListing

router = APIRouter(prefix="/api/v1/collection", tags=["collection"])
CollectionSort = Literal[
    "updated",
    "created_desc",
    "created_asc",
    "name",
    "name_desc",
    "quantity",
    "quantity_asc",
    "price_desc",
    "price_asc",
    "missing_price",
]
CollectionPriceStatus = Literal["priced", "missing"]
CollectionValueRange = Literal["hour", "day", "week", "month", "quarter", "year", "all"]


@router.get("", response_model=CollectionPageOut)
async def list_collection(
    q: Annotated[str | None, Query(min_length=1, max_length=120)] = None,
    set_code: Annotated[str | None, Query(alias="set", min_length=1, max_length=12)] = None,
    collector_number: Annotated[str | None, Query(min_length=1, max_length=32)] = None,
    rarity: Annotated[str | None, Query(min_length=1, max_length=32)] = None,
    finish: Annotated[str | None, Query()] = None,
    condition: Annotated[str | None, Query()] = None,
    price_status: Annotated[CollectionPriceStatus | None, Query()] = None,
    game: Annotated[str | None, Query(max_length=32)] = None,
    sort: Annotated[CollectionSort, Query()] = "updated",
    page: Annotated[int, Query(ge=1, le=10000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> CollectionPageOut:
    normalized_game = normalize_game(game)
    if not current_game_matches(normalized_game):
        return CollectionPageOut(
            items=[],
            page=page,
            page_size=page_size,
            total=0,
            pages=0,
        )

    statement = _collection_rows().where(CollectionItem.user_id == auth.user.id)
    if normalized_game:
        statement = statement.where(CardPrinting.game == normalized_game)
    if q:
        statement = statement.where(func.lower(OracleCard.name).like(f"%{q.strip().lower()}%"))
    if set_code:
        normalized_set = set_code.strip().lower()
        if not normalized_set:
            raise AppError(422, "validation_error", "Set must not be blank.")
        statement = statement.where(CardSet.code_normalized == normalized_set)
    if collector_number:
        normalized_collector = _normalized_filter(collector_number, "Collector number")
        statement = statement.where(
            func.lower(CardPrinting.collector_number) == normalized_collector
        )
    if rarity:
        normalized_rarity = _normalized_filter(rarity, "Rarity")
        statement = statement.where(func.lower(CardPrinting.rarity) == normalized_rarity)
    if finish:
        statement = statement.where(CollectionItem.finish == _finish(finish))
    if condition:
        statement = statement.where(CollectionItem.condition == _condition(condition))

    price_sorts = {"price_desc", "price_asc", "missing_price"}
    if price_status is not None or sort in price_sorts:
        ordered_statement = statement if sort in price_sorts else _ordered(statement, sort)
        all_rows = list((await database.execute(ordered_statement)).all())
        if price_status is not None:
            want_priced = price_status == "priced"
            all_rows = [
                row for row in all_rows if (_collection_price(row) is not None) == want_priced
            ]
        total = len(all_rows)
        if sort in price_sorts:
            all_rows = _price_ordered(all_rows, sort)
        rows = all_rows[(page - 1) * page_size : page * page_size]
    else:
        total = await database.scalar(select(func.count()).select_from(statement.subquery())) or 0
        rows = list(
            (
                await database.execute(
                    _ordered(statement, sort).offset((page - 1) * page_size).limit(page_size)
                )
            ).all()
        )
    images = await first_face_images(database, [printing.id for _, printing, _, _ in rows])
    return CollectionPageOut(
        items=[
            _out(item, printing, oracle, card_set, images)
            for item, printing, oracle, card_set in rows
        ],
        page=page,
        page_size=page_size,
        total=total,
        pages=math.ceil(total / page_size) if total else 0,
    )


@router.get("/summary", response_model=CollectionSummaryOut)
async def collection_summary(
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> CollectionSummaryOut:
    await _capture_current_value(database, auth.user.id)
    return await _summary(database, auth.user.id)


@router.get("/value-history", response_model=CollectionValueHistoryOut)
async def collection_value_history(
    range: Annotated[CollectionValueRange, Query()] = "month",
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> CollectionValueHistoryOut:
    await _capture_current_value(database, auth.user.id)
    history = await read_collection_value_history(database, auth.user.id, range)
    return CollectionValueHistoryOut(
        range=history.range,
        points=[
            CollectionValuePointOut(
                timestamp=utc_timestamp(point.captured_at),
                estimated_value_usd=f"{point.estimated_value_usd:.2f}",
                priced_copies=point.priced_copies,
                unpriced_copies=point.unpriced_copies,
                total_copies=point.total_copies,
                oldest_price_snapshot_at=(
                    utc_timestamp(point.oldest_price_snapshot_at)
                    if point.oldest_price_snapshot_at is not None
                    else None
                ),
            )
            for point in history.points
        ],
        current_value_usd=f"{history.current.estimated_value_usd:.2f}",
        change_usd=f"{history.change_usd:.2f}",
        change_percent=(
            f"{history.change_percent:.2f}" if history.change_percent is not None else None
        ),
        priced_copies=history.current.priced_copies,
        unpriced_copies=history.current.unpriced_copies,
        total_copies=history.current.total_copies,
    )


@router.get("/pricing/missing", response_model=CollectionMissingPricePageOut)
async def missing_collection_prices(
    page: Annotated[int, Query(ge=1, le=10000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> CollectionMissingPricePageOut:
    rows = list(
        (
            await database.execute(
                _ordered(
                    _collection_rows().where(CollectionItem.user_id == auth.user.id),
                    "name",
                )
            )
        ).all()
    )
    missing = [
        row
        for row in rows
        if finish_price(row[1].prices, row[0].finish) is None and row[0].manual_price_usd is None
    ]
    total = len(missing)
    start = (page - 1) * page_size
    selected = missing[start : start + page_size]
    images = await first_face_images(database, [printing.id for _, printing, _, _ in selected])
    return CollectionMissingPricePageOut(
        items=[
            CollectionMissingPriceItemOut(
                id=item.id,
                printing_id=item.printing_id,
                finish=item.finish,
                condition=item.condition,
                quantity=item.quantity,
                revision=item.revision,
                manual_price_usd=None,
                source_uri=printing.source_uri,
                card=card_summary(printing, oracle, card_set, images),
            )
            for item, printing, oracle, card_set in selected
        ],
        page=page,
        page_size=page_size,
        total=total,
        pages=math.ceil(total / page_size) if total else 0,
    )


@router.put("/pricing/items/{item_id}", response_model=CollectionManualPriceOut)
async def set_collection_manual_price(
    item_id: uuid.UUID,
    payload: CollectionManualPriceUpdate,
    request: Request,
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> CollectionManualPriceOut:
    async with database.begin():
        item = await database.scalar(
            select(CollectionItem)
            .where(CollectionItem.id == item_id, CollectionItem.user_id == auth.user.id)
            .with_for_update()
        )
        if item is None:
            raise AppError(404, "collection_item_not_found", "Collection item was not found.")
        if item.revision != payload.expected_revision:
            raise AppError(
                409, "collection_item_stale", "Collection item has changed. Refresh and retry."
            )
        item.manual_price_usd = payload.manual_price_usd.quantize(VALUE_QUANTUM)
        item.revision += 1
        await database.flush()
    await _capture_best_effort(request.app.state.session_factory, auth.user.id, "price")
    return CollectionManualPriceOut(
        id=item.id,
        manual_price_usd=f"{item.manual_price_usd:.2f}",
        revision=item.revision,
    )


@router.get("/export.csv")
async def export_collection(
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    rows = await export_rows(database, auth.user.id)
    return StreamingResponse(
        export_collection_csv(rows),
        media_type="text/csv; charset=utf-8",
        headers={
            "Cache-Control": "no-store",
            "Content-Disposition": 'attachment; filename="wynterlabs-collection.csv"',
        },
    )


@router.post(
    "/imports/preview",
    response_model=CollectionImportPreviewOut,
    status_code=201,
)
async def preview_collection_import(
    request: Request,
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> CollectionImportPreviewOut:
    if not request.headers.get("content-type", "").lower().startswith("text/csv"):
        raise AppError(415, "unsupported_media_type", "Upload a text/csv document.")
    try:
        payload = bytearray()
        async for chunk in request.stream():
            if len(payload) + len(chunk) > MAX_COLLECTION_CSV_BYTES:
                raise AppError(422, "file_too_large", "CSV exceeds the 2 MiB limit.")
            payload.extend(chunk)
        parsed = parse_collection_csv(bytes(payload))
    except CollectionCsvError as error:
        raise AppError(422, error.code, error.message) from error
    preview = await create_preview(database, auth.user.id, parsed)
    await database.commit()
    return _preview_out(preview)


@router.get(
    "/imports/{preview_id}",
    response_model=CollectionImportPreviewOut,
)
async def read_collection_import(
    preview_id: uuid.UUID,
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> CollectionImportPreviewOut:
    preview = await get_preview(database, auth.user.id, preview_id)
    return _preview_out(preview)


@router.post(
    "/imports/{preview_id}/confirm",
    response_model=CollectionImportConfirmOut,
)
async def apply_collection_import(
    preview_id: uuid.UUID,
    request: Request,
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> CollectionImportConfirmOut:
    async with database.begin():
        applied = await confirm_preview(database, auth.user.id, preview_id)
    await _capture_best_effort(request.app.state.session_factory, auth.user.id, "collection")
    return CollectionImportConfirmOut(preview_id=preview_id, applied_rows=applied)


@router.delete("/imports/{preview_id}", status_code=204)
async def cancel_collection_import(
    preview_id: uuid.UUID,
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> Response:
    async with database.begin():
        preview = await get_preview(database, auth.user.id, preview_id, lock=True)
        if preview.confirmed_at is not None:
            raise AppError(
                409,
                "collection_import_already_confirmed",
                "Confirmed collection imports cannot be cancelled.",
            )
        await database.delete(preview)
    return Response(status_code=204)


@router.post("/items", response_model=CollectionItemOut, status_code=201)
async def create_collection_item(
    payload: CollectionItemCreate,
    response: Response,
    request: Request,
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> CollectionItemOut:
    user_id = auth.user.id
    printing = await _active_printing(database, payload.printing_id)
    _validate_finish(printing, payload.finish)
    created = False
    try:
        item = await database.scalar(_tuple_query(user_id, payload).with_for_update())
        if item is None:
            item = CollectionItem(
                user_id=user_id,
                printing_id=payload.printing_id,
                finish=payload.finish,
                condition=payload.condition,
                quantity=payload.quantity,
            )
            database.add(item)
            created = True
        else:
            _increment(item, payload.quantity)
        await database.commit()
    except IntegrityError as error:
        await database.rollback()
        item = await database.scalar(_tuple_query(user_id, payload).with_for_update())
        if item is None:
            raise AppError(
                409, "collection_write_conflict", "Try adding this item again."
            ) from error
        _increment(item, payload.quantity)
        await database.commit()
        created = False
    await _capture_best_effort(request.app.state.session_factory, user_id, "collection")
    response.status_code = 201 if created else 200
    return await _item_out(database, item)


@router.put("/items/{item_id}", response_model=CollectionItemOut)
async def update_collection_item(
    item_id: uuid.UUID,
    payload: CollectionItemUpdate,
    request: Request,
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> CollectionItemOut:
    async with database.begin():
        printing_id = await database.scalar(
            select(CollectionItem.printing_id).where(
                CollectionItem.id == item_id,
                CollectionItem.user_id == auth.user.id,
            )
        )
        if printing_id is None:
            raise AppError(404, "collection_item_not_found", "Collection item was not found.")

        # Every update in a printing scope takes the same stable lock order.
        # This makes inverse tuple changes serialize instead of deadlocking.
        printing_items = list(
            (
                await database.scalars(
                    select(CollectionItem)
                    .where(
                        CollectionItem.user_id == auth.user.id,
                        CollectionItem.printing_id == printing_id,
                    )
                    .order_by(CollectionItem.id)
                    .with_for_update()
                )
            ).all()
        )
        item = next((candidate for candidate in printing_items if candidate.id == item_id), None)
        if item is None:
            raise AppError(404, "collection_item_not_found", "Collection item was not found.")
        if item.revision != payload.expected_revision:
            raise AppError(
                409, "collection_item_stale", "Collection item has changed. Refresh and retry."
            )
        finish = payload.finish if payload.finish is not None else item.finish
        condition = payload.condition if payload.condition is not None else item.condition
        if finish != item.finish or condition != item.condition:
            collision = next(
                (
                    candidate
                    for candidate in printing_items
                    if candidate.id != item.id
                    and candidate.finish == finish
                    and candidate.condition == condition
                ),
                None,
            )
            if collision is not None:
                raise AppError(
                    409,
                    "collection_tuple_conflict",
                    "A collection item already uses that printing, finish, and condition.",
                )
        if payload.finish is not None:
            printing = await database.scalar(
                select(CardPrinting).where(CardPrinting.id == item.printing_id)
            )
            if printing is None:
                raise AppError(404, "printing_not_found", "Card printing was not found.")
            _validate_finish(printing, finish)
        if payload.quantity is not None:
            item.quantity = payload.quantity
            listing = await database.scalar(
                select(TradeListing)
                .where(TradeListing.collection_item_id == item.id)
                .with_for_update()
            )
            if listing is not None and listing.quantity > item.quantity:
                listing.quantity = item.quantity
                listing.revision += 1
        item.finish = finish
        item.condition = condition
        item.revision += 1
        try:
            await database.flush()
        except IntegrityError as error:
            raise AppError(
                409,
                "collection_tuple_conflict",
                "A collection item already uses that printing, finish, and condition.",
            ) from error
    await _capture_best_effort(request.app.state.session_factory, auth.user.id, "collection")
    return await _item_out(database, item)


@router.delete("/items/{item_id}", status_code=204)
async def delete_collection_item(
    item_id: uuid.UUID,
    expected_revision: Annotated[int, Query(ge=1)],
    request: Request,
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> Response:
    async with database.begin():
        item = await database.scalar(
            select(CollectionItem)
            .where(CollectionItem.id == item_id, CollectionItem.user_id == auth.user.id)
            .with_for_update()
        )
        if item is None:
            raise AppError(404, "collection_item_not_found", "Collection item was not found.")
        if item.revision != expected_revision:
            raise AppError(
                409,
                "collection_item_stale",
                "Collection item has changed. Refresh and retry.",
            )
        await database.delete(item)
    await _capture_best_effort(request.app.state.session_factory, auth.user.id, "collection")
    return Response(status_code=204)


def _collection_rows():
    return (
        select(CollectionItem, CardPrinting, OracleCard, CardSet)
        .join(CardPrinting, CardPrinting.id == CollectionItem.printing_id)
        .join(OracleCard, OracleCard.id == CardPrinting.oracle_card_id)
        .join(CardSet, CardSet.id == CardPrinting.card_set_id)
    )


def _tuple_query(user_id: uuid.UUID, payload: CollectionItemCreate):
    return select(CollectionItem).where(
        CollectionItem.user_id == user_id,
        CollectionItem.printing_id == payload.printing_id,
        CollectionItem.finish == payload.finish,
        CollectionItem.condition == payload.condition,
    )


async def _active_printing(database: AsyncSession, printing_id: uuid.UUID) -> CardPrinting:
    printing = await database.scalar(
        select(CardPrinting).where(CardPrinting.id == printing_id, CardPrinting.active.is_(True))
    )
    if printing is None:
        raise AppError(404, "printing_not_found", "Card printing was not found.")
    return printing


def _validate_finish(printing: CardPrinting, finish: str) -> None:
    if finish not in (printing.finishes or []):
        raise AppError(
            422, "finish_not_available", "That finish is not available for this printing."
        )


def _increment(item: CollectionItem, amount: int) -> None:
    if item.quantity + amount > 9999:
        raise AppError(422, "quantity_limit_exceeded", "Collection quantity cannot exceed 9999.")
    item.quantity += amount
    item.revision += 1


def _finish(value: str) -> str:
    normalized = value.strip().lower()
    if not 1 <= len(normalized) <= 16:
        raise AppError(422, "validation_error", "Invalid finish filter.")
    return normalized


def _condition(value: str) -> str:
    if value not in COLLECTION_CONDITIONS:
        raise AppError(422, "validation_error", "Invalid condition filter.")
    return value


def _normalized_filter(value: str, label: str) -> str:
    normalized = value.strip().lower()
    if not normalized:
        raise AppError(422, "validation_error", f"{label} must not be blank.")
    return normalized


def _ordered(statement, sort: CollectionSort):
    if sort == "created_desc":
        return statement.order_by(CollectionItem.created_at.desc(), CollectionItem.id)
    if sort == "created_asc":
        return statement.order_by(CollectionItem.created_at, CollectionItem.id)
    if sort == "name":
        return statement.order_by(
            OracleCard.name_normalized,
            CardSet.code_normalized,
            CardPrinting.collector_number,
            CollectionItem.id,
        )
    if sort == "name_desc":
        return statement.order_by(
            OracleCard.name_normalized.desc(),
            CardSet.code_normalized.desc(),
            CardPrinting.collector_number.desc(),
            CollectionItem.id,
        )
    if sort == "quantity":
        return statement.order_by(
            CollectionItem.quantity.desc(), OracleCard.name_normalized, CollectionItem.id
        )
    if sort == "quantity_asc":
        return statement.order_by(
            CollectionItem.quantity, OracleCard.name_normalized, CollectionItem.id
        )
    return statement.order_by(CollectionItem.updated_at.desc(), CollectionItem.id)


def _price_ordered(rows, sort: CollectionSort):
    def details(row):
        item, printing, oracle, card_set = row
        price = _collection_price(row)
        stable = (
            oracle.name_normalized,
            card_set.code_normalized,
            printing.collector_number,
            str(item.id),
        )
        return price, stable

    def descending(row):
        price, stable = details(row)
        return price is None, -(price or Decimal("0")), stable

    def ascending(row):
        price, stable = details(row)
        return price is None, price or Decimal("0"), stable

    def missing_first(row):
        price, stable = details(row)
        return price is not None, stable

    if sort == "price_desc":
        return sorted(rows, key=descending)
    if sort == "price_asc":
        return sorted(rows, key=ascending)
    return sorted(rows, key=missing_first)


def _collection_price(row) -> Decimal | None:
    item, printing, _, _ = row
    return collection_price(item, printing)


async def _summary(database: AsyncSession, user_id: uuid.UUID) -> CollectionSummaryOut:
    total_copies, distinct_items, distinct_oracle_cards, distinct_sets = (
        await database.execute(
            select(
                func.coalesce(func.sum(CollectionItem.quantity), 0),
                func.count(CollectionItem.id),
                func.count(func.distinct(CardPrinting.oracle_card_id)),
                func.count(func.distinct(CardPrinting.card_set_id)),
            )
            .select_from(CollectionItem)
            .join(CardPrinting, CardPrinting.id == CollectionItem.printing_id)
            .where(CollectionItem.user_id == user_id)
        )
    ).one()
    finish_rows = (
        await database.execute(
            select(CollectionItem.finish, func.sum(CollectionItem.quantity))
            .where(CollectionItem.user_id == user_id)
            .group_by(CollectionItem.finish)
            .order_by(func.sum(CollectionItem.quantity).desc(), CollectionItem.finish)
        )
    ).all()
    condition_rows = (
        await database.execute(
            select(CollectionItem.condition, func.sum(CollectionItem.quantity))
            .where(CollectionItem.user_id == user_id)
            .group_by(CollectionItem.condition)
            .order_by(func.sum(CollectionItem.quantity).desc(), CollectionItem.condition)
        )
    ).all()
    set_rows = (
        await database.execute(
            select(
                CardSet.code_normalized,
                CardSet.name,
                CardSet.game,
                func.sum(CollectionItem.quantity),
                func.count(CollectionItem.id),
            )
            .select_from(CollectionItem)
            .join(CardPrinting, CardPrinting.id == CollectionItem.printing_id)
            .join(CardSet, CardSet.id == CardPrinting.card_set_id)
            .where(CollectionItem.user_id == user_id)
            .group_by(CardSet.code_normalized, CardSet.name, CardSet.game)
            .order_by(
                func.sum(CollectionItem.quantity).desc(),
                func.lower(CardSet.name),
                CardSet.code_normalized,
            )
        )
    ).all()
    valuation = await collection_valuation(database, user_id)
    return CollectionSummaryOut(
        total_copies=int(total_copies),
        distinct_items=int(distinct_items),
        distinct_oracle_cards=int(distinct_oracle_cards),
        distinct_sets=int(distinct_sets),
        estimated_value_usd=f"{valuation.estimated_value_usd:.2f}",
        priced_copies=valuation.priced_copies,
        unpriced_copies=valuation.unpriced_copies,
        price_snapshot_at=valuation.oldest_price_snapshot_at,
        finishes=[
            CollectionBreakdownOut(value=value, copies=int(copies)) for value, copies in finish_rows
        ],
        conditions=[
            CollectionBreakdownOut(value=value, copies=int(copies))
            for value, copies in condition_rows
        ],
        sets=[
            CollectionSetSummaryOut(
                code=code,
                name=name,
                game=game,
                copies=int(copies),
                distinct_items=int(item_count),
            )
            for code, name, game, copies, item_count in set_rows
        ],
    )


async def _capture_current_value(database: AsyncSession, user_id: uuid.UUID) -> None:
    await capture_collection_value(database, user_id, "view")
    await database.commit()


async def _capture_best_effort(
    session_factory,
    user_id: uuid.UUID,
    trigger: Literal["collection", "price"],
) -> None:
    try:
        await capture_collection_value_best_effort(session_factory, user_id, trigger)
    except Exception:
        return


async def _item_out(database: AsyncSession, item: CollectionItem) -> CollectionItemOut:
    row = (
        await database.execute(card_rows().where(CardPrinting.id == item.printing_id))
    ).one_or_none()
    if row is None:
        raise AppError(404, "printing_not_found", "Card printing was not found.")
    printing, oracle, card_set = row
    images = await first_face_images(database, [printing.id])
    return _out(item, printing, oracle, card_set, images)


def _out(item, printing, oracle, card_set, images: dict) -> CollectionItemOut:
    return CollectionItemOut(
        id=item.id,
        printing_id=item.printing_id,
        finish=item.finish,
        condition=item.condition,
        quantity=item.quantity,
        revision=item.revision,
        created_at=item.created_at,
        updated_at=item.updated_at,
        card=card_summary(printing, oracle, card_set, images),
    )


def _preview_out(preview) -> CollectionImportPreviewOut:
    return CollectionImportPreviewOut(
        id=preview.id,
        rows=preview.rows,
        summary=preview.summary,
        revision=preview.revision,
        expires_at=preview.expires_at,
        confirmed_at=preview.confirmed_at,
    )
