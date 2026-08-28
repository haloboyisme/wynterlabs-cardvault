from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog.schemas import CardSetOut, CardSummaryOut
from app.models import CardFace, CardPrinting, CardSet, OracleCard


def card_rows():
    return (
        select(CardPrinting, OracleCard, CardSet)
        .join(OracleCard, OracleCard.id == CardPrinting.oracle_card_id)
        .join(CardSet, CardSet.id == CardPrinting.card_set_id)
    )


async def first_face_images(database: AsyncSession, printing_ids: list) -> dict:
    if not printing_ids:
        return {}
    faces = (
        await database.execute(
            select(CardFace.printing_id, CardFace.image_uris).where(
                CardFace.printing_id.in_(printing_ids), CardFace.face_index == 0
            )
        )
    ).all()
    return {printing_id: images for printing_id, images in faces if images}


def card_summary(printing, oracle, card_set, face_images: dict) -> CardSummaryOut:
    return CardSummaryOut(
        printing_id=printing.id,
        oracle_id=oracle.id,
        name=oracle.name,
        mana_cost=oracle.mana_cost,
        type_line=oracle.type_line,
        set=card_set_out(card_set),
        collector_number=printing.collector_number,
        rarity=printing.rarity,
        released_at=printing.released_at,
        language=printing.language,
        layout=printing.layout,
        image_uris=printing.image_uris or face_images.get(printing.id, {}),
        prices=printing.prices,
        finishes=printing.finishes,
        active=printing.active,
        colors=printing.colors or oracle.colors,
    )


def card_set_out(card_set) -> CardSetOut:
    return CardSetOut(
        game=card_set.game,
        id=card_set.id,
        code=card_set.code,
        name=card_set.name,
        set_type=card_set.set_type,
        released_at=card_set.released_at,
        card_count=card_set.card_count,
        digital=card_set.digital,
        icon_svg_uri=card_set.icon_svg_uri,
    )
