import asyncio
import uuid
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base
from app.models import CardFace, CardPrinting, CardSet, CatalogImport, OracleCard


def test_catalog_models_preserve_source_data_across_round_trip(tmp_path) -> None:
    asyncio.run(_round_trip_catalog_data(tmp_path))


async def _round_trip_catalog_data(tmp_path) -> None:
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'catalog.db'}"
    engine = create_async_engine(database_url)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    import_id = uuid.uuid4()
    set_id = uuid.uuid4()
    oracle_id = uuid.uuid4()
    printing_id = uuid.uuid4()
    face_one_id = uuid.uuid4()
    face_two_id = uuid.uuid4()

    catalog_import = CatalogImport(
        id=import_id,
        source_bulk_id=uuid.uuid4(),
        source_updated_at=datetime(2026, 8, 12, 21, 5, tzinfo=UTC),
        source_uri="https://data.scryfall.io/default-cards/cards.jsonl.gz",
        checksum="sha256:catalog-snapshot",
        status="complete",
        active=True,
        completed_at=datetime(2026, 8, 12, 21, 10, tzinfo=UTC),
        total_records=2,
        imported_records=2,
        rejected_records=0,
        set_count=1,
        oracle_count=1,
        printing_count=1,
    )
    card_set = CardSet(
        id=set_id,
        scryfall_id=uuid.uuid4(),
        code="TST",
        code_normalized="tst",
        name="Wynter Test Set",
        set_type="expansion",
        released_at=date(2026, 8, 12),
        card_count=271,
        digital=False,
        icon_svg_uri="https://svgs.scryfall.io/sets/tst.svg",
        source_uri="https://api.scryfall.com/sets/tst",
        source_updated_at=datetime(2026, 8, 12, 21, 5, tzinfo=UTC),
        first_seen_import_id=import_id,
        last_seen_import_id=import_id,
        active=True,
    )
    oracle_card = OracleCard(
        id=oracle_id,
        scryfall_id=uuid.uuid4(),
        name="Wynter // Aurora",
        name_normalized="wynter // aurora",
        layout="transform",
        mana_cost=None,
        cmc=4.0,
        type_line="Creature — Shapeshifter",
        oracle_text=None,
        colors=["U", "B"],
        color_identity=["U", "B"],
        keywords=["Transform"],
        legalities={"commander": "legal"},
        first_seen_import_id=import_id,
        last_seen_import_id=import_id,
        active=True,
    )
    printing = CardPrinting(
        id=printing_id,
        scryfall_id=uuid.uuid4(),
        oracle_card_id=oracle_id,
        card_set_id=set_id,
        language="en",
        collector_number="123",
        rarity="mythic",
        released_at=date(2026, 8, 12),
        artist="Example Artist",
        illustration_id=uuid.uuid4(),
        digital=False,
        promo=True,
        layout="transform",
        frame="2015",
        border_color="black",
        image_status="highres_scan",
        source_uri="https://api.scryfall.com/cards/example",
        source_updated_at=datetime(2026, 8, 12, 21, 5, tzinfo=UTC),
        price_snapshot_at=datetime(2026, 8, 12, 21, 6, tzinfo=UTC),
        image_uris={"normal": "https://cards.scryfall.io/printing.jpg"},
        prices={"usd": "12.34", "usd_foil": "18.00"},
        finishes=["nonfoil", "foil"],
        games=["paper", "arena"],
        colors=["U", "B"],
        color_identity=["U", "B"],
        legalities={"standard": "legal", "commander": "legal"},
        first_seen_import_id=import_id,
        last_seen_import_id=import_id,
        active=True,
    )
    faces = [
        CardFace(
            id=face_one_id,
            printing_id=printing_id,
            face_index=0,
            name="Wynter",
            mana_cost="{2}{U}",
            type_line="Creature — Shapeshifter",
            oracle_text="At the beginning of your end step, transform Wynter.",
            colors=["U"],
            image_uris={"normal": "https://cards.scryfall.io/wynter.jpg"},
            artist="Example Artist",
            illustration_id=uuid.uuid4(),
        ),
        CardFace(
            id=face_two_id,
            printing_id=printing_id,
            face_index=1,
            name="Aurora",
            mana_cost="",
            type_line="Creature — Spirit",
            oracle_text="Flying",
            colors=["B"],
            image_uris={"normal": "https://cards.scryfall.io/aurora.jpg"},
            artist="Example Artist",
            illustration_id=uuid.uuid4(),
        ),
    ]

    async with session_factory() as session:
        session.add_all([catalog_import, card_set, oracle_card, printing, *faces])
        await session.commit()

    async with session_factory() as session:
        saved_import = await session.get(CatalogImport, import_id)
        saved_set = await session.get(CardSet, set_id)
        saved_oracle = await session.get(OracleCard, oracle_id)
        saved_printing = await session.get(CardPrinting, printing_id)
        saved_faces = list(
            (
                await session.scalars(
                    select(CardFace)
                    .where(CardFace.printing_id == printing_id)
                    .order_by(CardFace.face_index)
                )
            ).all()
        )

    assert saved_import is not None
    assert saved_import.source_bulk_id == catalog_import.source_bulk_id
    assert saved_import.source_updated_at is not None
    assert saved_import.checksum == "sha256:catalog-snapshot"
    assert saved_import.status == "complete"
    assert saved_import.active is True
    assert saved_import.total_records == 2
    assert saved_import.imported_records == 2
    assert saved_import.rejected_records == 0
    assert saved_import.set_count == 1
    assert saved_import.oracle_count == 1
    assert saved_import.printing_count == 1
    assert saved_set is not None
    assert saved_set.scryfall_id == card_set.scryfall_id
    assert saved_set.source_uri == "https://api.scryfall.com/sets/tst"
    assert saved_set.source_updated_at is not None
    assert saved_set.code_normalized == "tst"
    assert saved_set.first_seen_import_id == import_id
    assert saved_set.last_seen_import_id == import_id
    assert saved_oracle is not None
    assert saved_oracle.scryfall_id == oracle_card.scryfall_id
    assert saved_oracle.layout == "transform"
    assert saved_oracle.first_seen_import_id == import_id
    assert saved_oracle.last_seen_import_id == import_id
    assert saved_oracle.colors == ["U", "B"]
    assert saved_oracle.keywords == ["Transform"]
    assert saved_oracle.legalities == {"commander": "legal"}
    assert saved_printing is not None
    assert saved_printing.scryfall_id == printing.scryfall_id
    assert saved_printing.first_seen_import_id == import_id
    assert saved_printing.last_seen_import_id == import_id
    assert saved_printing.language == "en"
    assert saved_printing.artist == "Example Artist"
    assert saved_printing.illustration_id == printing.illustration_id
    assert saved_printing.digital is False
    assert saved_printing.promo is True
    assert saved_printing.frame == "2015"
    assert saved_printing.border_color == "black"
    assert saved_printing.image_status == "highres_scan"
    assert saved_printing.source_uri == "https://api.scryfall.com/cards/example"
    assert saved_printing.source_updated_at is not None
    assert saved_printing.price_snapshot_at is not None
    assert saved_printing.image_uris["normal"].endswith("printing.jpg")
    assert saved_printing.prices == {"usd": "12.34", "usd_foil": "18.00"}
    assert saved_printing.finishes == ["nonfoil", "foil"]
    assert saved_printing.games == ["paper", "arena"]
    assert saved_printing.colors == ["U", "B"]
    assert saved_printing.color_identity == ["U", "B"]
    assert saved_printing.legalities["commander"] == "legal"
    assert [face.face_index for face in saved_faces] == [0, 1]
    assert [face.name for face in saved_faces] == ["Wynter", "Aurora"]
    assert all(face.illustration_id is not None for face in saved_faces)
    assert saved_faces[0].image_uris["normal"].endswith("wynter.jpg")

    await engine.dispose()


def test_catalog_imports_allow_repeated_source_bulk_snapshots(tmp_path) -> None:
    asyncio.run(_round_trip_repeated_source_snapshots(tmp_path))


async def _round_trip_repeated_source_snapshots(tmp_path) -> None:
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'snapshots.db'}"
    engine = create_async_engine(database_url)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    source_bulk_id = uuid.uuid4()
    snapshot_time = datetime(2026, 8, 12, 21, 5, tzinfo=UTC)
    shared_fields = {
        "source_bulk_id": source_bulk_id,
        "source_updated_at": snapshot_time,
        "source_uri": "https://data.scryfall.io/default-cards/cards.jsonl.gz",
        "status": "failed",
        "active": False,
        "total_records": 0,
        "imported_records": 0,
        "rejected_records": 0,
        "set_count": 0,
        "oracle_count": 0,
        "printing_count": 0,
    }

    async with session_factory() as session:
        session.add_all(
            [
                CatalogImport(id=uuid.uuid4(), **shared_fields),
                CatalogImport(id=uuid.uuid4(), **shared_fields),
            ]
        )
        await session.commit()

    async with session_factory() as session:
        saved_snapshots = list(
            (
                await session.scalars(
                    select(CatalogImport).where(CatalogImport.source_bulk_id == source_bulk_id)
                )
            ).all()
        )

    assert len(saved_snapshots) == 2
    await engine.dispose()


def test_catalog_import_constraints_reject_invalid_states(tmp_path) -> None:
    asyncio.run(_catalog_import_constraints_reject_invalid_states(tmp_path))


async def _catalog_import_constraints_reject_invalid_states(tmp_path) -> None:
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'constraints.db'}"
    engine = create_async_engine(database_url)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    completed_at = datetime(2026, 8, 12, 21, 10, tzinfo=UTC)

    first_active = _catalog_import(status="complete", active=True, completed_at=completed_at)
    async with session_factory() as session:
        session.add(first_active)
        await session.commit()

    invalid_imports = [
        _catalog_import(status="complete", active=True, completed_at=completed_at),
        _catalog_import(status="failed", active=True, completed_at=completed_at),
        _catalog_import(status="complete", active=True, completed_at=None),
        _catalog_import(status="unknown", active=False, completed_at=None),
        _catalog_import(status="failed", active=False, completed_at=None, rejected_records=-1),
    ]
    for invalid_import in invalid_imports:
        async with session_factory() as session:
            session.add(invalid_import)
            with pytest.raises(IntegrityError):
                await session.commit()

    await engine.dispose()


def test_catalog_metadata_uses_postgres_jsonb_and_required_indexes() -> None:
    filter_columns = [
        OracleCard.__table__.c.legalities,
        CardPrinting.__table__.c.finishes,
        CardPrinting.__table__.c.games,
        CardPrinting.__table__.c.colors,
        CardPrinting.__table__.c.color_identity,
    ]
    assert all(
        isinstance(
            column.type.dialect_impl(__import__("sqlalchemy").dialects.postgresql.dialect()), JSONB
        )
        for column in filter_columns
    )

    oracle_indexes = {index.name for index in OracleCard.__table__.indexes}
    printing_indexes = {index.name for index in CardPrinting.__table__.indexes}
    assert "ix_oracle_cards_legalities_gin" in oracle_indexes
    assert {
        "ix_card_printings_finishes_gin",
        "ix_card_printings_games_gin",
        "ix_card_printings_colors_gin",
        "ix_card_printings_color_identity_gin",
    } <= printing_indexes
    assert "ix_card_faces_printing_order" not in {
        index.name for index in CardFace.__table__.indexes
    }


def _catalog_import(**overrides) -> CatalogImport:
    fields = {
        "id": uuid.uuid4(),
        "source_bulk_id": uuid.uuid4(),
        "source_updated_at": datetime(2026, 8, 12, 21, 5, tzinfo=UTC),
        "source_uri": "https://data.scryfall.io/default-cards/cards.jsonl.gz",
        "status": "pending",
        "active": False,
        "completed_at": None,
        "total_records": 0,
        "imported_records": 0,
        "rejected_records": 0,
        "set_count": 0,
        "oracle_count": 0,
        "printing_count": 0,
    }
    fields.update(overrides)
    return CatalogImport(**fields)
