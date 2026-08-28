import math
import secrets
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentAuth, require_catalog_operator, require_ready_auth
from app.errors import AppError
from app.identity import revoke_user_sessions
from app.models import (
    CardPrinting,
    CardSet,
    CollectionItem,
    OracleCard,
    Role,
    TradeListing,
    TradeModerationEvent,
    TradeReport,
    TradeStrike,
    TradingAccount,
    User,
    WantListing,
)
from app.trading_constants import SUPPORT_EMAIL
from app.trading_schemas import (
    ListingModeration,
    MatchOut,
    MatchPageOut,
    MemberAccountStatusUpdate,
    ModerationDecision,
    ReportCreate,
    ReportOut,
    StrikeVoid,
    TradeCreate,
    TradeOut,
    TradePageOut,
    TradeUpdate,
    TradingAccountOut,
    TradingStatusUpdate,
    WantCreate,
    WantOut,
    WantPageOut,
    WantUpdate,
)

router = APIRouter(tags=["private trading"])


async def require_member_trading_enabled(
    request: Request,
    auth: CurrentAuth = Depends(require_ready_auth),
) -> CurrentAuth:
    if not request.app.state.settings.trading_enabled:
        raise AppError(404, "trading_paused", "Trading is temporarily unavailable.")
    return auth


async def _account(database: AsyncSession, user_id: uuid.UUID, *, lock=False) -> TradingAccount:
    statement = select(TradingAccount).where(TradingAccount.user_id == user_id)
    if lock:
        statement = statement.with_for_update()
    account = await database.scalar(statement.execution_options(populate_existing=True))
    if account is not None:
        return account
    try:
        async with database.begin_nested():
            account = TradingAccount(user_id=user_id, status="active", active_strikes=0, revision=1)
            database.add(account)
            await database.flush()
    except IntegrityError:
        statement = select(TradingAccount).where(TradingAccount.user_id == user_id)
        if lock:
            statement = statement.with_for_update()
        account = await database.scalar(statement.execution_options(populate_existing=True))
        if account is None:
            raise
    return account


def _account_out(account: TradingAccount) -> TradingAccountOut:
    return TradingAccountOut(
        status=account.status,
        active_strikes=account.active_strikes,
        revision=account.revision,
        suspended_at=account.suspended_at,
        support_email=SUPPORT_EMAIL,
    )


def _trade_out(row) -> TradeOut:
    listing, item, printing, oracle, card_set = row
    return TradeOut(
        id=listing.id,
        collection_item_id=item.id,
        printing_id=printing.id,
        oracle_id=oracle.id,
        card_name=oracle.name,
        set_code=card_set.code,
        set_name=card_set.name,
        collector_number=printing.collector_number,
        finish=item.finish,
        condition=item.condition,
        owned_quantity=item.quantity,
        quantity=listing.quantity,
        status=listing.status,
        revision=listing.revision,
    )


def _trade_rows():
    return (
        select(TradeListing, CollectionItem, CardPrinting, OracleCard, CardSet)
        .join(CollectionItem, CollectionItem.id == TradeListing.collection_item_id)
        .join(CardPrinting, CardPrinting.id == CollectionItem.printing_id)
        .join(OracleCard, OracleCard.id == CardPrinting.oracle_card_id)
        .join(CardSet, CardSet.id == CardPrinting.card_set_id)
    )


@router.get("/api/v1/trading/account", response_model=TradingAccountOut)
async def trading_account(
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
):
    account = await _account(database, auth.user.id)
    await database.commit()
    return _account_out(account)


@router.get("/api/v1/trades", response_model=TradePageOut)
async def list_trades(
    page: Annotated[int, Query(ge=1, le=10000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
    auth: CurrentAuth = Depends(require_member_trading_enabled),
    database: AsyncSession = Depends(get_db),
):
    total = (
        await database.scalar(
            select(func.count())
            .select_from(TradeListing)
            .where(TradeListing.user_id == auth.user.id)
        )
        or 0
    )
    rows = list(
        (
            await database.execute(
                _trade_rows()
                .where(TradeListing.user_id == auth.user.id)
                .order_by(TradeListing.updated_at.desc(), TradeListing.id)
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
    )
    return TradePageOut(
        items=[_trade_out(row) for row in rows],
        page=page,
        page_size=page_size,
        total=total,
        pages=math.ceil(total / page_size) if total else 0,
    )


@router.post("/api/v1/trades", response_model=TradeOut, status_code=201)
async def create_trade(
    payload: TradeCreate,
    auth: CurrentAuth = Depends(require_member_trading_enabled),
    database: AsyncSession = Depends(get_db),
):
    account = await _account(database, auth.user.id, lock=True)
    if account.status != "active":
        raise AppError(403, "trading_suspended", "Trading is suspended for this account.")
    item = await database.scalar(
        select(CollectionItem)
        .where(
            CollectionItem.id == payload.collection_item_id, CollectionItem.user_id == auth.user.id
        )
        .with_for_update()
    )
    if item is None:
        raise AppError(404, "collection_item_not_found", "Collection item was not found.")
    if payload.quantity > item.quantity:
        raise AppError(
            422, "trade_quantity_unavailable", "Offered quantity exceeds owned quantity."
        )
    printing = await database.scalar(
        select(CardPrinting).where(CardPrinting.id == item.printing_id)
    )
    listing = TradeListing(
        user_id=auth.user.id,
        collection_item_id=item.id,
        oracle_card_id=printing.oracle_card_id,
        quantity=payload.quantity,
        status="active",
        revision=1,
    )
    database.add(listing)
    try:
        await database.flush()
    except IntegrityError as exc:
        await database.rollback()
        raise AppError(
            409, "trade_listing_conflict", "That collection item is already listed."
        ) from exc
    row = (await database.execute(_trade_rows().where(TradeListing.id == listing.id))).one()
    await database.commit()
    return _trade_out(row)


async def _owned_listing(database, user_id, listing_id, *, lock=True):
    statement = select(TradeListing).where(
        TradeListing.id == listing_id, TradeListing.user_id == user_id
    )
    if lock:
        statement = statement.with_for_update()
    listing = await database.scalar(statement.execution_options(populate_existing=True))
    if listing is None:
        raise AppError(404, "trade_listing_not_found", "Trade listing was not found.")
    return listing


@router.put("/api/v1/trades/{listing_id}", response_model=TradeOut)
async def update_trade(
    listing_id: uuid.UUID,
    payload: TradeUpdate,
    auth: CurrentAuth = Depends(require_member_trading_enabled),
    database: AsyncSession = Depends(get_db),
):
    account = await _account(database, auth.user.id, lock=True)
    if account.status != "active":
        raise AppError(403, "trading_suspended", "Trading is suspended for this account.")
    collection_item_id = await database.scalar(
        select(TradeListing.collection_item_id).where(
            TradeListing.id == listing_id,
            TradeListing.user_id == auth.user.id,
        )
    )
    if collection_item_id is None:
        raise AppError(404, "trade_listing_not_found", "Trade listing was not found.")
    item = await database.scalar(
        select(CollectionItem).where(CollectionItem.id == collection_item_id).with_for_update()
    )
    listing = await _owned_listing(database, auth.user.id, listing_id)
    if listing.revision != payload.expected_revision:
        raise AppError(
            409, "trade_revision_conflict", "Trade listing changed; refresh and try again."
        )
    if payload.quantity > item.quantity:
        raise AppError(
            422, "trade_quantity_unavailable", "Offered quantity exceeds owned quantity."
        )
    listing.quantity = payload.quantity
    listing.status = payload.status
    listing.revision += 1
    await database.flush()
    row = (await database.execute(_trade_rows().where(TradeListing.id == listing.id))).one()
    await database.commit()
    return _trade_out(row)


@router.delete("/api/v1/trades/{listing_id}", status_code=204)
async def remove_trade(
    listing_id: uuid.UUID,
    expected_revision: Annotated[int, Query(ge=1)],
    auth: CurrentAuth = Depends(require_member_trading_enabled),
    database: AsyncSession = Depends(get_db),
):
    await _account(database, auth.user.id, lock=True)
    listing = await _owned_listing(database, auth.user.id, listing_id)
    if listing.revision != expected_revision:
        raise AppError(
            409, "trade_revision_conflict", "Trade listing changed; refresh and try again."
        )
    listing.status = "removed"
    listing.revision += 1
    await database.commit()


def _want_out(want, oracle) -> WantOut:
    return WantOut(
        id=want.id,
        oracle_id=want.oracle_card_id,
        printing_id=want.printing_id,
        finish=want.finish,
        condition=want.condition,
        quantity=want.quantity,
        card_name=oracle.name,
        status=want.status,
        revision=want.revision,
    )


async def _validate_want(database, payload):
    oracle = await database.scalar(
        select(OracleCard).where(OracleCard.id == payload.oracle_id, OracleCard.active.is_(True))
    )
    if oracle is None:
        raise AppError(404, "oracle_card_not_found", "Oracle card was not found.")
    if payload.printing_id:
        printing = await database.scalar(
            select(CardPrinting).where(
                CardPrinting.id == payload.printing_id,
                CardPrinting.oracle_card_id == payload.oracle_id,
            )
        )
        if printing is None:
            raise AppError(
                422, "want_printing_mismatch", "Printing does not belong to the wanted card."
            )
    return oracle


@router.get("/api/v1/wants", response_model=WantPageOut)
async def list_wants(
    page: Annotated[int, Query(ge=1, le=10000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
    auth: CurrentAuth = Depends(require_member_trading_enabled),
    database: AsyncSession = Depends(get_db),
):
    total = (
        await database.scalar(
            select(func.count()).select_from(WantListing).where(WantListing.user_id == auth.user.id)
        )
        or 0
    )
    rows = list(
        (
            await database.execute(
                select(WantListing, OracleCard)
                .join(OracleCard, OracleCard.id == WantListing.oracle_card_id)
                .where(WantListing.user_id == auth.user.id)
                .order_by(WantListing.updated_at.desc(), WantListing.id)
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
    )
    return WantPageOut(
        items=[_want_out(*row) for row in rows],
        page=page,
        page_size=page_size,
        total=total,
        pages=math.ceil(total / page_size) if total else 0,
    )


@router.post("/api/v1/wants", response_model=WantOut, status_code=201)
async def create_want(
    payload: WantCreate,
    auth: CurrentAuth = Depends(require_member_trading_enabled),
    database: AsyncSession = Depends(get_db),
):
    account = await _account(database, auth.user.id, lock=True)
    if account.status != "active":
        raise AppError(403, "trading_suspended", "Trading is suspended for this account.")
    oracle = await _validate_want(database, payload)
    want = WantListing(
        user_id=auth.user.id,
        oracle_card_id=payload.oracle_id,
        printing_id=payload.printing_id,
        finish=payload.finish,
        condition=payload.condition,
        quantity=payload.quantity,
        status="active",
        revision=1,
    )
    database.add(want)
    await database.commit()
    await database.refresh(want)
    return _want_out(want, oracle)


@router.put("/api/v1/wants/{want_id}", response_model=WantOut)
async def update_want(
    want_id: uuid.UUID,
    payload: WantUpdate,
    auth: CurrentAuth = Depends(require_member_trading_enabled),
    database: AsyncSession = Depends(get_db),
):
    account = await _account(database, auth.user.id, lock=True)
    if account.status != "active":
        raise AppError(403, "trading_suspended", "Trading is suspended for this account.")
    want = await database.scalar(
        select(WantListing)
        .where(WantListing.id == want_id, WantListing.user_id == auth.user.id)
        .with_for_update()
    )
    if want is None:
        raise AppError(404, "want_not_found", "Want was not found.")
    if want.revision != payload.expected_revision:
        raise AppError(409, "want_revision_conflict", "Want changed; refresh and try again.")
    oracle = await _validate_want(database, payload)
    for field in ("oracle_id", "printing_id", "finish", "condition", "quantity", "status"):
        setattr(want, "oracle_card_id" if field == "oracle_id" else field, getattr(payload, field))
    want.revision += 1
    await database.commit()
    await database.refresh(want)
    return _want_out(want, oracle)


@router.delete("/api/v1/wants/{want_id}", status_code=204)
async def remove_want(
    want_id: uuid.UUID,
    expected_revision: Annotated[int, Query(ge=1)],
    auth: CurrentAuth = Depends(require_member_trading_enabled),
    database: AsyncSession = Depends(get_db),
):
    await _account(database, auth.user.id, lock=True)
    want = await database.scalar(
        select(WantListing)
        .where(WantListing.id == want_id, WantListing.user_id == auth.user.id)
        .with_for_update()
    )
    if want is None:
        raise AppError(404, "want_not_found", "Want was not found.")
    if want.revision != expected_revision:
        raise AppError(409, "want_revision_conflict", "Want changed; refresh and try again.")
    want.status = "removed"
    want.revision += 1
    await database.commit()


@router.get("/api/v1/trade-matches", response_model=MatchPageOut)
async def trade_matches(
    page: Annotated[int, Query(ge=1, le=10000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
    auth: CurrentAuth = Depends(require_member_trading_enabled),
    database: AsyncSession = Depends(get_db),
):
    base = (
        select(WantListing, TradeListing, User, CollectionItem, CardPrinting, OracleCard, CardSet)
        .join(
            TradeListing,
            and_(
                TradeListing.oracle_card_id == WantListing.oracle_card_id,
                TradeListing.status == "active",
                TradeListing.user_id != auth.user.id,
            ),
        )
        .join(
            TradingAccount,
            and_(TradingAccount.user_id == TradeListing.user_id, TradingAccount.status == "active"),
        )
        .join(User, and_(User.id == TradeListing.user_id, User.is_active.is_(True)))
        .join(CollectionItem, CollectionItem.id == TradeListing.collection_item_id)
        .join(CardPrinting, CardPrinting.id == CollectionItem.printing_id)
        .join(OracleCard, OracleCard.id == CardPrinting.oracle_card_id)
        .join(CardSet, CardSet.id == CardPrinting.card_set_id)
        .where(
            WantListing.user_id == auth.user.id,
            WantListing.status == "active",
            or_(WantListing.printing_id.is_(None), WantListing.printing_id == CardPrinting.id),
            or_(WantListing.finish.is_(None), WantListing.finish == CollectionItem.finish),
            or_(WantListing.condition.is_(None), WantListing.condition == CollectionItem.condition),
        )
    )
    total = await database.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = list(
        (
            await database.execute(
                base.order_by(
                    OracleCard.name_normalized, User.display_name_normalized, TradeListing.id
                )
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
    )
    items = [
        MatchOut(
            want_id=want.id,
            listing_id=listing.id,
            member_display_name=user.display_name,
            printing_id=printing.id,
            oracle_id=oracle.id,
            card_name=oracle.name,
            set_code=card_set.code,
            set_name=card_set.name,
            collector_number=printing.collector_number,
            finish=item.finish,
            condition=item.condition,
            available_quantity=min(item.quantity, listing.quantity),
        )
        for want, listing, user, item, printing, oracle, card_set in rows
    ]
    return MatchPageOut(
        items=items,
        page=page,
        page_size=page_size,
        total=total,
        pages=math.ceil(total / page_size) if total else 0,
    )


def _report_out(report, reporter=None, reported=None):
    return ReportOut(
        id=report.id,
        incident_reference=report.incident_reference,
        reporter_display_name=reporter.display_name if reporter else None,
        reported_user_id=report.reported_user_id,
        reported_display_name=reported.display_name,
        listing_id=report.trade_listing_id,
        reason=report.reason,
        details=report.details,
        status=report.status,
        revision=report.revision,
        created_at=report.created_at,
    )


@router.post("/api/v1/trade-reports", response_model=ReportOut, status_code=201)
async def create_report(
    payload: ReportCreate,
    auth: CurrentAuth = Depends(require_member_trading_enabled),
    database: AsyncSession = Depends(get_db),
):
    listing = await database.scalar(
        select(TradeListing)
        .where(TradeListing.id == payload.listing_id, TradeListing.status == "active")
        .with_for_update()
    )
    if listing is None or listing.user_id == auth.user.id:
        raise AppError(404, "trade_listing_not_found", "Trade listing was not found.")
    duplicate = await database.scalar(
        select(TradeReport.id).where(
            TradeReport.reporter_user_id == auth.user.id,
            TradeReport.trade_listing_id == listing.id,
        )
    )
    if duplicate:
        raise AppError(409, "trade_report_exists", "You already reported this listing.")
    report = TradeReport(
        reporter_user_id=auth.user.id,
        reported_user_id=listing.user_id,
        trade_listing_id=listing.id,
        reason=payload.reason,
        details=payload.details,
        status="open",
        incident_reference="WL-" + secrets.token_hex(6).upper(),
        revision=1,
    )
    database.add(report)
    database.add(
        TradeModerationEvent(
            target_user_id=listing.user_id,
            actor_user_id=auth.user.id,
            event_type="report_created",
            incident_reference=report.incident_reference,
            details={"reason": payload.reason},
        )
    )
    try:
        await database.flush()
    except IntegrityError as exc:
        await database.rollback()
        raise AppError(409, "trade_report_exists", "You already reported this listing.") from exc
    await database.commit()
    await database.refresh(report)
    reported = await database.get(User, listing.user_id)
    return _report_out(report, reported=reported)


@router.get("/api/v1/trade-reports", response_model=list[ReportOut])
async def my_reports(
    auth: CurrentAuth = Depends(require_member_trading_enabled),
    database: AsyncSession = Depends(get_db),
):
    rows = list(
        (
            await database.execute(
                select(TradeReport, User)
                .join(User, User.id == TradeReport.reported_user_id)
                .where(TradeReport.reporter_user_id == auth.user.id)
                .order_by(TradeReport.created_at.desc())
                .limit(100)
            )
        ).all()
    )
    return [_report_out(report, reported=user) for report, user in rows]


@router.get("/api/v1/admin/trade-moderation/reports", response_model=list[ReportOut])
async def moderation_reports(
    _operator: CurrentAuth = Depends(require_catalog_operator),
    database: AsyncSession = Depends(get_db),
):
    reporter = User.__table__.alias("reporter")
    reported = User.__table__.alias("reported")
    rows = (
        await database.execute(
            select(
                TradeReport,
                reporter.c.display_name,
                reported.c.display_name,
                TradingAccount,
                TradeListing.revision,
                TradeStrike.id,
                TradeStrike.revision,
                TradeStrike.status,
            )
            .join(reporter, reporter.c.id == TradeReport.reporter_user_id)
            .join(reported, reported.c.id == TradeReport.reported_user_id)
            .join(TradingAccount, TradingAccount.user_id == TradeReport.reported_user_id)
            .outerjoin(TradeListing, TradeListing.id == TradeReport.trade_listing_id)
            .outerjoin(TradeStrike, TradeStrike.report_id == TradeReport.id)
            .order_by(TradeReport.status, TradeReport.created_at, TradeReport.id)
            .limit(200)
        )
    ).all()
    return [
        ReportOut(
            id=report.id,
            incident_reference=report.incident_reference,
            reporter_display_name=reporter_name,
            reported_user_id=report.reported_user_id,
            reported_display_name=reported_name,
            reported_trading_status=account.status,
            reported_active_strikes=account.active_strikes,
            reported_trading_revision=account.revision,
            listing_id=report.trade_listing_id,
            listing_revision=listing_revision,
            strike_id=strike_id,
            strike_revision=strike_revision,
            strike_status=strike_status,
            reason=report.reason,
            details=report.details,
            status=report.status,
            revision=report.revision,
            created_at=report.created_at,
        )
        for (
            report,
            reporter_name,
            reported_name,
            account,
            listing_revision,
            strike_id,
            strike_revision,
            strike_status,
        ) in rows
    ]


@router.post("/api/v1/admin/trade-moderation/reports/{report_id}", response_model=ReportOut)
async def moderate_report(
    report_id: uuid.UUID,
    payload: ModerationDecision,
    operator: CurrentAuth = Depends(require_catalog_operator),
    database: AsyncSession = Depends(get_db),
):
    report = await database.scalar(
        select(TradeReport).where(TradeReport.id == report_id).with_for_update()
    )
    if report is None:
        raise AppError(404, "trade_report_not_found", "Trade report was not found.")
    if report.revision != payload.expected_revision or report.status != "open":
        raise AppError(409, "trade_report_conflict", "Report changed; refresh and try again.")
    account = await _account(database, report.reported_user_id, lock=True)
    now = datetime.now(UTC)
    report.status = "upheld" if payload.action == "uphold" else "dismissed"
    report.moderated_by_user_id = operator.user.id
    report.moderated_at = now
    report.revision += 1
    event_type = "report_upheld" if payload.action == "uphold" else "report_dismissed"
    if payload.action == "uphold":
        database.add(
            TradeStrike(
                trading_account_id=account.id,
                report_id=report.id,
                status="active",
                reason=(payload.note or report.reason)[:1000],
                issued_by_user_id=operator.user.id,
                revision=1,
            )
        )
        account.active_strikes = min(3, account.active_strikes + 1)
        account.revision += 1
        if account.active_strikes >= 3 and account.status != "suspended":
            account.status = "suspended"
            account.suspended_at = now
            await database.execute(
                TradeListing.__table__.update()
                .where(
                    TradeListing.user_id == report.reported_user_id,
                    TradeListing.status == "active",
                )
                .values(status="removed", revision=TradeListing.revision + 1, updated_at=now)
            )
            database.add(
                TradeModerationEvent(
                    target_user_id=report.reported_user_id,
                    actor_user_id=operator.user.id,
                    event_type="trading_suspended",
                    incident_reference=report.incident_reference,
                    details={"active_strikes": account.active_strikes},
                )
            )
    database.add(
        TradeModerationEvent(
            target_user_id=report.reported_user_id,
            actor_user_id=operator.user.id,
            event_type=event_type,
            incident_reference=report.incident_reference,
            details={"note": (payload.note or "")[:1000]},
        )
    )
    await database.commit()
    await database.refresh(report)
    reported = await database.get(User, report.reported_user_id)
    return _report_out(report, reported=reported)


@router.post("/api/v1/admin/trade-moderation/listings/{listing_id}", response_model=TradeOut)
async def moderate_listing(
    listing_id: uuid.UUID,
    payload: ListingModeration,
    operator: CurrentAuth = Depends(require_catalog_operator),
    database: AsyncSession = Depends(get_db),
):
    listing = await database.scalar(
        select(TradeListing).where(TradeListing.id == listing_id).with_for_update()
    )
    if listing is None:
        raise AppError(404, "trade_listing_not_found", "Trade listing was not found.")
    if listing.revision != payload.expected_revision:
        raise AppError(
            409, "trade_revision_conflict", "Trade listing changed; refresh and try again."
        )
    account = await _account(database, listing.user_id, lock=True)
    if payload.status == "active" and account.status != "active":
        raise AppError(409, "trading_suspended", "Restore trading before restoring listings.")
    listing.status = payload.status
    listing.revision += 1
    database.add(
        TradeModerationEvent(
            target_user_id=listing.user_id,
            actor_user_id=operator.user.id,
            event_type="listing_restored" if payload.status == "active" else "listing_removed",
            details={"note": (payload.note or "")[:1000]},
        )
    )
    await database.flush()
    row = (await database.execute(_trade_rows().where(TradeListing.id == listing.id))).one()
    await database.commit()
    return _trade_out(row)


@router.post(
    "/api/v1/admin/trade-moderation/strikes/{strike_id}/void",
    response_model=TradingAccountOut,
)
async def void_strike(
    strike_id: uuid.UUID,
    payload: StrikeVoid,
    operator: CurrentAuth = Depends(require_catalog_operator),
    database: AsyncSession = Depends(get_db),
):
    account_id = await database.scalar(
        select(TradeStrike.trading_account_id).where(TradeStrike.id == strike_id)
    )
    if account_id is None:
        raise AppError(404, "trade_strike_not_found", "Trade strike was not found.")
    account = await database.scalar(
        select(TradingAccount)
        .where(TradingAccount.id == account_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    strike = await database.scalar(
        select(TradeStrike)
        .where(TradeStrike.id == strike_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if strike is None or strike.status != "active" or strike.revision != payload.expected_revision:
        raise AppError(409, "trade_strike_conflict", "Strike changed; refresh and try again.")
    strike.status = "void"
    strike.voided_by_user_id = operator.user.id
    strike.voided_at = datetime.now(UTC)
    strike.revision += 1
    account.active_strikes = max(0, account.active_strikes - 1)
    account.revision += 1
    database.add(
        TradeModerationEvent(
            target_user_id=account.user_id,
            actor_user_id=operator.user.id,
            event_type="strike_voided",
            details={"note": (payload.note or "")[:1000]},
        )
    )
    await database.commit()
    return _account_out(account)


@router.post(
    "/api/v1/admin/trade-moderation/users/{user_id}/trading", response_model=TradingAccountOut
)
async def set_trading_status(
    user_id: uuid.UUID,
    payload: TradingStatusUpdate,
    operator: CurrentAuth = Depends(require_catalog_operator),
    database: AsyncSession = Depends(get_db),
):
    user = await database.scalar(select(User).where(User.id == user_id).with_for_update())
    if user is None or user.role != Role.MEMBER or user.id == operator.user.id:
        raise AppError(404, "member_not_found", "Member was not found.")
    account = await _account(database, user.id, lock=True)
    if account.revision != payload.expected_revision:
        raise AppError(
            409, "trading_account_conflict", "Trading status changed; refresh and try again."
        )
    if payload.status == "active" and account.active_strikes >= 3:
        raise AppError(409, "active_strikes_remain", "Void a strike before restoring trading.")
    account.status = payload.status
    account.suspended_at = datetime.now(UTC) if payload.status == "suspended" else None
    account.revision += 1
    database.add(
        TradeModerationEvent(
            target_user_id=user.id,
            actor_user_id=operator.user.id,
            event_type="trading_suspended" if payload.status == "suspended" else "trading_restored",
            details={"note": (payload.note or "")[:1000]},
        )
    )
    await database.commit()
    return _account_out(account)


@router.post("/api/v1/admin/trade-moderation/users/{user_id}/account-status", status_code=204)
async def set_member_account_status(
    user_id: uuid.UUID,
    payload: MemberAccountStatusUpdate,
    operator: CurrentAuth = Depends(require_catalog_operator),
    database: AsyncSession = Depends(get_db),
):
    user = await database.scalar(select(User).where(User.id == user_id).with_for_update())
    if user is None or user.role != Role.MEMBER or user.id == operator.user.id:
        raise AppError(404, "member_not_found", "Member was not found.")
    user.is_active = payload.is_active
    if not payload.is_active:
        await revoke_user_sessions(database, user.id, datetime.now(UTC))
    database.add(
        TradeModerationEvent(
            target_user_id=user.id,
            actor_user_id=operator.user.id,
            event_type="account_reactivated" if payload.is_active else "account_deactivated",
            details={"note": (payload.note or "")[:1000]},
        )
    )
    await database.commit()
