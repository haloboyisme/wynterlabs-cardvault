import math
import re
import uuid
from datetime import UTC, datetime, timedelta
from difflib import SequenceMatcher
from typing import Annotated, Literal

import httpx
from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse
from sqlalchemy import and_, case, cast, func, literal, literal_column, or_, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog.games import current_game_matches, normalize_game
from app.catalog.media import cache_remote_image
from app.catalog.schemas import (
    CardDetailOut,
    CardFaceOut,
    CardPageOut,
    CatalogCounts,
    CatalogStatusOut,
    PrintingListOut,
    ScanCandidateOut,
    SetPageOut,
)
from app.catalog.summary import (
    card_rows as _card_rows,
)
from app.catalog.summary import (
    card_set_out as _set_out,
)
from app.catalog.summary import (
    card_summary as _summary,
)
from app.catalog.summary import (
    first_face_images as _first_face_images,
)
from app.collection_constants import FORMATS
from app.config import Settings
from app.database import get_db
from app.dependencies import CurrentAuth, get_settings, require_ready_auth
from app.errors import AppError
from app.models import CardFace, CardPrinting, CardSet, CatalogImport, OracleCard

router = APIRouter(prefix="/api/v1/catalog", tags=["catalog"])

RARITIES = ("common", "uncommon", "rare", "mythic", "special", "bonus")
COLORS = ("W", "U", "B", "R", "G", "C")
FINISHES = ("nonfoil", "foil", "etched", "glossy")
SCAN_MIN_SIMILARITY = 0.72
SCAN_POSTGRES_MIN_SIMILARITY = 0.65
SortValue = Literal["relevance", "name", "released", "set", "collector", "rarity"]


@router.get("/media", response_class=FileResponse)
async def catalog_media(
    source: Annotated[str, Query(min_length=1, max_length=2048)],
    _auth: CurrentAuth = Depends(require_ready_auth),
    settings: Settings = Depends(get_settings),
) -> FileResponse:
    try:
        cached = await cache_remote_image(
            source,
            settings.catalog_media_cache_dir,
            settings.catalog_media_max_bytes,
            settings.catalog_media_cache_max_bytes,
            settings.catalog_http_timeout_seconds,
        )
    except (httpx.HTTPError, OSError, ValueError) as error:
        raise AppError(502, "catalog_image_unavailable", "Card image is unavailable.") from error
    return FileResponse(
        cached.path,
        media_type=cached.media_type,
        headers={"Cache-Control": "private, max-age=86400"},
    )


@router.get("/status", response_model=CatalogStatusOut)
async def catalog_status(
    _auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> CatalogStatusOut:
    active = await database.scalar(
        select(CatalogImport).where(
            CatalogImport.active.is_(True),
            CatalogImport.status == "complete",
            CatalogImport.game == "mtg",
        )
    )
    if active is None:
        return CatalogStatusOut(
            ready=False,
            stale=False,
            source_updated_at=None,
            completed_at=None,
            counts=CatalogCounts(sets=0, oracle_cards=0, printings=0),
        )
    updated = _aware(active.source_updated_at)
    return CatalogStatusOut(
        ready=True,
        stale=updated < datetime.now(UTC) - timedelta(days=2),
        source_updated_at=active.source_updated_at,
        completed_at=active.completed_at,
        counts=CatalogCounts(
            sets=active.set_count,
            oracle_cards=active.oracle_count,
            printings=active.printing_count,
        ),
    )


@router.get("/cards", response_model=CardPageOut)
async def cards(
    q: Annotated[str | None, Query(min_length=1, max_length=120)] = None,
    set_code: Annotated[str | None, Query(alias="set", min_length=1, max_length=16)] = None,
    collector: Annotated[str | None, Query(min_length=1, max_length=64)] = None,
    rarity: Annotated[str | None, Query()] = None,
    color: Annotated[str | None, Query()] = None,
    card_type: Annotated[str | None, Query(alias="type", min_length=1, max_length=80)] = None,
    legality: Annotated[str | None, Query()] = None,
    finish: Annotated[str | None, Query()] = None,
    game: Annotated[str | None, Query(max_length=32)] = None,
    sort: Annotated[SortValue, Query()] = "relevance",
    page: Annotated[int, Query(ge=1, le=10000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
    _auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> CardPageOut:
    normalized = _normalized(q, "q")
    set_code = _normalized(set_code, "set")
    collector = _normalized(collector, "collector")
    card_type = _normalized(card_type, "type")
    rarity = _allow(rarity, RARITIES, "rarity")
    color = _allow(color.upper() if color else None, COLORS, "color")
    legality = _allow(legality.lower() if legality else None, FORMATS, "legality")
    finish = _allow(finish.lower() if finish else None, FINISHES, "finish")
    normalized_game = normalize_game(game)
    if not current_game_matches(normalized_game):
        return CardPageOut(
            items=[],
            page=page,
            page_size=page_size,
            total=0,
            pages=0,
        )

    statement = _structured_card_filters(_card_rows(), set_code, collector, rarity, card_type)
    if normalized_game:
        statement = statement.where(
            CardPrinting.game == normalized_game,
            OracleCard.game == normalized_game,
            CardSet.game == normalized_game,
        )

    dialect = database.bind.dialect.name
    if dialect == "postgresql":
        statement = _postgres_filters(statement, normalized, color, legality, finish)
        total = await database.scalar(select(func.count()).select_from(statement.subquery())) or 0
        statement = _ordered(statement, sort, normalized, dialect)
        statement = statement.offset((page - 1) * page_size).limit(page_size)
        rows = list((await database.execute(statement)).all())
    else:
        rows = list((await database.execute(statement)).all())
        rows = _sqlite_filters(rows, normalized, color, legality, finish)
        rows = _python_order(rows, sort, normalized)
        total = len(rows)
        rows = rows[(page - 1) * page_size : page * page_size]

    face_images = await _first_face_images(database, [row[0].id for row in rows])
    items = [_summary(*row, face_images=face_images) for row in rows]
    return CardPageOut(
        items=items,
        page=page,
        page_size=page_size,
        total=total,
        pages=math.ceil(total / page_size) if total else 0,
    )


@router.get("/scan-candidates", response_model=list[ScanCandidateOut])
async def scan_candidates(
    name: Annotated[str, Query(min_length=1, max_length=120)],
    set_code: Annotated[str | None, Query(alias="set", min_length=1, max_length=16)] = None,
    collector: Annotated[str | None, Query(min_length=1, max_length=64)] = None,
    preferred_set: Annotated[str | None, Query(min_length=1, max_length=16)] = None,
    preferred_game: Annotated[str | None, Query(max_length=32)] = None,
    game: Annotated[str | None, Query(max_length=32)] = None,
    limit: Annotated[int, Query(ge=1, le=20)] = 10,
    _auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> list[ScanCandidateOut]:
    name = _normalized(name, "name")
    assert name is not None
    set_code = _normalized(set_code, "set")
    collector = _normalized_collector(_normalized(collector, "collector"))
    preferred_set = _normalized(preferred_set, "preferred_set")
    preferred_game = normalize_game(preferred_game)
    normalized_game = normalize_game(game)
    if not current_game_matches(normalized_game) or not current_game_matches(preferred_game):
        return []
    statement = _structured_card_filters(_card_rows(), None, None, None, None)
    if normalized_game:
        statement = statement.where(
            CardPrinting.game == normalized_game,
            OracleCard.game == normalized_game,
            CardSet.game == normalized_game,
        )
    if database.bind.dialect.name == "postgresql":
        statement = statement.where(
            or_(
                OracleCard.name_normalized == name,
                OracleCard.name_normalized.startswith(name),
                func.similarity(OracleCard.name_normalized, name) >= SCAN_POSTGRES_MIN_SIMILARITY,
            )
        )
        exact_printing = (
            and_(
                OracleCard.name_normalized == name,
                CardSet.code_normalized == set_code,
                _postgres_collector_normalized(CardPrinting.collector_number) == collector,
            )
            if set_code and collector
            else literal_column("false")
        )
        statement = statement.order_by(
            case(
                (exact_printing, 0),
                (OracleCard.name_normalized == name, 1),
                (OracleCard.name_normalized.startswith(name), 2),
                else_=3,
            ),
            _preferred_set_order(preferred_set, preferred_game),
            func.similarity(OracleCard.name_normalized, name).desc(),
            CardSet.code_normalized,
            CardPrinting.collector_number,
            CardPrinting.id,
        ).limit(limit)
        rows = list((await database.execute(statement)).all())
    else:
        rows = [
            row
            for row in (await database.execute(statement)).all()
            if _scan_name_matches(name, row[1].name_normalized)
        ]
        rows = sorted(
            rows,
            key=lambda row: _scan_rank(
                row, name, set_code, collector, preferred_set, preferred_game
            ),
        )[:limit]
    face_images = await _first_face_images(database, [row[0].id for row in rows])
    return [
        ScanCandidateOut(
            **_summary(*row, face_images=face_images).model_dump(),
            rank_reason=_scan_reason(row, name, set_code, collector),
        )
        for row in rows
    ]


@router.get("/cards/{printing_id}", response_model=CardDetailOut)
async def card_detail(
    printing_id: uuid.UUID,
    _auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> CardDetailOut:
    row = (
        await database.execute(
            _card_rows().where(
                CardPrinting.id == printing_id,
                CardPrinting.active.is_(True),
                OracleCard.active.is_(True),
                CardSet.active.is_(True),
            )
        )
    ).one_or_none()
    if row is None:
        raise AppError(404, "card_not_found", "Card printing was not found.")
    faces = list(
        (
            await database.scalars(
                select(CardFace)
                .where(CardFace.printing_id == printing_id)
                .order_by(CardFace.face_index)
            )
        ).all()
    )
    printing, oracle, card_set = row
    images = printing.image_uris or (faces[0].image_uris if faces else {})
    summary = _summary(printing, oracle, card_set, face_images={printing.id: images})
    return CardDetailOut(
        **summary.model_dump(),
        oracle_text=oracle.oracle_text,
        cmc=oracle.cmc,
        color_identity=printing.color_identity or oracle.color_identity,
        keywords=oracle.keywords,
        legalities=printing.legalities or oracle.legalities,
        artist=printing.artist,
        digital=printing.digital,
        promo=printing.promo,
        frame=printing.frame,
        border_color=printing.border_color,
        image_status=printing.image_status,
        source_uri=printing.source_uri,
        price_snapshot_at=printing.price_snapshot_at,
        games=printing.games,
        faces=[
            CardFaceOut(
                face_index=face.face_index,
                name=face.name,
                mana_cost=face.mana_cost,
                type_line=face.type_line,
                oracle_text=face.oracle_text,
                colors=face.colors,
                image_uris=face.image_uris,
                artist=face.artist,
            )
            for face in faces
        ],
    )


@router.get("/oracle/{oracle_id}/printings", response_model=PrintingListOut)
async def oracle_printings(
    oracle_id: uuid.UUID,
    page: Annotated[int, Query(ge=1, le=10000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
    game: Annotated[str | None, Query(max_length=32)] = None,
    _auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> PrintingListOut:
    normalized_game = normalize_game(game)
    if not current_game_matches(normalized_game):
        return PrintingListOut(items=[], page=page, page_size=page_size, total=0, pages=0)
    exists = await database.scalar(
        select(OracleCard.id).where(
            OracleCard.id == oracle_id,
            OracleCard.active.is_(True),
        )
    )
    if exists is None:
        raise AppError(404, "oracle_card_not_found", "Oracle card was not found.")
    filters = [
        OracleCard.id == oracle_id,
        OracleCard.active.is_(True),
        CardPrinting.active.is_(True),
        CardSet.active.is_(True),
    ]
    if normalized_game:
        filters.extend(
            [
                CardPrinting.game == normalized_game,
                OracleCard.game == normalized_game,
                CardSet.game == normalized_game,
            ]
        )
    total = (
        await database.scalar(
            select(func.count())
            .select_from(CardPrinting)
            .join(OracleCard, OracleCard.id == CardPrinting.oracle_card_id)
            .join(CardSet, CardSet.id == CardPrinting.card_set_id)
            .where(*filters)
        )
        or 0
    )
    rows = list(
        (
            await database.execute(
                _card_rows()
                .where(*filters)
                .order_by(
                    CardPrinting.released_at.desc().nulls_last(),
                    CardSet.code_normalized,
                    CardPrinting.collector_number,
                    CardPrinting.id,
                )
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
    )
    face_images = await _first_face_images(database, [row[0].id for row in rows])
    return PrintingListOut(
        items=[_summary(*row, face_images=face_images) for row in rows],
        page=page,
        page_size=page_size,
        total=total,
        pages=math.ceil(total / page_size) if total else 0,
    )


@router.get("/sets", response_model=SetPageOut)
async def sets(
    page: Annotated[int, Query(ge=1, le=10000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 200,
    game: Annotated[str | None, Query(max_length=32)] = None,
    _auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> SetPageOut:
    normalized_game = normalize_game(game)
    if not current_game_matches(normalized_game):
        return SetPageOut(items=[], page=page, page_size=page_size, total=0, pages=0)
    filters = [CardSet.active.is_(True)]
    if normalized_game:
        filters.append(CardSet.game == normalized_game)
    total = await database.scalar(select(func.count()).select_from(CardSet).where(*filters)) or 0
    items = list(
        (
            await database.scalars(
                select(CardSet)
                .where(*filters)
                .order_by(CardSet.name, CardSet.code_normalized, CardSet.id)
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
    )
    return SetPageOut(
        items=[_set_out(item) for item in items],
        page=page,
        page_size=page_size,
        total=total,
        pages=math.ceil(total / page_size) if total else 0,
    )


def _structured_card_filters(statement, set_code, collector, rarity, card_type):
    statement = statement.where(
        CardPrinting.active.is_(True),
        OracleCard.active.is_(True),
        CardSet.active.is_(True),
    )
    if set_code:
        statement = statement.where(CardSet.code_normalized == set_code)
    if collector:
        statement = statement.where(func.lower(CardPrinting.collector_number) == collector)
    if rarity:
        statement = statement.where(CardPrinting.rarity == rarity)
    if card_type:
        statement = statement.where(func.lower(OracleCard.type_line).like(f"%{card_type}%"))
    return statement


def _postgres_filters(statement, q, color, legality, finish):
    if q:
        english = literal_column("'english'::regconfig")
        search_text = (
            func.coalesce(OracleCard.name, "")
            + " "
            + func.coalesce(OracleCard.type_line, "")
            + " "
            + func.coalesce(OracleCard.oracle_text, "")
        )
        statement = statement.where(
            or_(
                OracleCard.name_normalized == q,
                OracleCard.name_normalized.startswith(q),
                OracleCard.name_normalized.op("%")(q),
                func.to_tsvector(english, search_text).op("@@")(func.plainto_tsquery(english, q)),
            )
        )
    if color == "C":
        statement = statement.where(CardPrinting.colors == cast([], JSONB))
    elif color:
        statement = statement.where(CardPrinting.colors.op("@>")(cast([color], JSONB)))
    if legality:
        statement = statement.where(OracleCard.legalities.op("@>")({legality: "legal"}))
    if finish:
        statement = statement.where(CardPrinting.finishes.op("@>")(cast([finish], JSONB)))
    return statement


def _sqlite_filters(rows, q, color, legality, finish):
    filtered = []
    for printing, oracle, card_set in rows:
        if color == "C" and printing.colors:
            continue
        if color and color != "C" and color not in printing.colors:
            continue
        if legality and printing.legalities.get(legality) != "legal":
            continue
        if finish and finish not in printing.finishes:
            continue
        if q:
            document = " ".join(
                value for value in (oracle.name, oracle.type_line, oracle.oracle_text) if value
            ).lower()
            similarity = SequenceMatcher(None, q, oracle.name_normalized).ratio()
            if q not in document and similarity < 0.72:
                continue
        filtered.append((printing, oracle, card_set))
    return filtered


def _ordered(statement, sort, q, dialect):
    if sort == "name":
        return statement.order_by(
            OracleCard.name_normalized,
            CardSet.code_normalized,
            CardPrinting.collector_number,
            CardPrinting.id,
        )
    if sort == "released":
        return statement.order_by(
            CardPrinting.released_at.desc().nulls_last(),
            OracleCard.name_normalized,
            CardPrinting.id,
        )
    if sort == "set":
        return statement.order_by(
            CardSet.code_normalized,
            CardPrinting.collector_number,
            OracleCard.name_normalized,
            CardPrinting.id,
        )
    if sort == "collector":
        return statement.order_by(
            CardSet.code_normalized,
            CardPrinting.collector_number,
            CardPrinting.id,
        )
    if sort == "rarity":
        return statement.order_by(
            CardPrinting.rarity,
            OracleCard.name_normalized,
            CardPrinting.id,
        )
    if q and dialect == "postgresql":
        rank = case(
            (OracleCard.name_normalized == q, 0),
            (OracleCard.name_normalized.startswith(q), 1),
            else_=2,
        )
        return statement.order_by(
            rank,
            func.similarity(OracleCard.name_normalized, q).desc(),
            OracleCard.name_normalized,
            CardPrinting.released_at.desc().nulls_last(),
            CardPrinting.id,
        )
    return statement.order_by(
        OracleCard.name_normalized,
        CardPrinting.released_at.desc().nulls_last(),
        CardPrinting.id,
    )


def _python_order(rows, sort, q):
    def key(row):
        printing, oracle, card_set = row
        if sort == "released":
            return (
                printing.released_at is None,
                _reverse_date(printing.released_at),
                oracle.name_normalized,
                str(printing.id),
            )
        if sort == "set":
            return (
                card_set.code_normalized,
                printing.collector_number,
                oracle.name_normalized,
                str(printing.id),
            )
        if sort == "collector":
            return (card_set.code_normalized, printing.collector_number, str(printing.id))
        if sort == "rarity":
            return (printing.rarity, oracle.name_normalized, str(printing.id))
        if sort == "name" or not q:
            return (
                oracle.name_normalized,
                card_set.code_normalized,
                printing.collector_number,
                str(printing.id),
            )
        rank = (
            0 if oracle.name_normalized == q else 1 if oracle.name_normalized.startswith(q) else 2
        )
        similarity = SequenceMatcher(None, q, oracle.name_normalized).ratio()
        return (
            rank,
            -similarity,
            oracle.name_normalized,
            _reverse_date(printing.released_at),
            str(printing.id),
        )

    return sorted(rows, key=key)


def _reverse_date(value):
    return -(value.toordinal()) if value else 0


def _scan_reason(row, name, set_code, collector):
    printing, oracle, card_set = row
    if (
        set_code
        and collector
        and oracle.name_normalized == name
        and card_set.code_normalized == set_code
        and _normalized_collector(printing.collector_number) == collector
    ):
        return "exact_printing"
    if oracle.name_normalized == name:
        return "exact_name"
    if oracle.name_normalized.startswith(name):
        return "name_prefix"
    return "fuzzy_name"


def _preferred_set_order(preferred_set, preferred_game=None):
    if preferred_set:
        preferred = CardSet.code_normalized == preferred_set
        if preferred_game:
            preferred = and_(preferred, CardSet.game == preferred_game)
        return case((preferred, 0), else_=1)
    return literal(0)


def _scan_name_matches(query, candidate):
    return (
        candidate == query
        or candidate.startswith(query)
        or SequenceMatcher(None, query, candidate).ratio() >= SCAN_MIN_SIMILARITY
    )


def _normalized_collector(value: str | None) -> str | None:
    if value is None:
        return None
    collector = value.strip().lower().split("/", 1)[0].strip()
    return re.sub(r"^0+(?=\d)", "", collector)


def _postgres_collector_normalized(column):
    collector = func.btrim(func.split_part(func.lower(column), "/", 1))
    trimmed = func.ltrim(collector, "0")
    normalized_zero_prefixed = case(
        (trimmed.op("~")(r"^[0-9]"), trimmed),
        else_=func.concat("0", trimmed),
    )
    return case((collector.startswith("0"), normalized_zero_prefixed), else_=collector)


def _scan_rank(row, name, set_code, collector, preferred_set=None, preferred_game=None):
    printing, oracle, card_set = row
    reason = _scan_reason(row, name, set_code, collector)
    reason_rank = {"exact_printing": 0, "exact_name": 1, "name_prefix": 2, "fuzzy_name": 3}
    return (
        reason_rank[reason],
        0
        if preferred_set
        and card_set.code_normalized == preferred_set
        and (not preferred_game or card_set.game == preferred_game)
        else 1,
        -SequenceMatcher(None, name, oracle.name_normalized).ratio(),
        card_set.code_normalized,
        printing.collector_number,
        str(printing.id),
    )


def _allow(value, allowed, field):
    if value is not None and value not in allowed:
        raise AppError(422, "validation_error", f"Invalid {field} filter.")
    return value


def _normalized(value, field):
    if value is None:
        return None
    normalized = value.strip().lower()
    if not normalized:
        raise AppError(422, "validation_error", f"{field} cannot be blank.")
    return normalized


def _aware(value):
    return value if value.tzinfo else value.replace(tzinfo=UTC)
