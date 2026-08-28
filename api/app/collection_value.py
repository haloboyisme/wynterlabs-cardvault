import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Literal

from sqlalchemy import Integer, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import CardPrinting, CollectionItem, CollectionValueSnapshot

VALUE_QUANTUM = Decimal("0.01")
PRICE_KEYS = {"nonfoil": "usd", "foil": "usd_foil", "etched": "usd_etched"}
HistoryRange = Literal["hour", "day", "week", "month", "quarter", "year", "all"]
CaptureTrigger = Literal["collection", "price", "view"]
MAX_HISTORY_POINTS = 500


@dataclass(frozen=True)
class CollectionValuation:
    estimated_value_usd: Decimal
    priced_copies: int
    unpriced_copies: int
    total_copies: int
    oldest_price_snapshot_at: datetime | None


@dataclass(frozen=True)
class CollectionValueHistory:
    range: HistoryRange
    points: list[CollectionValueSnapshot]
    current: CollectionValuation
    change_usd: Decimal
    change_percent: Decimal | None


def utc_timestamp(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def finish_price(prices: dict[str, str | None], finish: str) -> Decimal | None:
    key = PRICE_KEYS.get(finish)
    raw = prices.get(key) if key else None
    if raw is None:
        return None
    try:
        price = Decimal(raw.strip())
    except (AttributeError, InvalidOperation):
        return None
    return price if price.is_finite() and price >= 0 else None


def collection_price(item: CollectionItem, printing: CardPrinting) -> Decimal | None:
    catalog_price = finish_price(printing.prices, item.finish)
    return catalog_price if catalog_price is not None else item.manual_price_usd


async def collection_valuation(database: AsyncSession, user_id: uuid.UUID) -> CollectionValuation:
    value_rows = (
        await database.execute(
            select(
                CollectionItem.quantity,
                CollectionItem.finish,
                CollectionItem.manual_price_usd,
                CardPrinting.prices,
                CardPrinting.price_snapshot_at,
            )
            .select_from(CollectionItem)
            .join(CardPrinting, CardPrinting.id == CollectionItem.printing_id)
            .where(CollectionItem.user_id == user_id)
        )
    ).all()
    estimated_value = Decimal("0")
    priced_copies = 0
    unpriced_copies = 0
    contributing_snapshots: list[datetime] = []
    for quantity, finish, manual_price, prices, snapshot_at in value_rows:
        catalog_price = finish_price(prices, finish)
        price = catalog_price if catalog_price is not None else manual_price
        if price is None:
            unpriced_copies += int(quantity)
            continue
        priced_copies += int(quantity)
        estimated_value += price * int(quantity)
        if catalog_price is not None and snapshot_at is not None:
            contributing_snapshots.append(utc_timestamp(snapshot_at))
    return CollectionValuation(
        estimated_value_usd=estimated_value.quantize(VALUE_QUANTUM),
        priced_copies=priced_copies,
        unpriced_copies=unpriced_copies,
        total_copies=priced_copies + unpriced_copies,
        oldest_price_snapshot_at=min(contributing_snapshots) if contributing_snapshots else None,
    )


async def capture_collection_value(
    database: AsyncSession,
    user_id: uuid.UUID,
    trigger: CaptureTrigger,
    now: datetime | None = None,
) -> CollectionValueSnapshot:
    captured_at = utc_timestamp(now or datetime.now(UTC)).replace(microsecond=0)
    minute_bucket = captured_at.replace(second=0, microsecond=0)
    valuation = await collection_valuation(database, user_id)
    values = {
        "user_id": user_id,
        "minute_bucket": minute_bucket,
        "captured_at": captured_at,
        "estimated_value_usd": valuation.estimated_value_usd,
        "priced_copies": valuation.priced_copies,
        "unpriced_copies": valuation.unpriced_copies,
        "total_copies": valuation.total_copies,
        "oldest_price_snapshot_at": valuation.oldest_price_snapshot_at,
        "trigger": trigger,
    }
    dialect = database.get_bind().dialect.name
    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert

        statement = insert(CollectionValueSnapshot).values(**values)
    elif dialect == "sqlite":
        from sqlalchemy.dialects.sqlite import insert

        statement = insert(CollectionValueSnapshot).values(**values)
    else:
        snapshot = await database.scalar(
            select(CollectionValueSnapshot)
            .where(
                CollectionValueSnapshot.user_id == user_id,
                CollectionValueSnapshot.minute_bucket == minute_bucket,
            )
            .with_for_update()
        )
        if snapshot is None:
            snapshot = CollectionValueSnapshot(**values)
            database.add(snapshot)
        elif captured_at >= utc_timestamp(snapshot.captured_at):
            for key, value in values.items():
                setattr(snapshot, key, value)
        await database.flush()
        return snapshot

    excluded = statement.excluded
    await database.execute(
        statement.on_conflict_do_update(
            index_elements=("user_id", "minute_bucket"),
            set_={
                "captured_at": excluded.captured_at,
                "estimated_value_usd": excluded.estimated_value_usd,
                "priced_copies": excluded.priced_copies,
                "unpriced_copies": excluded.unpriced_copies,
                "total_copies": excluded.total_copies,
                "oldest_price_snapshot_at": excluded.oldest_price_snapshot_at,
                "trigger": excluded.trigger,
            },
            where=excluded.captured_at >= CollectionValueSnapshot.captured_at,
        )
    )
    snapshot = await database.scalar(
        select(CollectionValueSnapshot).where(
            CollectionValueSnapshot.user_id == user_id,
            CollectionValueSnapshot.minute_bucket == minute_bucket,
        )
    )
    assert snapshot is not None
    return snapshot


async def capture_collection_value_best_effort(
    session_factory: async_sessionmaker[AsyncSession],
    user_id: uuid.UUID,
    trigger: CaptureTrigger,
) -> None:
    async with session_factory() as database:
        try:
            await capture_collection_value(database, user_id, trigger)
            await database.commit()
        except Exception:
            await database.rollback()


async def capture_collection_price_snapshots(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    try:
        async with session_factory() as database:
            result = await database.scalars(select(CollectionItem.user_id).distinct())
            user_ids = list(result.all())
    except Exception:
        return
    for user_id in user_ids:
        await capture_collection_value_best_effort(session_factory, user_id, "price")


def _range_cutoff(range_name: HistoryRange, now: datetime) -> datetime | None:
    cutoffs: dict[HistoryRange, timedelta | None] = {
        "hour": timedelta(hours=1),
        "day": timedelta(days=1),
        "week": timedelta(days=7),
        "month": timedelta(days=31),
        "quarter": timedelta(days=92),
        "year": timedelta(days=366),
        "all": None,
    }
    duration = cutoffs[range_name]
    return now - duration if duration is not None else None


def _sql_bucket(range_name: HistoryRange, dialect: str):
    if range_name == "hour":
        return None
    if range_name == "day":
        captured_at = CollectionValueSnapshot.captured_at
        if dialect == "sqlite":
            minute = func.cast(func.strftime("%M", captured_at), Integer)
            bucket_minute = minute - (minute % 5)
            return func.strftime("%Y-%m-%dT%H:", captured_at).op("||")(
                func.printf("%02d:00", bucket_minute)
            )
        return func.to_timestamp(func.floor(func.extract("epoch", captured_at) / 300) * 300)
    if dialect == "sqlite":
        formats = {
            "week": "%Y-%m-%dT%H:00:00",
            "month": "%Y-%m-%dT%H:00:00",
            "quarter": "%Y-%m-%dT%H:00:00",
            "year": "%Y-%m-%dT00:00:00",
            "all": "%Y-%m-01T00:00:00",
        }
        return func.strftime(formats[range_name], CollectionValueSnapshot.captured_at)
    periods = {
        "week": "hour",
        "month": "hour",
        "quarter": "hour",
        "year": "day",
        "all": "month",
    }
    return func.date_trunc(periods[range_name], CollectionValueSnapshot.captured_at)


def _bounded_history_statement(
    user_id: uuid.UUID,
    range_name: HistoryRange,
    cutoff: datetime | None,
    dialect: str,
):
    filters = [CollectionValueSnapshot.user_id == user_id]
    if cutoff is not None:
        filters.append(CollectionValueSnapshot.captured_at >= cutoff)
    bucket = _sql_bucket(range_name, dialect)
    if bucket is None:
        latest_ids = (
            select(CollectionValueSnapshot.id)
            .where(*filters)
            .order_by(CollectionValueSnapshot.captured_at.desc(), CollectionValueSnapshot.id.desc())
            .limit(MAX_HISTORY_POINTS)
            .subquery()
        )
    else:
        ranked = (
            select(
                CollectionValueSnapshot.id,
                func.row_number()
                .over(
                    partition_by=bucket,
                    order_by=(
                        CollectionValueSnapshot.captured_at.desc(),
                        CollectionValueSnapshot.id.desc(),
                    ),
                )
                .label("bucket_rank"),
                func.row_number()
                .over(
                    order_by=(
                        CollectionValueSnapshot.captured_at,
                        CollectionValueSnapshot.id,
                    )
                )
                .label("first_rank"),
                func.row_number()
                .over(
                    order_by=(
                        CollectionValueSnapshot.captured_at.desc(),
                        CollectionValueSnapshot.id.desc(),
                    )
                )
                .label("last_rank"),
            )
            .where(*filters)
            .subquery()
        )
        bucket_filter = ranked.c.bucket_rank == 1
        if range_name == "day":
            bucket_filter = or_(
                bucket_filter,
                ranked.c.first_rank == 1,
                ranked.c.last_rank == 1,
            )
        latest_ids = (
            select(CollectionValueSnapshot.id)
            .join(ranked, CollectionValueSnapshot.id == ranked.c.id)
            .where(bucket_filter)
            .order_by(CollectionValueSnapshot.captured_at.desc(), CollectionValueSnapshot.id.desc())
            .limit(MAX_HISTORY_POINTS)
            .subquery()
        )
    return (
        select(CollectionValueSnapshot)
        .join(latest_ids, CollectionValueSnapshot.id == latest_ids.c.id)
        .order_by(CollectionValueSnapshot.captured_at, CollectionValueSnapshot.id)
    )


async def read_collection_value_history(
    database: AsyncSession,
    user_id: uuid.UUID,
    range_name: HistoryRange,
    now: datetime | None = None,
) -> CollectionValueHistory:
    current_time = utc_timestamp(now or datetime.now(UTC))
    cutoff = _range_cutoff(range_name, current_time)
    statement = _bounded_history_statement(
        user_id,
        range_name,
        cutoff,
        database.get_bind().dialect.name,
    )
    snapshots = list(
        (
            await database.scalars(
                statement.order_by(CollectionValueSnapshot.captured_at, CollectionValueSnapshot.id)
            )
        ).all()
    )
    points = snapshots
    valuation = await collection_valuation(database, user_id)
    if points:
        first_value = points[0].estimated_value_usd
        last_value = points[-1].estimated_value_usd
        change_usd = (last_value - first_value).quantize(VALUE_QUANTUM)
        change_percent = (
            None
            if first_value == 0
            else (change_usd * Decimal("100") / first_value).quantize(VALUE_QUANTUM)
        )
    else:
        change_usd = Decimal("0.00")
        change_percent = None
    return CollectionValueHistory(
        range=range_name,
        points=points,
        current=valuation,
        change_usd=change_usd,
        change_percent=change_percent,
    )
