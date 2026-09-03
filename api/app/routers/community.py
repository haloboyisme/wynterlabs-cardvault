from datetime import UTC, datetime, time

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.community_schemas import CommunityActivityItem, CommunityActivityOut
from app.database import get_db
from app.dependencies import CurrentAuth, require_ready_auth
from app.models import CardPrinting, CardSet, CatalogImport, CollectionItem, OracleCard, User

router = APIRouter(prefix="/api/v1/community", tags=["community"])


@router.get("/activity", response_model=CommunityActivityOut)
async def activity(
    limit: int = Query(default=24, ge=1, le=50),
    _auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> CommunityActivityOut:
    card_rows = (
        await database.execute(
            select(CollectionItem, User, CardPrinting, OracleCard, CardSet)
            .join(User, User.id == CollectionItem.user_id)
            .join(CardPrinting, CardPrinting.id == CollectionItem.printing_id)
            .join(OracleCard, OracleCard.id == CardPrinting.oracle_card_id)
            .join(CardSet, CardSet.id == CardPrinting.card_set_id)
            .where(User.share_activity.is_(True), User.is_active.is_(True))
            .order_by(CollectionItem.created_at.desc())
            .limit(limit)
        )
    ).all()
    member_rows = list(
        (
            await database.scalars(
                select(User)
                .where(User.share_activity.is_(True), User.is_active.is_(True))
                .order_by(User.created_at.desc())
                .limit(limit)
            )
        ).all()
    )
    catalog_rows = list(
        (
            await database.scalars(
                select(CatalogImport)
                .where(CatalogImport.status == "complete", CatalogImport.completed_at.is_not(None))
                .order_by(CatalogImport.completed_at.desc())
                .limit(limit)
            )
        ).all()
    )
    set_rows = list((await database.scalars(
        select(CardSet)
        .where(CardSet.active.is_(True), CardSet.released_at.is_not(None))
        .order_by(CardSet.released_at.desc())
        .limit(min(limit, 12))
    )).all())

    items = [
        CommunityActivityItem(
            kind="card_added",
            occurred_at=collection.created_at,
            display_name=user.display_name,
            printing_id=printing.id,
            card_name=oracle.name,
            set_name=card_set.name,
            set_code=card_set.code,
            collector_number=printing.collector_number,
            image_uris=printing.image_uris or {},
            game=printing.game,
        )
        for collection, user, printing, oracle, card_set in card_rows
    ]
    items.extend(
        CommunityActivityItem(
            kind="new_member",
            occurred_at=user.created_at,
            display_name=user.display_name,
        )
        for user in member_rows
    )
    items.extend(
        CommunityActivityItem(
            kind="set_updated",
            occurred_at=datetime.combine(row.released_at, time.min, tzinfo=UTC),
            set_name=row.name,
            set_code=row.code,
            game=row.game,
            released_at=row.released_at.isoformat(),
        )
        for row in set_rows
        if row.released_at is not None
    )
    items.extend(
        CommunityActivityItem(
            kind="catalog_updated",
            occurred_at=row.completed_at,
            game=row.game,
            printing_count=row.printing_count,
            set_count=row.set_count,
        )
        for row in catalog_rows
        if row.completed_at is not None
    )
    items.sort(
        key=lambda item: item.occurred_at.replace(tzinfo=UTC)
        if item.occurred_at.tzinfo is None
        else item.occurred_at,
        reverse=True,
    )
    return CommunityActivityOut(items=items[:limit])
