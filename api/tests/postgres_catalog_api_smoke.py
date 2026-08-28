#!/usr/bin/env python3
import asyncio
import os
import uuid
from datetime import UTC, date, datetime
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.catalog.importer import normalize_card
from app.config import Settings
from app.main import create_app
from app.models import CardFace, CardPrinting, CardSet, CatalogImport, OracleCard
from app.routers.catalog import _card_rows, _postgres_filters, _structured_card_filters

IMPORT_ID = uuid.UUID("80000000-0000-4000-8000-000000000001")
SET_ID = uuid.UUID("80000000-0000-4000-8000-000000000002")
ORACLE_BOLT = uuid.UUID("80000000-0000-4000-8000-000000000003")
ORACLE_DFC = uuid.UUID("80000000-0000-4000-8000-000000000004")
ALPHANUMERIC_BOLT_PRINTING = uuid.UUID("80000000-0000-4000-8000-000000000005")


def printing(row_id, oracle_id, collector, colors, finishes, legalities, name):
    return CardPrinting(
        id=row_id,
        scryfall_id=row_id,
        oracle_card_id=oracle_id,
        card_set_id=SET_ID,
        language="en",
        collector_number=collector,
        rarity="common",
        released_at=date(2026, 8, 1),
        artist="Smoke Artist",
        digital=False,
        promo=False,
        layout="transform" if oracle_id == ORACLE_DFC else "normal",
        image_uris={"normal": f"https://cards.test/{name}.jpg"},
        prices={},
        finishes=finishes,
        games=["paper"],
        colors=colors,
        color_identity=colors,
        legalities=legalities,
        first_seen_import_id=IMPORT_ID,
        last_seen_import_id=IMPORT_ID,
        active=True,
    )


async def seed(factory):
    now = datetime.now(UTC)
    dfc = normalize_card(
        {
            "id": str(uuid.UUID("80000000-0000-4000-8000-000000000006")),
            "oracle_id": str(ORACLE_DFC),
            "name": "Scholar // Skywing",
            "lang": "en",
            "layout": "transform",
            "cmc": 2,
            "color_identity": ["U"],
            "keywords": ["Flying"],
            "legalities": {"modern": "legal"},
            "set_id": str(SET_ID),
            "set": "smk",
            "set_name": "Smoke Set",
            "set_type": "expansion",
            "released_at": "2026-08-01",
            "collector_number": "2",
            "rarity": "common",
            "finishes": ["foil"],
            "games": ["paper"],
            "card_faces": [
                {
                    "name": "Scholar",
                    "type_line": "Creature - Human Wizard",
                    "oracle_text": "Draw a card.",
                    "colors": ["U"],
                },
                {
                    "name": "Skywing",
                    "type_line": "Creature - Bird",
                    "oracle_text": "Flying",
                    "colors": ["U"],
                },
            ],
        }
    )
    async with factory() as db:
        db.add(
            CatalogImport(
                id=IMPORT_ID,
                source_bulk_id=uuid.uuid4(),
                source_updated_at=now,
                source_uri="https://data.scryfall.io/smoke.jsonl.gz",
                status="complete",
                active=True,
                completed_at=now,
                total_records=209,
                imported_records=209,
                rejected_records=0,
                set_count=1,
                oracle_count=2,
                printing_count=209,
            )
        )
        await db.flush()
        db.add(
            CardSet(
                id=SET_ID,
                scryfall_id=uuid.uuid4(),
                code="SMK",
                code_normalized="smk",
                name="Smoke Set",
                set_type="expansion",
                released_at=date(2026, 8, 1),
                card_count=209,
                first_seen_import_id=IMPORT_ID,
                last_seen_import_id=IMPORT_ID,
                active=True,
            )
        )
        db.add_all(
            [
                OracleCard(
                    id=ORACLE_BOLT,
                    scryfall_id=ORACLE_BOLT,
                    name="Lightning Bolt",
                    name_normalized="lightning bolt",
                    layout="normal",
                    mana_cost="{R}",
                    cmc=1,
                    type_line="Instant",
                    oracle_text="Lightning Bolt deals 3 damage to any target.",
                    colors=["R"],
                    color_identity=["R"],
                    keywords=[],
                    legalities={"modern": "legal"},
                    first_seen_import_id=IMPORT_ID,
                    last_seen_import_id=IMPORT_ID,
                    active=True,
                ),
                OracleCard(
                    id=ORACLE_DFC,
                    scryfall_id=ORACLE_DFC,
                    name=dfc.oracle.name,
                    name_normalized=dfc.oracle.name.casefold(),
                    layout=dfc.oracle.layout,
                    mana_cost=dfc.oracle.mana_cost,
                    cmc=dfc.oracle.cmc,
                    type_line=dfc.oracle.type_line,
                    oracle_text=dfc.oracle.oracle_text,
                    colors=dfc.oracle.colors,
                    color_identity=dfc.oracle.color_identity,
                    keywords=dfc.oracle.keywords,
                    legalities=dfc.oracle.legalities,
                    first_seen_import_id=IMPORT_ID,
                    last_seen_import_id=IMPORT_ID,
                    active=True,
                ),
            ]
        )
        await db.flush()
        rows = [
            printing(
                ALPHANUMERIC_BOLT_PRINTING,
                ORACLE_BOLT,
                "001a",
                ["R"],
                ["nonfoil"],
                {"modern": "legal"},
                "bolt",
            ),
            printing(
                uuid.UUID(int=9001), ORACLE_DFC, "2", ["U"], ["foil"], {"modern": "legal"}, "dfc"
            ),
            printing(
                uuid.UUID(int=9002),
                ORACLE_BOLT,
                "001b",
                ["R"],
                ["nonfoil"],
                {"modern": "legal"},
                "bolt-nearby",
            ),
            printing(
                uuid.UUID(int=9003),
                ORACLE_BOLT,
                "000z",
                ["R"],
                ["nonfoil"],
                {"modern": "legal"},
                "bolt-leading-decoy",
            ),
        ]
        rows.extend(
            printing(
                uuid.UUID(int=10000 + index),
                ORACLE_BOLT,
                f"{index + 3:03d}",
                ["R"],
                ["nonfoil"],
                {"modern": "legal"},
                f"bolt-{index}",
            )
            for index in range(205)
        )
        db.add_all(rows)
        await db.flush()
        db.add_all(
            [
                CardFace(
                    printing_id=uuid.UUID(int=9001),
                    face_index=index,
                    name=face.name,
                    mana_cost=face.mana_cost,
                    type_line=face.type_line,
                    oracle_text=face.oracle_text,
                    colors=face.colors,
                    image_uris=face.image_uris,
                    artist=face.artist,
                )
                for index, face in enumerate(dfc.faces)
            ]
        )
        await db.commit()


async def explain(factory):
    checks = {
        "ix_oracle_cards_search_document": """
            SELECT id FROM oracle_cards
            WHERE to_tsvector('english', coalesce(name, '') || ' ' ||
              coalesce(type_line, '') || ' ' || coalesce(oracle_text, ''))
              @@ plainto_tsquery('english', 'flying')
        """,
        "ix_oracle_cards_name_trgm": """
            SELECT id FROM oracle_cards WHERE name_normalized % 'lightnig bolt'
        """,
        "ix_oracle_cards_legalities_gin": """
            SELECT id FROM oracle_cards
            WHERE legalities @> '{"modern":"legal"}'::jsonb
        """,
        "ix_card_printings_colors_gin": """
            SELECT id FROM card_printings WHERE colors @> '["U"]'::jsonb
        """,
        "ix_card_printings_finishes_gin": """
            SELECT id FROM card_printings WHERE finishes @> '["foil"]'::jsonb
        """,
    }
    async with factory() as db:
        await db.execute(text("SET enable_seqscan = off"))
        for index_name, query in checks.items():
            plan = "\n".join(row[0] for row in (await db.execute(text(f"EXPLAIN {query}"))).all())
            assert index_name in plan, (index_name, plan)


def _literal_sql(statement):
    return str(
        statement.compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": True},
        )
    )


async def explain_actual_endpoint_queries(factory):
    base = _structured_card_filters(_card_rows(), None, None, None, None)
    checks = {
        "ix_oracle_cards_name_trgm": _postgres_filters(base, "lightnig bolt", None, None, None),
        "ix_oracle_cards_search_document": _postgres_filters(base, "flying", None, None, None),
        "ix_oracle_cards_type_line_trgm": _structured_card_filters(
            _card_rows(), None, None, None, "human wizard"
        ),
        "ix_card_printings_collector_lower": _structured_card_filters(
            _card_rows(), None, "001", None, None
        ),
    }
    async with factory() as db:
        await db.execute(text("DROP INDEX ix_oracle_cards_active_name"))
        await db.execute(text("SET enable_seqscan = off"))
        await db.execute(text("SET enable_indexscan = off"))
        await db.execute(text("DROP INDEX ix_oracle_cards_active"))
        for index_name, statement in checks.items():
            query = text(f"EXPLAIN {_literal_sql(statement).replace('%%', '%')}")
            plan = "\n".join(row[0] for row in (await db.execute(query)).all())
            assert index_name in plan, (index_name, plan)


async def seed_plan_cardinality(factory):
    """Make the disposable plan fixture large enough to choose selective indexes."""
    oracle_rows = []
    printing_rows = []
    for index in range(2_000):
        oracle_id = uuid.UUID(int=20_000 + index)
        oracle_rows.append(
            OracleCard(
                id=oracle_id,
                scryfall_id=oracle_id,
                name=f"Fixture Card {index}",
                name_normalized=f"fixture card {index}",
                layout="normal",
                cmc=2,
                type_line="Artifact",
                oracle_text="Disposable query plan fixture.",
                colors=[],
                color_identity=[],
                keywords=[],
                legalities={"modern": "not_legal"},
                first_seen_import_id=IMPORT_ID,
                last_seen_import_id=IMPORT_ID,
                active=True,
            )
        )
        printing_rows.append(
            printing(
                uuid.UUID(int=30_000 + index),
                oracle_id,
                f"F{index:04d}",
                [],
                ["nonfoil"],
                {"modern": "not_legal"},
                f"fixture-{index}",
            )
        )
    async with factory() as db:
        db.add_all(oracle_rows)
        await db.flush()
        db.add_all(printing_rows)
        await db.commit()
        await db.execute(text("ANALYZE oracle_cards"))
        await db.execute(text("ANALYZE card_printings"))
        await db.execute(text("ANALYZE card_sets"))


def main():
    root = Path("/tmp/wynterlabs-pg-api-smoke")
    root.mkdir(exist_ok=True)
    bootstrap = root / "bootstrap"
    pepper = root / "pepper"
    mfa_key = root / "mfa_key"
    bootstrap.write_text("smoke-bootstrap")
    pepper.write_text("p" * 64)
    mfa_key.write_bytes(bytes(range(32)))
    settings = Settings(
        database_url=os.environ["CARDS_DATABASE_URL"],
        bootstrap_secret_file=str(bootstrap),
        session_pepper_file=str(pepper),
        mfa_encryption_key_file=str(mfa_key),
        environment="development",
    )
    engine = create_async_engine(settings.resolved_database_url, poolclass=NullPool)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    asyncio.run(seed(factory))
    app = create_app(settings=settings, session_factory=factory)
    asyncio.run(engine.dispose())
    engine = create_async_engine(settings.resolved_database_url, poolclass=NullPool)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    with TestClient(app) as client:
        assert (
            client.post(
                "/api/v1/setup/owner",
                json={
                    "email": "member-22ac05493d18@example.invalid",
                    "display_name": "Smoke Owner",
                    "password": "test-only-credential-0c6ed6bdbd87",
                },
                headers={"X-Bootstrap-Secret": "test-only-credential-f51ab96ee49a"},
            ).status_code
            == 201
        )
        assert (
            client.post(
                "/api/v1/auth/login",
                json={
                    "email": "member-2ac107e738a1@example.invalid",
                    "password": "test-only-credential-d36717d654a0",
                },
            ).status_code
            == 200
        )
        exact = client.get("/api/v1/catalog/cards", params={"q": "lightning bolt"}).json()
        prefix = client.get("/api/v1/catalog/cards", params={"q": "lightning"}).json()
        fuzzy = client.get("/api/v1/catalog/cards", params={"q": "lightnig bolt"}).json()
        scanner_typo = client.get(
            "/api/v1/catalog/scan-candidates",
            params={"name": "lightnig bolt"},
        ).json()
        scanner_rules_text = client.get(
            "/api/v1/catalog/scan-candidates",
            params={"name": "deals 3 damage"},
        ).json()
        scanner_alphanumeric = client.get(
            "/api/v1/catalog/scan-candidates",
            params={
                "name": "lightning bolt",
                "set": "smk",
                "collector": "1a/999",
                "limit": 1,
            },
        ).json()
        full_text = client.get("/api/v1/catalog/cards", params={"q": "flying"}).json()
        blue = client.get("/api/v1/catalog/cards", params={"color": "U"}).json()
        colorless = client.get("/api/v1/catalog/cards", params={"color": "C"}).json()
        filtered = client.get(
            "/api/v1/catalog/cards",
            params={"legality": "modern", "finish": "foil"},
        ).json()
        page1 = client.get(
            f"/api/v1/catalog/oracle/{ORACLE_BOLT}/printings",
            params={"page": 1, "page_size": 200},
        ).json()
        page2 = client.get(
            f"/api/v1/catalog/oracle/{ORACLE_BOLT}/printings",
            params={"page": 2, "page_size": 200},
        ).json()
        assert exact["items"][0]["name"] == "Lightning Bolt"
        assert prefix["items"][0]["name"] == "Lightning Bolt"
        assert fuzzy["items"][0]["name"] == "Lightning Bolt"
        assert scanner_typo[0]["name"] == "Lightning Bolt"
        assert scanner_rules_text == []
        assert len(scanner_alphanumeric) == 1
        assert scanner_alphanumeric[0]["printing_id"] == str(ALPHANUMERIC_BOLT_PRINTING)
        assert scanner_alphanumeric[0]["collector_number"] == "001a"
        assert scanner_alphanumeric[0]["rank_reason"] == "exact_printing"
        assert [item["name"] for item in full_text["items"]] == ["Scholar // Skywing"]
        assert [item["name"] for item in blue["items"]] == ["Scholar // Skywing"]
        assert all(item["name"] != "Scholar // Skywing" for item in colorless["items"])
        assert [item["name"] for item in filtered["items"]] == ["Scholar // Skywing"]
        assert page1["total"] == 208 and page1["pages"] == 2
        assert len(page1["items"]) == 200 and len(page2["items"]) == 8
        assert {x["printing_id"] for x in page1["items"]}.isdisjoint(
            {x["printing_id"] for x in page2["items"]}
        )
    asyncio.run(engine.dispose())
    engine = create_async_engine(settings.resolved_database_url, poolclass=NullPool)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    asyncio.run(seed_plan_cardinality(factory))
    asyncio.run(explain(factory))
    asyncio.run(explain_actual_endpoint_queries(factory))
    asyncio.run(engine.dispose())
    print("ephemeral-postgres-catalog-api-smoke-ok")


if __name__ == "__main__":
    main()
