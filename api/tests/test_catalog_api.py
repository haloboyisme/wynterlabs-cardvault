import asyncio
import uuid
from datetime import UTC, date, datetime, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient
from mfa_helpers import enroll_current_user
from sqlalchemy import select
from sqlalchemy.dialects import postgresql

from app.catalog.media import CachedImage
from app.models import CardFace, CardPrinting, CardSet, CatalogImport, OracleCard, User
from app.routers.catalog import (
    _card_rows,
    _ordered,
    _postgres_filters,
    _preferred_set_order,
    _structured_card_filters,
)

IMPORT_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")
M10_SET_ID = uuid.UUID("00000000-0000-0000-0000-000000000010")
ISD_SET_ID = uuid.UUID("00000000-0000-0000-0000-000000000011")
BOLT_ORACLE_ID = uuid.UUID("00000000-0000-0000-0000-000000000020")
STRIKE_ORACLE_ID = uuid.UUID("00000000-0000-0000-0000-000000000021")
DELVER_ORACLE_ID = uuid.UUID("00000000-0000-0000-0000-000000000022")
WISDOM_ORACLE_ID = uuid.UUID("00000000-0000-0000-0000-000000000023")
BOLT_PRINTING_ID = uuid.UUID("00000000-0000-0000-0000-000000000030")
BOLT_OTHER_PRINTING_ID = uuid.UUID("00000000-0000-0000-0000-000000000031")
STRIKE_PRINTING_ID = uuid.UUID("00000000-0000-0000-0000-000000000032")
DELVER_PRINTING_ID = uuid.UUID("00000000-0000-0000-0000-000000000033")
WISDOM_PRINTING_ID = uuid.UUID("00000000-0000-0000-0000-000000000034")
POKEMON_SET_ID = uuid.UUID("00000000-0000-0000-0000-000000000040")
YUGIOH_SET_ID = uuid.UUID("00000000-0000-0000-0000-000000000041")
POKEMON_ORACLE_ID = uuid.UUID("00000000-0000-0000-0000-000000000042")
YUGIOH_ORACLE_ID = uuid.UUID("00000000-0000-0000-0000-000000000043")
POKEMON_PRINTING_ID = uuid.UUID("00000000-0000-0000-0000-000000000044")
YUGIOH_PRINTING_ID = uuid.UUID("00000000-0000-0000-0000-000000000045")
MISMATCHED_GAME_PRINTING_ID = uuid.UUID("00000000-0000-0000-0000-000000000046")
ALPHANUMERIC_BOLT_PRINTING_ID = uuid.UUID("00000000-0000-0000-0000-000000000047")


def _sign_in(client: TestClient, secret: str) -> None:
    response = client.post(
        "/api/v1/setup/owner",
        json={
            "email": "member-67dcd60ec598@example.com",
            "display_name": "Wynter Owner",
            "password": "test-only-credential-f0bb2c82b013",
        },
        headers={"X-Bootstrap-Secret": secret},
    )
    assert response.status_code == 201
    response = client.post(
        "/api/v1/auth/login",
        json={
            "email": "member-67dcd60ec598@example.com",
            "password": "test-only-credential-f0bb2c82b013",
        },
    )
    assert response.status_code == 200
    enroll_current_user(client, "test-only-credential-f0bb2c82b013")


def test_catalog_media_requires_authentication(client: TestClient) -> None:
    response = client.get(
        "/api/v1/catalog/media",
        params={"source": "https://cards.scryfall.io/normal/card.jpg"},
    )
    assert response.status_code == 401


def test_catalog_media_serves_cached_image(
    client: TestClient, bootstrap_secret: str, monkeypatch, tmp_path
) -> None:
    image = tmp_path / "card.jpg"
    image.write_bytes(b"card-image")

    async def cached(*_args, **_kwargs) -> CachedImage:
        return CachedImage(image, "image/jpeg")

    monkeypatch.setattr("app.routers.catalog.cache_remote_image", cached)
    _sign_in(client, bootstrap_secret)
    response = client.get(
        "/api/v1/catalog/media",
        params={"source": "https://cards.scryfall.io/normal/card.jpg"},
    )
    assert response.status_code == 200
    assert response.content == b"card-image"
    assert response.headers["content-type"] == "image/jpeg"


def test_catalog_media_returns_safe_error(
    client: TestClient, bootstrap_secret: str, monkeypatch
) -> None:
    async def unavailable(*_args, **_kwargs):
        raise ValueError("provider internals")

    monkeypatch.setattr("app.routers.catalog.cache_remote_image", unavailable)
    _sign_in(client, bootstrap_secret)
    response = client.get(
        "/api/v1/catalog/media",
        params={"source": "https://cards.scryfall.io/normal/card.jpg"},
    )
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "catalog_image_unavailable"
    assert "provider internals" not in response.text


def _oracle(
    row_id: uuid.UUID,
    name: str,
    type_line: str,
    text: str,
    colors: list[str],
    legalities: dict[str, str],
    *,
    layout: str = "normal",
    game: str = "mtg",
) -> OracleCard:
    return OracleCard(
        id=row_id,
        scryfall_id=row_id,
        game=game,
        name=name,
        name_normalized=name.lower(),
        layout=layout,
        mana_cost=None if layout == "transform" else "{1}",
        cmc=1,
        type_line=type_line,
        oracle_text=text,
        colors=colors,
        color_identity=colors,
        keywords=[],
        legalities=legalities,
        first_seen_import_id=IMPORT_ID,
        last_seen_import_id=IMPORT_ID,
        active=True,
    )


def _printing(
    row_id: uuid.UUID,
    oracle_id: uuid.UUID,
    set_id: uuid.UUID,
    collector: str,
    rarity: str,
    released: date,
    colors: list[str],
    legalities: dict[str, str],
    finishes: list[str],
    images: dict[str, str],
    *,
    layout: str = "normal",
    game: str = "mtg",
) -> CardPrinting:
    return CardPrinting(
        id=row_id,
        scryfall_id=row_id,
        game=game,
        oracle_card_id=oracle_id,
        card_set_id=set_id,
        language="en",
        collector_number=collector,
        rarity=rarity,
        released_at=released,
        artist="Test Artist",
        digital=False,
        promo=False,
        layout=layout,
        image_status="highres_scan",
        image_uris=images,
        prices={"usd": "1.23", "usd_foil": None},
        finishes=finishes,
        games=["paper"],
        colors=colors,
        color_identity=colors,
        legalities=legalities,
        first_seen_import_id=IMPORT_ID,
        last_seen_import_id=IMPORT_ID,
        active=True,
    )


async def _seed_catalog(app: FastAPI, source_age: timedelta = timedelta(hours=1)) -> None:
    now = datetime.now(UTC)
    async with app.state.session_factory() as database:
        database.add(
            CatalogImport(
                id=IMPORT_ID,
                source_bulk_id=uuid.UUID("00000000-0000-0000-0000-000000000002"),
                source_updated_at=now - source_age,
                source_uri="https://data.scryfall.io/default-cards/test.jsonl.gz",
                status="complete",
                active=True,
                completed_at=now,
                total_records=5,
                imported_records=5,
                rejected_records=0,
                set_count=2,
                oracle_count=4,
                printing_count=5,
            )
        )
        await database.flush()
        database.add_all(
            [
                CardSet(
                    id=M10_SET_ID,
                    scryfall_id=uuid.uuid4(),
                    code="M10",
                    code_normalized="m10",
                    name="Magic 2010",
                    set_type="core",
                    released_at=date(2009, 7, 17),
                    card_count=249,
                    first_seen_import_id=IMPORT_ID,
                    last_seen_import_id=IMPORT_ID,
                    active=True,
                ),
                CardSet(
                    id=ISD_SET_ID,
                    scryfall_id=uuid.uuid4(),
                    code="ISD",
                    code_normalized="isd",
                    name="Innistrad",
                    set_type="expansion",
                    released_at=date(2011, 9, 30),
                    card_count=264,
                    first_seen_import_id=IMPORT_ID,
                    last_seen_import_id=IMPORT_ID,
                    active=True,
                ),
            ]
        )
        database.add_all(
            [
                _oracle(
                    BOLT_ORACLE_ID,
                    "Lightning Bolt",
                    "Instant",
                    "Lightning Bolt deals 3 damage to any target.",
                    ["R"],
                    {"modern": "legal", "standard": "not_legal"},
                ),
                _oracle(
                    STRIKE_ORACLE_ID,
                    "Lightning Strike",
                    "Instant",
                    "Lightning Strike deals 3 damage to any target.",
                    ["R"],
                    {"modern": "legal", "standard": "legal"},
                ),
                _oracle(
                    DELVER_ORACLE_ID,
                    "Delver of Secrets // Insectile Aberration",
                    "Creature — Human Wizard // Creature — Human Insect",
                    "At the beginning of your upkeep, look at the top card.",
                    ["U"],
                    {"modern": "legal"},
                    layout="transform",
                ),
                _oracle(
                    WISDOM_ORACLE_ID,
                    "Forest's Wisdom",
                    "Sorcery",
                    "Draw two cards, then discard a card.",
                    ["G"],
                    {"standard": "legal"},
                ),
            ]
        )
        await database.flush()
        database.add_all(
            [
                _printing(
                    BOLT_PRINTING_ID,
                    BOLT_ORACLE_ID,
                    M10_SET_ID,
                    "146",
                    "common",
                    date(2009, 7, 17),
                    ["R"],
                    {"modern": "legal"},
                    ["nonfoil", "foil"],
                    {"normal": "https://cards.test/bolt.jpg"},
                ),
                _printing(
                    BOLT_OTHER_PRINTING_ID,
                    BOLT_ORACLE_ID,
                    ISD_SET_ID,
                    "301",
                    "rare",
                    date(2011, 9, 30),
                    ["R"],
                    {"modern": "legal"},
                    ["foil"],
                    {"normal": "https://cards.test/bolt-2.jpg"},
                ),
                _printing(
                    STRIKE_PRINTING_ID,
                    STRIKE_ORACLE_ID,
                    ISD_SET_ID,
                    "150",
                    "uncommon",
                    date(2011, 9, 30),
                    ["R"],
                    {"modern": "legal", "standard": "legal"},
                    ["nonfoil"],
                    {"normal": "https://cards.test/strike.jpg"},
                ),
                _printing(
                    DELVER_PRINTING_ID,
                    DELVER_ORACLE_ID,
                    ISD_SET_ID,
                    "51",
                    "common",
                    date(2011, 9, 30),
                    ["U"],
                    {"modern": "legal"},
                    ["nonfoil", "foil"],
                    {},
                    layout="transform",
                ),
                _printing(
                    WISDOM_PRINTING_ID,
                    WISDOM_ORACLE_ID,
                    M10_SET_ID,
                    "200",
                    "rare",
                    date(2009, 7, 17),
                    ["G"],
                    {"standard": "legal"},
                    ["nonfoil"],
                    {},
                ),
            ]
        )
        await database.flush()
        database.add_all(
            [
                CardFace(
                    printing_id=DELVER_PRINTING_ID,
                    face_index=0,
                    name="Delver of Secrets",
                    mana_cost="{U}",
                    type_line="Creature — Human Wizard",
                    oracle_text="Look at the top card.",
                    colors=["U"],
                    image_uris={"normal": "https://cards.test/delver-front.jpg"},
                    artist="Test Artist",
                ),
                CardFace(
                    printing_id=DELVER_PRINTING_ID,
                    face_index=1,
                    name="Insectile Aberration",
                    mana_cost=None,
                    type_line="Creature — Human Insect",
                    oracle_text="Flying",
                    colors=["U"],
                    image_uris={"normal": "https://cards.test/delver-back.jpg"},
                    artist="Test Artist",
                ),
            ]
        )
        await database.commit()


async def _seed_extra_bolt_printings(app: FastAPI, count: int) -> None:
    async with app.state.session_factory() as database:
        database.add_all(
            [
                _printing(
                    uuid.UUID(int=1000 + index),
                    BOLT_ORACLE_ID,
                    M10_SET_ID,
                    f"extra-{index:03d}",
                    "common",
                    date(2009, 7, 17),
                    ["R"],
                    {"modern": "legal"},
                    ["nonfoil"],
                    {"normal": f"https://cards.test/bolt-{index:03d}.jpg"},
                )
                for index in range(count)
            ]
        )
        await database.commit()


async def _seed_alphanumeric_bolt_printing(app: FastAPI) -> None:
    async with app.state.session_factory() as database:
        database.add(
            _printing(
                ALPHANUMERIC_BOLT_PRINTING_ID,
                BOLT_ORACLE_ID,
                M10_SET_ID,
                "001a",
                "common",
                date(2009, 7, 17),
                ["R"],
                {"modern": "legal"},
                ["nonfoil"],
                {"normal": "https://cards.test/bolt-001a.jpg"},
            )
        )
        await database.commit()


async def _seed_supported_game_catalog(app: FastAPI) -> None:
    """Add one exact printing for each non-Magic supported game."""
    async with app.state.session_factory() as database:
        database.add_all(
            [
                CardSet(
                    id=POKEMON_SET_ID,
                    scryfall_id=uuid.uuid4(),
                    game="pokemon",
                    code="M10",
                    code_normalized="m10",
                    name="Pokémon Test Set",
                    set_type="expansion",
                    released_at=date(2020, 1, 1),
                    card_count=1,
                    first_seen_import_id=IMPORT_ID,
                    last_seen_import_id=IMPORT_ID,
                    active=True,
                ),
                CardSet(
                    id=YUGIOH_SET_ID,
                    scryfall_id=uuid.uuid4(),
                    game="yugioh",
                    code="LOB",
                    code_normalized="lob",
                    name="Yu-Gi-Oh! Test Set",
                    set_type="booster",
                    released_at=date(2020, 1, 2),
                    card_count=1,
                    first_seen_import_id=IMPORT_ID,
                    last_seen_import_id=IMPORT_ID,
                    active=True,
                ),
                _oracle(
                    POKEMON_ORACLE_ID,
                    "Pikachu",
                    "Basic Pokémon",
                    "Test rule text.",
                    ["L"],
                    {},
                    game="pokemon",
                ),
                _oracle(
                    YUGIOH_ORACLE_ID,
                    "Pikachu",
                    "Normal Monster",
                    "Test rule text.",
                    [],
                    {},
                    game="yugioh",
                ),
            ]
        )
        await database.flush()
        database.add_all(
            [
                _printing(
                    POKEMON_PRINTING_ID,
                    POKEMON_ORACLE_ID,
                    POKEMON_SET_ID,
                    "25",
                    "common",
                    date(2020, 1, 1),
                    ["L"],
                    {},
                    ["nonfoil"],
                    {"normal": "https://cards.test/pikachu.jpg"},
                    game="pokemon",
                ),
                _printing(
                    YUGIOH_PRINTING_ID,
                    YUGIOH_ORACLE_ID,
                    YUGIOH_SET_ID,
                    "LOB-001",
                    "ultra_rare",
                    date(2020, 1, 2),
                    [],
                    {},
                    ["nonfoil"],
                    {"normal": "https://cards.test/blue-eyes.jpg"},
                    game="yugioh",
                ),
            ]
        )
        await database.commit()


async def _seed_mismatched_game_printing(app: FastAPI) -> None:
    """Create an invalid cross-game printing to exercise the expansion boundary."""
    async with app.state.session_factory() as database:
        database.add(
            _printing(
                MISMATCHED_GAME_PRINTING_ID,
                POKEMON_ORACLE_ID,
                YUGIOH_SET_ID,
                "LOB-999",
                "common",
                date(2020, 1, 2),
                [],
                {},
                ["nonfoil"],
                {"normal": "https://cards.test/mismatched-pikachu.jpg"},
                game="yugioh",
            )
        )
        await database.commit()


async def _require_password_replacement(app: FastAPI) -> None:
    async with app.state.session_factory() as database:
        user = await database.scalar(select(User))
        user.must_change_password = True
        await database.commit()


def test_whitespace_only_search_inputs_are_rejected(
    client: TestClient, bootstrap_secret: str
) -> None:
    _sign_in(client, bootstrap_secret)
    for field in ("q", "set", "collector", "type"):
        response = client.get("/api/v1/catalog/cards", params={field: "   "})
        assert response.status_code == 422, field
        assert response.json()["error"]["code"] == "validation_error"


def test_catalog_routes_require_authentication(client: TestClient) -> None:
    paths = [
        "/api/v1/catalog/status",
        "/api/v1/catalog/cards",
        f"/api/v1/catalog/cards/{BOLT_PRINTING_ID}",
        f"/api/v1/catalog/oracle/{BOLT_ORACLE_ID}/printings",
        "/api/v1/catalog/sets",
    ]
    for path in paths:
        response = client.get(path)
        assert response.status_code == 401, path
        assert response.json()["error"]["code"] == "not_authenticated"


def test_forced_password_session_cannot_search_catalog(
    client: TestClient, app: FastAPI, bootstrap_secret: str
) -> None:
    _sign_in(client, bootstrap_secret)
    asyncio.run(_require_password_replacement(app))

    response = client.get(
        "/api/v1/catalog/cards",
        params={"q": "lightning bolt"},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "password_change_required"


def test_status_unavailable_then_ready(
    client: TestClient, app: FastAPI, bootstrap_secret: str
) -> None:
    _sign_in(client, bootstrap_secret)
    assert client.get("/api/v1/catalog/status").json() == {
        "ready": False,
        "stale": False,
        "source_updated_at": None,
        "completed_at": None,
        "counts": {"sets": 0, "oracle_cards": 0, "printings": 0},
    }
    asyncio.run(_seed_catalog(app))
    payload = client.get("/api/v1/catalog/status").json()
    assert payload["ready"] is True
    assert payload["stale"] is False
    assert payload["counts"] == {"sets": 2, "oracle_cards": 4, "printings": 5}


def test_search_ranking_fallbacks_and_pagination(
    client: TestClient, app: FastAPI, bootstrap_secret: str
) -> None:
    _sign_in(client, bootstrap_secret)
    asyncio.run(_seed_catalog(app))
    prefix = client.get("/api/v1/catalog/cards", params={"q": "lightning"}).json()
    assert [item["name"] for item in prefix["items"]][:2] == ["Lightning Bolt", "Lightning Bolt"]
    exact = client.get("/api/v1/catalog/cards", params={"set": "M10", "collector": "146"}).json()
    assert [item["printing_id"] for item in exact["items"]] == [str(BOLT_PRINTING_ID)]
    fuzzy = client.get("/api/v1/catalog/cards", params={"q": "lightnig bolt"}).json()
    assert fuzzy["items"][0]["name"] == "Lightning Bolt"
    text = client.get("/api/v1/catalog/cards", params={"q": "draw two cards"}).json()
    assert [item["name"] for item in text["items"]] == ["Forest's Wisdom"]
    first = client.get(
        "/api/v1/catalog/cards", params={"sort": "name", "page": 1, "page_size": 2}
    ).json()
    second = client.get(
        "/api/v1/catalog/cards", params={"sort": "name", "page": 2, "page_size": 2}
    ).json()
    assert first["total"] == 5 and first["pages"] == 3
    assert {x["printing_id"] for x in first["items"]}.isdisjoint(
        {x["printing_id"] for x in second["items"]}
    )


def test_catalog_game_contract_filters_supported_games_and_hides_unknown_games(
    client: TestClient, app: FastAPI, bootstrap_secret: str
) -> None:
    asyncio.run(_seed_catalog(app))
    asyncio.run(_seed_supported_game_catalog(app))
    _sign_in(client, bootstrap_secret)

    auto = client.get("/api/v1/catalog/cards").json()
    magic = client.get("/api/v1/catalog/cards", params={"game": " MTG "}).json()
    pokemon = client.get("/api/v1/catalog/cards", params={"game": "pokemon"}).json()
    yugioh = client.get("/api/v1/catalog/cards", params={"game": "yugioh"}).json()
    unknown = client.get("/api/v1/catalog/cards", params={"game": "invented"}).json()
    pokemon_sets = client.get("/api/v1/catalog/sets", params={"game": "pokemon"}).json()

    assert {item["set"]["game"] for item in auto["items"]} == {"mtg", "pokemon", "yugioh"}
    assert {item["set"]["game"] for item in magic["items"]} == {"mtg"}
    assert [item["printing_id"] for item in pokemon["items"]] == [str(POKEMON_PRINTING_ID)]
    assert [item["printing_id"] for item in yugioh["items"]] == [str(YUGIOH_PRINTING_ID)]
    assert [item["id"] for item in pokemon_sets["items"]] == [str(POKEMON_SET_ID)]
    assert unknown == {"items": [], "page": 1, "page_size": 25, "total": 0, "pages": 0}


def test_filters_empty_and_invalid_bounds(
    client: TestClient, app: FastAPI, bootstrap_secret: str
) -> None:
    _sign_in(client, bootstrap_secret)
    asyncio.run(_seed_catalog(app))
    response = client.get(
        "/api/v1/catalog/cards",
        params={
            "set": "isd",
            "rarity": "common",
            "color": "U",
            "type": "creature",
            "legality": "modern",
            "finish": "foil",
        },
    )
    assert [x["printing_id"] for x in response.json()["items"]] == [str(DELVER_PRINTING_ID)]
    empty = client.get("/api/v1/catalog/cards", params={"q": "no such magic card"}).json()
    assert empty["items"] == [] and empty["total"] == 0
    assert (
        client.get(
            "/api/v1/catalog/cards",
            params={"page_size": 100},
        ).status_code
        == 200
    )
    assert client.get("/api/v1/catalog/cards").json()["page_size"] == 25
    invalid = [
        {"page": 0},
        {"page_size": 0},
        {"page_size": 101},
        {"q": "x" * 121},
        {"sort": "drop_table"},
        {"rarity": "impossible"},
        {"color": "purple"},
        {"legality": "not a format"},
        {"finish": "sparkly"},
    ]
    for params in invalid:
        response = client.get("/api/v1/catalog/cards", params=params)
        assert response.status_code == 422, params
        assert response.json()["error"]["code"] == "validation_error"


def test_detail_image_fallback_printings_and_missing(
    client: TestClient, app: FastAPI, bootstrap_secret: str
) -> None:
    _sign_in(client, bootstrap_secret)
    asyncio.run(_seed_catalog(app))
    detail = client.get(f"/api/v1/catalog/cards/{DELVER_PRINTING_ID}").json()
    assert detail["image_uris"]["normal"].endswith("delver-front.jpg")
    assert [face["name"] for face in detail["faces"]] == [
        "Delver of Secrets",
        "Insectile Aberration",
    ]
    assert detail["prices"]["usd"] == "1.23"
    printings = client.get(f"/api/v1/catalog/oracle/{BOLT_ORACLE_ID}/printings").json()
    assert [x["printing_id"] for x in printings["items"]] == [
        str(BOLT_OTHER_PRINTING_ID),
        str(BOLT_PRINTING_ID),
    ]
    missing = client.get("/api/v1/catalog/cards/ffffffff-ffff-ffff-ffff-ffffffffffff")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "card_not_found"
    missing = client.get("/api/v1/catalog/oracle/ffffffff-ffff-ffff-ffff-ffffffffffff/printings")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "oracle_card_not_found"


def test_sets_are_active_bounded_and_sorted(
    client: TestClient, app: FastAPI, bootstrap_secret: str
) -> None:
    _sign_in(client, bootstrap_secret)
    asyncio.run(_seed_catalog(app))
    payload = client.get("/api/v1/catalog/sets").json()

    assert payload["total"] == 2
    assert [item["code"] for item in payload["items"]] == ["ISD", "M10"]


def test_oracle_printings_paginates_beyond_two_hundred(
    client: TestClient, app: FastAPI, bootstrap_secret: str
) -> None:
    _sign_in(client, bootstrap_secret)
    asyncio.run(_seed_catalog(app))
    asyncio.run(_seed_extra_bolt_printings(app, 201))

    first = client.get(
        f"/api/v1/catalog/oracle/{BOLT_ORACLE_ID}/printings",
        params={"page": 1, "page_size": 200},
    )
    second = client.get(
        f"/api/v1/catalog/oracle/{BOLT_ORACLE_ID}/printings",
        params={"page": 2, "page_size": 200},
    )
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["total"] == 203
    assert first.json()["pages"] == 2
    assert len(first.json()["items"]) == 200
    assert second.json()["page"] == 2
    assert second.json()["page_size"] == 200
    assert len(second.json()["items"]) == 3
    assert {item["printing_id"] for item in first.json()["items"]}.isdisjoint(
        {item["printing_id"] for item in second.json()["items"]}
    )


def test_oracle_printings_keep_selected_game_boundary_for_shared_oracles(
    client: TestClient, app: FastAPI, bootstrap_secret: str
) -> None:
    _sign_in(client, bootstrap_secret)
    asyncio.run(_seed_catalog(app))
    asyncio.run(_seed_supported_game_catalog(app))
    asyncio.run(_seed_mismatched_game_printing(app))

    pokemon = client.get(
        f"/api/v1/catalog/oracle/{POKEMON_ORACLE_ID}/printings",
        params={"game": "pokemon"},
    )
    yugioh = client.get(
        f"/api/v1/catalog/oracle/{POKEMON_ORACLE_ID}/printings",
        params={"game": "yugioh"},
    )

    assert pokemon.status_code == 200
    assert [item["printing_id"] for item in pokemon.json()["items"]] == [str(POKEMON_PRINTING_ID)]
    assert yugioh.status_code == 200
    assert yugioh.json()["items"] == []


def test_postgres_search_sql_matches_expression_and_jsonb_indexes():
    statement = _postgres_filters(
        _card_rows(),
        "flying",
        "U",
        "modern",
        "foil",
    )
    statement = _ordered(statement, "relevance", "flying", "postgresql")
    sql = str(statement.compile(dialect=postgresql.dialect()))
    assert "to_tsvector('english'::regconfig," in sql
    assert "plainto_tsquery('english'::regconfig," in sql
    assert "oracle_cards.legalities @>" in sql
    assert "card_printings.legalities @>" not in sql
    assert "card_printings.colors @>" in sql
    assert "card_printings.finishes @>" in sql


def test_postgres_fuzzy_type_and_collector_predicates_match_indexes():
    fuzzy = str(
        _postgres_filters(_card_rows(), "lightnig bolt", None, None, None).compile(
            dialect=postgresql.dialect()
        )
    )
    structured = str(
        _structured_card_filters(
            _card_rows(),
            None,
            "146",
            None,
            "human wizard",
        ).compile(dialect=postgresql.dialect())
    )
    assert "oracle_cards.name_normalized %" in fuzzy
    assert "similarity(oracle_cards.name_normalized" not in fuzzy.split("ORDER BY")[0]
    assert "lower(card_printings.collector_number) =" in structured
    assert "lower(oracle_cards.type_line) LIKE" in structured


def test_postgres_auto_scan_order_uses_a_value_not_an_invalid_ordinal():
    auto = str(
        select(CardSet.id)
        .order_by(_preferred_set_order(None))
        .compile(dialect=postgresql.dialect())
    )
    preferred = str(
        select(CardSet.id)
        .order_by(_preferred_set_order("m10"))
        .compile(dialect=postgresql.dialect())
    )

    assert "ORDER BY 0" not in auto
    assert "ORDER BY %(param_1)s" in auto
    assert "CASE WHEN" in preferred


def test_scan_candidates_require_auth_and_rank_exact_printing(
    client: TestClient, app: FastAPI, bootstrap_secret: str
) -> None:
    assert (
        client.get("/api/v1/catalog/scan-candidates", params={"name": "Lightning Bolt"}).status_code
        == 401
    )
    _sign_in(client, bootstrap_secret)
    asyncio.run(_seed_catalog(app))
    asyncio.run(_seed_alphanumeric_bolt_printing(app))

    response = client.get(
        "/api/v1/catalog/scan-candidates",
        params={"name": " Lightning Bolt ", "set": "M10", "collector": "146", "limit": 20},
    )
    assert response.status_code == 200
    assert response.json()[0]["printing_id"] == str(BOLT_PRINTING_ID)
    assert response.json()[0]["rank_reason"] == "exact_printing"
    assert len(response.json()) <= 20
    denominator = client.get(
        "/api/v1/catalog/scan-candidates",
        params={"name": "Lightning Bolt", "set": "M10", "collector": "0146/0249"},
    )
    assert denominator.status_code == 200
    assert denominator.json()[0]["printing_id"] == str(BOLT_PRINTING_ID)
    assert denominator.json()[0]["rank_reason"] == "exact_printing"
    alphanumeric = client.get(
        "/api/v1/catalog/scan-candidates",
        params={"name": "Lightning Bolt", "set": "M10", "collector": "0001a/0249"},
    )
    assert alphanumeric.status_code == 200
    assert alphanumeric.json()[0]["printing_id"] == str(ALPHANUMERIC_BOLT_PRINTING_ID)
    assert alphanumeric.json()[0]["rank_reason"] == "exact_printing"
    preferred = client.get(
        "/api/v1/catalog/scan-candidates",
        params={"name": "Lightning Bolt", "preferred_set": "M10"},
    )
    assert preferred.status_code == 200
    preferred_ids = [item["printing_id"] for item in preferred.json()]
    off_set_index = preferred_ids.index(str(BOLT_OTHER_PRINTING_ID))
    assert preferred_ids.index(str(BOLT_PRINTING_ID)) < off_set_index
    assert preferred_ids.index(str(ALPHANUMERIC_BOLT_PRINTING_ID)) < off_set_index
    exact_overrides_preference = client.get(
        "/api/v1/catalog/scan-candidates",
        params={
            "name": "Lightning Bolt",
            "set": "M10",
            "collector": "146",
            "preferred_set": "ISD",
        },
    )
    assert exact_overrides_preference.status_code == 200
    assert exact_overrides_preference.json()[0]["printing_id"] == str(BOLT_PRINTING_ID)
    weak = client.get(
        "/api/v1/catalog/scan-candidates",
        params={"name": "i ro a \\ a A"},
    )
    assert weak.status_code == 200
    assert weak.json() == []
    rules_text = client.get(
        "/api/v1/catalog/scan-candidates",
        params={"name": "deals 3 damage"},
    )
    assert rules_text.status_code == 200
    assert rules_text.json() == []
    assert client.get("/api/v1/catalog/scan-candidates", params={"name": "   "}).status_code == 422


def test_scan_candidates_respects_game_filter_in_sqlite(
    client: TestClient, app: FastAPI, bootstrap_secret: str
) -> None:
    _sign_in(client, bootstrap_secret)
    asyncio.run(_seed_catalog(app))
    asyncio.run(_seed_supported_game_catalog(app))

    pokemon = client.get(
        "/api/v1/catalog/scan-candidates",
        params={"name": "Pikachu", "game": "pokemon"},
    )
    magic = client.get(
        "/api/v1/catalog/scan-candidates",
        params={"name": "Pikachu", "game": "mtg"},
    )
    yugioh = client.get(
        "/api/v1/catalog/scan-candidates",
        params={"name": "Pikachu", "game": "yugioh"},
    )
    auto = client.get(
        "/api/v1/catalog/scan-candidates",
        params={"name": "Pikachu"},
    )

    assert pokemon.status_code == 200
    assert [
        (item["printing_id"], item["set"]["id"], item["set"]["game"]) for item in pokemon.json()
    ] == [(str(POKEMON_PRINTING_ID), str(POKEMON_SET_ID), "pokemon")]
    assert magic.status_code == 200
    assert magic.json() == []
    assert yugioh.status_code == 200
    assert [
        (item["printing_id"], item["set"]["id"], item["set"]["game"]) for item in yugioh.json()
    ] == [(str(YUGIOH_PRINTING_ID), str(YUGIOH_SET_ID), "yugioh")]
    assert auto.status_code == 200
    assert {
        (item["printing_id"], item["set"]["id"], item["set"]["game"]) for item in auto.json()
    } == {
        (str(POKEMON_PRINTING_ID), str(POKEMON_SET_ID), "pokemon"),
        (str(YUGIOH_PRINTING_ID), str(YUGIOH_SET_ID), "yugioh"),
    }


def test_scan_candidates_qualifies_preferred_set_by_game_without_hiding_fallbacks(
    client: TestClient, app: FastAPI, bootstrap_secret: str
) -> None:
    _sign_in(client, bootstrap_secret)
    asyncio.run(_seed_catalog(app))
    asyncio.run(_seed_supported_game_catalog(app))

    response = client.get(
        "/api/v1/catalog/scan-candidates",
        params={"name": "Pikachu", "preferred_set": "M10", "preferred_game": "pokemon"},
    )

    assert response.status_code == 200
    assert response.json()[0]["printing_id"] == str(POKEMON_PRINTING_ID)
    assert {item["printing_id"] for item in response.json()} == {
        str(POKEMON_PRINTING_ID),
        str(YUGIOH_PRINTING_ID),
    }
