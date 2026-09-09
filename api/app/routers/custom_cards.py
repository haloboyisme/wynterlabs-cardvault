import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog.schemas import CardSummaryOut
from app.catalog.summary import card_rows, card_summary
from app.custom_cards import CustomCardFile, CustomCardInput
from app.database import get_db
from app.dependencies import CurrentAuth, require_ready_auth
from app.models import CardPrinting, CardSet, CatalogImport, CollectionItem, OracleCard

router = APIRouter(prefix="/api/v1/custom-cards", tags=["custom cards"])


async def create_card(database, user_id, payload):
    now = datetime.now(UTC)
    source = CatalogImport(
        id=uuid.uuid4(),
        game=payload.game if payload.game != "custom" else "mtg",
        source_bulk_id=uuid.uuid4(),
        source_updated_at=now,
        source_uri="custom:user-created",
        status="complete",
        active=False,
        completed_at=now,
    )
    database.add(source)
    await database.flush()
    common = dict(
        game=payload.game,
        custom_owner_id=user_id,
        active=True,
        first_seen_import_id=source.id,
        last_seen_import_id=source.id,
    )
    code = uuid.uuid4().hex[:16]
    card_set = CardSet(
        id=uuid.uuid4(),
        scryfall_id=uuid.uuid4(),
        code=code,
        code_normalized=code,
        name=payload.set_name or "Custom cards",
        set_type="custom",
        card_count=1,
        **common,
    )
    oracle = OracleCard(
        id=uuid.uuid4(),
        scryfall_id=uuid.uuid4(),
        name=payload.name,
        name_normalized=payload.name.casefold(),
        layout="normal",
        type_line="Custom card — user supplied",
        **common,
    )
    database.add_all([card_set, oracle])
    await database.flush()
    printing = CardPrinting(
        id=uuid.uuid4(),
        scryfall_id=uuid.uuid4(),
        oracle_card_id=oracle.id,
        card_set_id=card_set.id,
        language="en",
        collector_number=payload.collector_number,
        rarity="custom",
        layout="normal",
        finishes=["nonfoil"],
        games=[payload.game],
        image_uris={"custom": payload.image_url} if payload.image_url else {},
        **common,
    )
    database.add(printing)
    await database.flush()
    database.add(
        CollectionItem(
            user_id=user_id,
            printing_id=printing.id,
            finish="nonfoil",
            condition=payload.condition,
            quantity=payload.quantity,
            manual_price_usd=payload.value_usd,
        )
    )
    return card_summary(printing, oracle, card_set, {})


@router.post("", response_model=CardSummaryOut, status_code=201)
async def add_card(
    payload: CustomCardInput,
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
):
    card = await create_card(database, auth.user.id, payload)
    await database.commit()
    return card


@router.post("/import", status_code=201)
async def import_cards(
    payload: CustomCardFile,
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
):
    for card in payload.cards:
        await create_card(database, auth.user.id, card)
    await database.commit()
    return {"imported": len(payload.cards)}


@router.get("/export")
async def export_cards(
    auth: CurrentAuth = Depends(require_ready_auth), database: AsyncSession = Depends(get_db)
):
    rows = (
        await database.execute(
            card_rows()
            .add_columns(CollectionItem)
            .join(CollectionItem, CollectionItem.printing_id == CardPrinting.id)
            .where(
                CardPrinting.custom_owner_id == auth.user.id, CollectionItem.user_id == auth.user.id
            )
            .order_by(OracleCard.name, CollectionItem.id)
        )
    ).all()
    cards = []
    for printing, oracle, card_set, item in rows:
        cards.append(
            CustomCardInput(
                name=oracle.name,
                game=printing.game,
                set_name=card_set.name,
                collector_number=printing.collector_number,
                image_url=printing.image_uris.get("custom"),
                condition=item.condition,
                quantity=item.quantity,
                value_usd=item.manual_price_usd,
            )
        )
    return {"schema_version": 1, "cards": cards}
