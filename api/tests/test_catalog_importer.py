import asyncio
import gzip
import io
import json
import uuid
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.catalog import cli as catalog_cli
from app.catalog.cli import run
from app.catalog.importer import (
    CatalogImporter,
    ImportOutcome,
    normalize_card,
)
from app.catalog.one_piece import OnePieceClient, normalize_one_piece_card
from app.catalog.pokemon import PokemonClient, _cards_from_archive, normalize_pokemon_card
from app.catalog.scryfall import BULK_METADATA_URL, BulkMetadata, ScryfallClient
from app.catalog.status import read_catalog_status
from app.catalog.yugioh import YugiohClient, normalize_yugioh_card
from app.config import Settings
from app.database import Base
from app.models import CardFace, CardPrinting, CatalogImport, OracleCard

FIXTURE = Path(__file__).parent / "fixtures" / "scryfall_cards.jsonl"
SOURCE_ID = uuid.UUID("e2ef41e3-5778-4bc2-af3f-78eca4dd9c23")
UPDATED = datetime(2026, 8, 12, 21, 5, tzinfo=UTC)
URI = "https://data.scryfall.io/default-cards/test.jsonl.gz"
POKEMON_FIXTURE = Path(__file__).parent / "fixtures" / "pokemon_cards.json"
YUGIOH_FIXTURE = Path(__file__).parent / "fixtures" / "yugioh_cards.json"


def settings_for(path):
    (path / "bootstrap").write_text("test")
    (path / "pepper").write_text("p" * 64)
    (path / "mfa_key").write_bytes(bytes(range(32)))
    return Settings(
        database_url=f"sqlite+aiosqlite:///{path / 'db'}",
        bootstrap_secret_file=str(path / "bootstrap"),
        session_pepper_file=str(path / "pepper"),
        mfa_encryption_key_file=str(path / "mfa_key"),
        environment="development",
        catalog_min_printings=1,
        catalog_min_sets=1,
        catalog_pokemon_min_printings=1,
        catalog_pokemon_min_sets=1,
        catalog_yugioh_min_printings=1,
        catalog_yugioh_min_sets=1,
        catalog_one_piece_min_printings=1,
        catalog_one_piece_min_sets=1,
        catalog_tcgjson_min_printings=1,
        catalog_tcgjson_min_sets=1,
        catalog_max_rejected_records=10,
        catalog_max_rejected_ratio=0.5,
        catalog_max_download_bytes=1000000,
        catalog_batch_size=2,
        catalog_retry_attempts=2,
    )


def metadata(changed=False):
    return BulkMetadata(
        uuid.uuid4() if changed else SOURCE_ID,
        datetime(2026, 8, 13, tzinfo=UTC) if changed else UPDATED,
        URI,
        4096,
    )


class Source:
    def __init__(self, fixture=FIXTURE, changed=False, fail=False):
        self.fixture, self.changed, self.fail = fixture, changed, fail
        self.download_calls = 0

    async def fetch_bulk_metadata(self):
        return metadata(self.changed)

    async def download_bulk(self, _metadata, destination):
        self.download_calls += 1
        if self.fail:
            raise RuntimeError("download failed token=very-secret-value")
        with self.fixture.open("rb") as source, gzip.open(destination, "wb") as target:
            target.write(source.read())


async def database(path):
    settings = settings_for(path)
    engine = create_async_engine(settings.resolved_database_url)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    return settings, engine, async_sessionmaker(engine, expire_on_commit=False)


def test_client_fixed_endpoint_headers_retries_and_limits(tmp_path):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "object": "bulk_data",
                "id": str(SOURCE_ID),
                "type": "default_cards",
                "updated_at": UPDATED.isoformat(),
                "jsonl_download_uri": URI,
                "compressed_size": 4096,
            },
        )

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            result = await ScryfallClient(
                settings_for(tmp_path), http_client=http
            ).fetch_bulk_metadata()
            assert result.bulk_id == SOURCE_ID

    asyncio.run(exercise())
    assert requests[0].url == httpx.URL(BULK_METADATA_URL)
    assert requests[0].headers["user-agent"].startswith("WynterLabs-Cards/")
    assert requests[0].headers["accept"] == "application/json"


def test_metadata_rejects_wrong_type_and_non_https(tmp_path):
    async def exercise(payload):
        transport = httpx.MockTransport(lambda request: httpx.Response(200, json=payload))
        async with httpx.AsyncClient(transport=transport) as http:
            with pytest.raises(ValueError):
                await ScryfallClient(settings_for(tmp_path), http_client=http).fetch_bulk_metadata()

    base = {
        "object": "bulk_data",
        "id": str(SOURCE_ID),
        "type": "default_cards",
        "updated_at": UPDATED.isoformat(),
        "jsonl_download_uri": URI,
        "compressed_size": 4096,
    }
    asyncio.run(exercise({**base, "type": "oracle_cards"}))
    asyncio.run(exercise({**base, "jsonl_download_uri": "http://example.test/cards.gz"}))


def test_yugioh_client_pages_with_documented_num_and_offset(tmp_path):
    requests = []
    card = json.loads(YUGIOH_FIXTURE.read_text())["data"][0]

    def handler(request):
        requests.append(request)
        offset = int(request.url.params["offset"])
        return httpx.Response(200, json={"data": [card] if offset == 0 else []})

    async def exercise():
        settings = settings_for(tmp_path)
        settings.catalog_yugioh_page_size = 1
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            rows = await YugiohClient(settings, http_client=http).fetch_cards()
        assert rows == [card]

    asyncio.run(exercise())
    assert [(request.url.params["num"], request.url.params["offset"]) for request in requests] == [
        ("1", "0"),
        ("1", "1"),
    ]


def test_one_piece_client_reads_bounded_tcgjson_catalog(tmp_path):
    catalog = {
        "meta": {"object": "tcgjson_catalog", "generatedAt": "2026-08-24T10:53:52Z"},
        "sets": [{
            "setId": 3188, "name": "Romance Dawn", "abbreviation": "OP01",
            "releaseDate": "2022-12-02T00:00:00", "productCount": 1,
        }],
        "products": [{
            "productId": 454512, "name": "Roronoa Zoro (001)", "setId": 3188,
            "collectorNumber": "OP01-001", "rarity": "Leader", "foilings": ["Normal"],
            "imageUrls": ["https://tcgplayer-cdn.tcgplayer.com/product/454512_in_1000x1000.jpg"],
            "metadata": {"rulesText": "All Characters gain +1000 power.", "colors": ["Red"]},
        }],
    }
    payload = gzip.compress(json.dumps(catalog).encode())

    async def exercise():
        transport = httpx.MockTransport(lambda _request: httpx.Response(
            200, content=payload, headers={"content-type": "application/octet-stream"},
        ))
        async with httpx.AsyncClient(transport=transport) as http:
            return await OnePieceClient(settings_for(tmp_path), http_client=http).fetch_cards()

    rows = asyncio.run(exercise())
    assert rows[0]["_set"]["name"] == "Romance Dawn"
    assert rows[0]["_catalog_generated_at"] == "2026-08-24T10:53:52Z"


def test_one_piece_normalization_preserves_printing_identity_and_image():
    card = normalize_one_piece_card({
        "productId": 454512,
        "name": "Roronoa Zoro (001)",
        "setId": 3188,
        "collectorNumber": "OP01-001",
        "rarity": "Leader",
        "foilings": ["Normal"],
        "imageUrls": ["https://tcgplayer-cdn.tcgplayer.com/product/454512_in_1000x1000.jpg"],
        "metadata": {
            "rulesText": "All Characters gain +1000 power.",
            "colors": ["Red"],
            "cardTypes": ["Leader"],
            "customAttributes": {"subtypes": ["Straw Hat Crew"]},
        },
        "_set": {
            "setId": 3188,
            "name": "Romance Dawn",
            "abbreviation": "OP01",
            "releaseDate": "2022-12-02T00:00:00",
            "productCount": 154,
        },
        "_catalog_generated_at": "2026-08-24T10:53:52Z",
    })
    assert card.card_set.game == card.oracle.game == card.printing.game == "onepiece"
    assert card.card_set.code == "OP01"
    assert card.printing.collector_number == "OP01-001"
    assert card.printing.finishes == ["nonfoil"]
    assert card.printing.image_uris == {
        "normal": "https://tcgplayer-cdn.tcgplayer.com/product/454512_in_1000x1000.jpg"
    }
    assert card.oracle.type_line == "Leader"
    assert card.oracle.keywords == ["Straw Hat Crew"]


def test_one_piece_normalization_keeps_don_cards_without_printed_numbers():
    card = normalize_one_piece_card({
        "productId": 456059,
        "name": "DON!! Card (Manga) (Alternate Art)",
        "setId": 3188,
        "collectorNumber": "",
        "rarity": "DON!!",
        "foilings": ["Foil"],
        "imageUrls": [],
        "metadata": {"cardTypes": ["DON!!"]},
        "_set": {"setId": 3188, "name": "Romance Dawn", "abbreviation": "OP01"},
    })

    assert card.printing.collector_number == "TCG-456059"
    assert card.printing.finishes == ["foil"]


def test_shared_tcgjson_registry_and_normalizer_support_five_more_games():
    from app.catalog.tcgjson import TCGJSON_GAMES, normalize_tcgjson_card

    assert {key: value.slug for key, value in TCGJSON_GAMES.items()} == {
        "onepiece": "one-piece",
        "digimon": "digimon-card-game",
        "starwars": "star-wars-unlimited",
        "unionarena": "union-arena",
        "lorcana": "lorcana",
        "riftbound": "riftbound",
    }
    for game in ("digimon", "starwars", "unionarena", "lorcana", "riftbound"):
        card = normalize_tcgjson_card({
            "productId": 123,
            "name": "Test Card (001)",
            "collectorNumber": "001",
            "rarity": "Rare",
            "foilings": ["Normal"],
            "imageUrls": ["https://tcgplayer-cdn.tcgplayer.com/product/123_in_1000x1000.jpg"],
            "metadata": {"cardTypes": ["Character"]},
            "_set": {"setId": 10, "name": "First Set", "abbreviation": "FS1"},
        }, game)
        assert card.card_set.game == game
        assert card.oracle.game == game
        assert card.printing.game == game
        assert card.printing.source_uri == "https://www.tcgplayer.com/product/123"


def test_digimon_normalizer_adds_same_number_reference_artwork_fallback():
    from app.catalog.tcgjson import normalize_tcgjson_card

    card = normalize_tcgjson_card({
        "productId": 618951,
        "name": "Terriermon",
        "collectorNumber": "BT19-044 U",
        "rarity": "Uncommon",
        "foilings": ["Normal"],
        "imageUrls": [
            "https://tcgplayer-cdn.tcgplayer.com/product/618951_in_1000x1000.jpg"
        ],
        "metadata": {"cardTypes": ["Digimon"]},
        "_set": {"setId": 10, "name": "Xros Evolution", "abbreviation": "BT19"},
    }, "digimon")

    assert card.printing.image_uris == {
        "normal": "https://tcgplayer-cdn.tcgplayer.com/product/618951_in_1000x1000.jpg",
        "reference": "https://images.digimoncard.io/images/cards/BT19-044.webp",
    }


def test_normalization_allows_only_https_scryfall_source_uris():
    record = json.loads(FIXTURE.read_text().splitlines()[0])
    record["scryfall_uri"] = "https://scryfall.com/card/tst/1"
    assert normalize_card(record).printing.source_uri == record["scryfall_uri"]

    for invalid in (
        "http://scryfall.com/card/tst/1",
        "https://scryfall.com.evil.test/card",
        "https://example.test/card",
        "javascript:alert(1)",
    ):
        record["scryfall_uri"] = invalid
        assert normalize_card(record).printing.source_uri is None


def test_normalization_faces_language_and_reversible_identity():
    lines = FIXTURE.read_text().splitlines()
    assert len(normalize_card(json.loads(lines[1])).faces) == 2
    assert normalize_card(json.loads(lines[3])).printing.language == "ja"
    expected = uuid.UUID("20000000-0000-4000-8000-000000000004")
    assert normalize_card(json.loads(lines[5])).oracle.scryfall_id == expected


def test_pokemon_normalization_uses_provider_identity_and_allowlisted_images():
    """Would fail if a provider ID is not made into a stable Pokémon printing."""
    card = normalize_pokemon_card(json.loads(POKEMON_FIXTURE.read_text())["data"][0])
    assert card.card_set.game == card.oracle.game == card.printing.game == "pokemon"
    assert card.card_set.code == "sv1"
    assert card.printing.collector_number == "198/198"
    assert card.printing.prices == {"usd_foil": "17.25"}
    assert card.printing.finishes == ["foil"]
    assert card.printing.image_uris == {
        "small": "https://images.pokemontcg.io/sv1/198.png",
        "large": "https://images.pokemontcg.io/sv1/198_hires.png",
    }
    assert (
        card.printing.scryfall_id
        == normalize_pokemon_card(
            json.loads(POKEMON_FIXTURE.read_text())["data"][0]
        ).printing.scryfall_id
    )


def test_pokemon_official_archive_fallback_combines_cards_with_set_metadata():
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr(
            "pokemon-tcg-data-master/sets/en.json",
            json.dumps([{"id": "base1", "name": "Base", "total": 1}]),
        )
        archive.writestr(
            "pokemon-tcg-data-master/cards/en/base1.json",
            json.dumps([{"id": "base1-1", "name": "Alakazam", "number": "1"}]),
        )

    cards = _cards_from_archive(output.getvalue(), max_records=10, max_uncompressed=10_000)

    assert cards == [
        {
            "id": "base1-1",
            "name": "Alakazam",
            "number": "1",
            "set": {"id": "base1", "name": "Base", "total": 1},
        }
    ]


def test_pokemon_normalization_keeps_normal_and_foil_market_prices_separate():
    """Would fail if a holo price replaced the normal-card market price."""
    record = json.loads(POKEMON_FIXTURE.read_text())["data"][0]
    record["set"]["ptcgoCode"] = "SVI"
    record["tcgplayer"]["prices"] = {
        "normal": {"market": 1.25},
        "holofoil": {"market": 2.5},
        "reverseHolofoil": {"market": 2.75},
    }
    card = normalize_pokemon_card(record)
    assert card.card_set.code == "sv1"
    assert card.printing.prices == {"usd": "1.25", "usd_foil": "2.5"}
    assert card.printing.finishes == ["nonfoil", "foil"]


def test_pokemon_normalization_marks_holo_only_cards_as_foil_only():
    """Would fail if unavailable normal market data implied a nonfoil printing."""
    record = json.loads(POKEMON_FIXTURE.read_text())["data"][0]
    record["tcgplayer"]["prices"] = {"reverseHolofoil": {"market": 2.75}}
    card = normalize_pokemon_card(record)
    assert card.printing.prices == {"usd_foil": "2.75"}
    assert card.printing.finishes == ["foil"]


def test_pokemon_normalization_keeps_variants_without_market_values_collectable():
    """Would fail if an unpriced normal or foil variant disappeared from finishes."""
    record = json.loads(POKEMON_FIXTURE.read_text())["data"][0]
    record["tcgplayer"]["prices"] = {
        "normal": {"low": 1.0},
        "holofoil": {"market": None},
    }
    card = normalize_pokemon_card(record)
    assert card.printing.prices == {}
    assert card.printing.finishes == ["nonfoil", "foil"]


@pytest.mark.parametrize("prices", [None, {}])
def test_pokemon_normalization_defaults_price_less_cards_to_collectable_nonfoil(prices):
    """Would fail if absent provider prices made an otherwise valid printing uncollectable."""
    record = json.loads(POKEMON_FIXTURE.read_text())["data"][0]
    if prices is None:
        record.pop("tcgplayer")
    else:
        record["tcgplayer"] = {"prices": prices}
    card = normalize_pokemon_card(record)
    assert card.printing.prices == {}
    assert card.printing.finishes == ["nonfoil"]


def test_pokemon_normalization_preserves_provider_freshness_and_legalities():
    """Would fail if available card and set legality metadata were discarded."""
    record = json.loads(POKEMON_FIXTURE.read_text())["data"][0]
    record["set"]["updatedAt"] = "2026/08/27 12:34:56"
    record["legalities"] = {"standard": "Legal", "expanded": "Banned"}
    record["set"]["legalities"] = {"expanded": "Legal", "unlimited": "Legal"}
    card = normalize_pokemon_card(record)
    assert card.card_set.source_updated_at == datetime(2026, 8, 27, 12, 34, 56, tzinfo=UTC)
    assert card.oracle.legalities == {
        "standard": "legal",
        "expanded": "banned",
        "unlimited": "legal",
    }
    assert card.printing.legalities == card.oracle.legalities
    assert card.printing.legalities["standard"] == "legal"
    from app.routers.catalog import _sqlite_filters

    rows = [
        (SimpleNamespace(legalities=card.printing.legalities, colors=[], finishes=[]), None, None)
    ]
    assert _sqlite_filters(rows, None, None, "standard", None) == rows
    assert _sqlite_filters(rows, None, None, "expanded", None) == []


@pytest.mark.parametrize("client_type", [PokemonClient, YugiohClient])
def test_provider_clients_decode_compressed_multichunk_json(tmp_path, client_type):
    """Would fail if the shared bounded reader parsed raw compressed bytes."""
    card = {"id": "compressed-card", "padding": "x" * 2048, "card_sets": [{"set_code": "TEST-1"}]}
    encoded = gzip.compress(json.dumps({"data": [card], "totalCount": 1}).encode())
    chunk_size = max(1, len(encoded) // 3)
    chunks = [encoded[index : index + chunk_size] for index in range(0, len(encoded), chunk_size)]

    class CompressedStream(httpx.AsyncByteStream):
        chunks_consumed = 0

        async def __aiter__(self):
            for chunk in chunks:
                self.chunks_consumed += 1
                yield chunk

    async def exercise():
        settings = settings_for(tmp_path)
        settings.catalog_retry_attempts = 1
        settings.catalog_max_provider_response_bytes = 4096
        stream = CompressedStream()
        transport = httpx.MockTransport(
            lambda _request: httpx.Response(
                200,
                headers={"Content-Type": "application/json", "Content-Encoding": "gzip"},
                stream=stream,
            )
        )
        async with httpx.AsyncClient(transport=transport) as http:
            rows = await client_type(settings, http_client=http).fetch_cards()
        assert rows == [card]
        assert stream.chunks_consumed == len(chunks)

    asyncio.run(exercise())


@pytest.mark.parametrize("client_type", [PokemonClient, YugiohClient])
def test_provider_clients_abort_streaming_responses_that_exceed_the_byte_limit(
    tmp_path, client_type
):
    """Would fail if provider clients buffered an oversized response before rejecting it."""

    class OversizedStream(httpx.AsyncByteStream):
        chunks_consumed = 0

        async def __aiter__(self):
            self.chunks_consumed += 1
            yield b"x" * 600
            self.chunks_consumed += 1
            yield b"x" * 600
            self.chunks_consumed += 1
            raise AssertionError("stream reader consumed a chunk after the cumulative limit")

    async def exercise():
        settings = settings_for(tmp_path)
        settings.catalog_retry_attempts = 1
        settings.catalog_max_provider_response_bytes = 1024
        stream = OversizedStream()
        transport = httpx.MockTransport(lambda _request: httpx.Response(200, stream=stream))
        async with httpx.AsyncClient(transport=transport) as http:
            with pytest.raises(RuntimeError, match="bounded retries"):
                if client_type is PokemonClient:
                    # Test the bounded JSON reader independently of archive fallback.
                    await client_type(settings, http_client=http)._request(
                        "https://api.pokemontcg.io/v2/cards", {}
                    )
                else:
                    await client_type(settings, http_client=http).fetch_cards()
        assert stream.chunks_consumed == 2

    asyncio.run(exercise())


def test_pokemon_normalization_drops_unapproved_image_hosts_and_missing_market():
    """Would fail if untrusted images or unavailable prices were stored."""
    record = json.loads(POKEMON_FIXTURE.read_text())["data"][1]
    card = normalize_pokemon_card(record)
    assert card.printing.image_uris == {}
    assert card.printing.prices == {}


def test_yugioh_normalization_expands_set_printings_with_full_set_code():
    """Would fail if a Yu-Gi-Oh! multi-set card collapsed to one printing."""
    cards = normalize_yugioh_card(json.loads(YUGIOH_FIXTURE.read_text())["data"][0], {})
    assert [(card.card_set.code, card.printing.collector_number) for card in cards] == [
        ("LOB", "LOB-001"),
        ("LOB", "LOB-EN001"),
    ]
    assert [card.printing.prices for card in cards] == [{"usd": "3.50"}, {"usd": "4.25"}]
    assert all(
        card.card_set.game == card.oracle.game == card.printing.game == "yugioh" for card in cards
    )
    assert cards[0].printing.image_uris == {
        "normal": "https://images.ygoprodeck.com/images/cards/89631139.jpg"
    }


def test_yugioh_normalization_keeps_rarity_variants_as_distinct_printings():
    record = json.loads(YUGIOH_FIXTURE.read_text())["data"][0]
    variant = dict(record["card_sets"][0])
    variant["set_rarity"] = "Secret Rare"
    record["card_sets"].append(variant)

    cards = normalize_yugioh_card(record, {})

    assert cards[0].printing.collector_number == cards[-1].printing.collector_number
    assert cards[0].printing.rarity != cards[-1].printing.rarity
    assert cards[0].printing.scryfall_id != cards[-1].printing.scryfall_id


def test_yugioh_client_omits_records_without_physical_set_printings(tmp_path):
    printable = {"id": "1", "name": "Printable", "card_sets": [{"set_code": "ABC-001"}]}
    payload = {
        "data": [
            {"id": "2", "name": "Digital only"},
            {"id": "3", "name": "No known printing", "card_sets": []},
            printable,
        ]
    }

    async def exercise():
        transport = httpx.MockTransport(lambda _request: httpx.Response(200, json=payload))
        async with httpx.AsyncClient(transport=transport) as http:
            return await YugiohClient(settings_for(tmp_path), http_client=http).fetch_cards()

    assert asyncio.run(exercise()) == [printable]


def test_yugioh_normalization_preserves_verbose_rarity_within_schema_limit():
    record = json.loads(YUGIOH_FIXTURE.read_text())["data"][0]
    record["card_sets"][0]["set_rarity"] = "Duel Terminal Normal Rare Parallel Rare"

    card = normalize_yugioh_card(record, {})[0]

    assert card.printing.rarity == "DT Normal Rare Parallel Rare"
    assert len(card.printing.rarity) <= 32


@pytest.mark.parametrize(
    "ids",
    [
        [None, None],
        [
            "20000000-0000-4000-8000-000000000004",
            "20000000-0000-4000-8000-000000000099",
        ],
    ],
)
def test_reversible_rejects_missing_or_conflicting_identity(ids):
    record = json.loads(FIXTURE.read_text().splitlines()[5])
    for face, value in zip(record["card_faces"], ids, strict=True):
        if value is None:
            face.pop("oracle_id")
        else:
            face["oracle_id"] = value
    with pytest.raises(ValueError, match="reversible.*oracle identity"):
        normalize_card(record)


def test_refresh_streams_counts_duplicates_malformed_and_batches(tmp_path):
    async def exercise():
        settings, engine, factory = await database(tmp_path)
        result = await CatalogImporter(settings, factory, source=Source()).refresh()
        assert result == ImportOutcome("complete", result.import_id, 4, 2, False)
        async with factory() as session:
            active = await session.scalar(select(CatalogImport).where(CatalogImport.active))
            assert (active.total_records, active.imported_records, active.rejected_records) == (
                6,
                4,
                2,
            )
            assert (active.set_count, active.oracle_count, active.printing_count) == (2, 4, 4)
            assert await session.scalar(select(func.count()).select_from(CardFace)) == 4
        await engine.dispose()

    asyncio.run(exercise())


def test_each_refresh_updates_prices_even_when_source_metadata_is_unchanged(tmp_path):
    async def exercise():
        settings, engine, factory = await database(tmp_path)
        fixture = tmp_path / "prices.jsonl"
        fixture.write_text(FIXTURE.read_text())
        source = Source(fixture)
        importer = CatalogImporter(settings, factory, source=source)
        first = await importer.refresh()

        rows = fixture.read_text().splitlines()
        repriced = json.loads(rows[0])
        repriced["prices"]["usd"] = "7.75"
        rows[0] = json.dumps(repriced)
        fixture.write_text("\n".join(rows) + "\n")

        second = await importer.refresh()

        assert first.status == "complete"
        assert second == ImportOutcome("complete", second.import_id, 4, 2, False)
        assert second.import_id != first.import_id
        assert source.download_calls == 2
        async with factory() as session:
            printing = await session.scalar(
                select(CardPrinting).where(
                    CardPrinting.scryfall_id == uuid.UUID("10000000-0000-4000-8000-000000000001")
                )
            )
            assert printing.prices["usd"] == "7.75"
            assert printing.last_seen_import_id == second.import_id
        await engine.dispose()

    asyncio.run(exercise())


def test_promotion_preserves_ids_and_deactivates_missing(tmp_path):
    async def exercise():
        settings, engine, factory = await database(tmp_path)
        await CatalogImporter(settings, factory, source=Source()).refresh()
        sid = uuid.UUID("10000000-0000-4000-8000-000000000001")
        async with factory() as session:
            old = await session.scalar(select(CardPrinting).where(CardPrinting.scryfall_id == sid))
            old_id = old.id
        changed = tmp_path / "changed"
        changed.write_text(FIXTURE.read_text().splitlines()[0] + "\n")
        await CatalogImporter(settings, factory, source=Source(changed, True)).refresh()
        async with factory() as session:
            current = await session.scalar(
                select(CardPrinting).where(CardPrinting.scryfall_id == sid)
            )
            missing = await session.scalar(
                select(CardPrinting).where(
                    CardPrinting.scryfall_id == uuid.UUID("10000000-0000-4000-8000-000000000002")
                )
            )
            assert current.id == old_id and current.active and not missing.active
            assert (
                await session.scalar(
                    select(func.count()).select_from(CatalogImport).where(CatalogImport.active)
                )
                == 1
            )
        await engine.dispose()

    asyncio.run(exercise())


def test_provider_refresh_activates_only_its_game_and_preserves_prior_catalogs(tmp_path):
    """Would fail if a Pokémon attempt deactivated Magic or its prior active catalog."""

    class PokemonSource:
        def __init__(self, rows):
            self.rows = rows

        async def fetch_cards(self):
            return self.rows

    async def exercise():
        settings, engine, factory = await database(tmp_path)
        pokemon = json.loads(POKEMON_FIXTURE.read_text())["data"][:1]
        mtg = await CatalogImporter(settings, factory, source=Source()).refresh()
        importer = CatalogImporter(
            settings, factory, source=Source(), providers={"pokemon": PokemonSource(pokemon)}
        )
        first_pokemon = await importer.refresh("pokemon")
        with pytest.raises(RuntimeError, match="previous catalog remains active"):
            await CatalogImporter(
                settings,
                factory,
                source=Source(),
                providers={"pokemon": PokemonSource([{**pokemon[0], "number": ""}])},
            ).refresh("pokemon")
        async with factory() as session:
            active = list(
                (
                    await session.scalars(
                        select(CatalogImport)
                        .where(CatalogImport.active)
                        .order_by(CatalogImport.game)
                    )
                ).all()
            )
            assert [(item.game, item.id) for item in active] == [
                ("mtg", mtg.import_id),
                ("pokemon", first_pokemon.import_id),
            ]
        await engine.dispose()

    asyncio.run(exercise())


def test_provider_refresh_records_a_failed_attempt_before_fetch(tmp_path):
    """Would fail if a fetch exception vanished without a sanitized provider attempt."""

    class FailingPokemonSource:
        async def fetch_cards(self):
            raise RuntimeError("token=not-for-status")

    async def exercise():
        settings, engine, factory = await database(tmp_path)
        with pytest.raises(RuntimeError, match="previous catalog remains active"):
            await CatalogImporter(
                settings,
                factory,
                providers={"pokemon": FailingPokemonSource()},
            ).refresh("pokemon")
        async with factory() as session:
            failed = await session.scalar(
                select(CatalogImport).where(
                    CatalogImport.game == "pokemon", CatalogImport.status == "failed"
                )
            )
            assert failed is not None
            assert failed.active is False
            assert "not-for-status" not in (failed.error_summary or "")
        await engine.dispose()

    asyncio.run(exercise())


def test_all_refresh_runs_each_game_under_one_refresh_lock(tmp_path):
    """Would fail if `all` omitted a free-provider catalog or reset another game's activation."""

    class Provider:
        def __init__(self, rows):
            self.rows = rows

        async def fetch_cards(self):
            return self.rows

    async def exercise():
        settings, engine, factory = await database(tmp_path)
        pokemon = json.loads(POKEMON_FIXTURE.read_text())["data"][:1]
        yugioh = json.loads(YUGIOH_FIXTURE.read_text())["data"][:1]
        result = await CatalogImporter(
            settings,
            factory,
            source=Source(),
            providers={
                "pokemon": Provider(pokemon),
                "yugioh": Provider(yugioh),
                "onepiece": Provider([{
                    "productId": 454512,
                    "name": "Roronoa Zoro (001)",
                    "setId": 3188,
                    "collectorNumber": "OP01-001",
                    "rarity": "Leader",
                    "foilings": ["Normal"],
                    "imageUrls": [],
                    "metadata": {},
                    "_set": {"setId": 3188, "name": "Romance Dawn", "abbreviation": "OP01"},
                }]),
                **{
                    game: Provider([{
                        "productId": index,
                        "name": f"{game} test card",
                        "setId": index,
                        "collectorNumber": "001",
                        "rarity": "Rare",
                        "foilings": ["Normal"],
                        "imageUrls": [],
                        "metadata": {},
                        "_set": {
                            "setId": index,
                            "name": f"{game} test set",
                            "abbreviation": f"T{index}",
                        },
                    }])
                    for index, game in enumerate(
                        ("digimon", "starwars", "unionarena", "lorcana", "riftbound"),
                        start=500,
                    )
                },
            },
        ).refresh("all")
        async with factory() as session:
            active_games = list(
                (
                    await session.scalars(
                        select(CatalogImport.game)
                        .where(CatalogImport.active)
                        .order_by(CatalogImport.game)
                    )
                ).all()
            )
        assert result.status == "complete"
        assert active_games == [
            "digimon",
            "lorcana",
            "mtg",
            "onepiece",
            "pokemon",
            "riftbound",
            "starwars",
            "unionarena",
            "yugioh",
        ]
        await engine.dispose()

    asyncio.run(exercise())


def test_game_thresholds_keep_magic_strict_and_free_provider_fixtures_activatable(tmp_path):
    """Would fail if non-Magic imports inherited Magic's production 100k/500 gates."""
    from app.catalog.importer import validation_thresholds

    test_settings = settings_for(tmp_path)
    settings = Settings(
        database_url=test_settings.database_url,
        bootstrap_secret_file=test_settings.bootstrap_secret_file,
        session_pepper_file=test_settings.session_pepper_file,
        mfa_encryption_key_file=test_settings.mfa_encryption_key_file,
    )
    assert validation_thresholds(settings, "mtg") == (100_000, 500)
    assert validation_thresholds(settings, "pokemon") == (1_000, 10)
    assert validation_thresholds(settings, "yugioh") == (1_000, 10)
    assert validation_thresholds(settings, "onepiece") == (1_000, 10)
    assert validation_thresholds(settings, "digimon") == (500, 5)
    assert validation_thresholds(settings, "starwars") == (500, 5)
    assert validation_thresholds(settings, "unionarena") == (500, 5)
    assert validation_thresholds(settings, "lorcana") == (500, 5)
    assert validation_thresholds(settings, "riftbound") == (500, 5)


def test_catalog_import_downgrade_drops_catalog_import_game_column_in_alembic_order():
    """Would fail if PostgreSQL downgrade passed Alembic's drop-column arguments backwards."""
    migration = (
        Path(__file__).parents[1] / "migrations" / "versions" / "0010_multi_game_catalog.py"
    ).read_text()
    assert 'op.drop_column("catalog_imports", "game")' in migration


def test_failure_preserves_active_and_sanitizes(tmp_path):
    async def exercise():
        settings, engine, factory = await database(tmp_path)
        first = await CatalogImporter(settings, factory, source=Source()).refresh()
        with pytest.raises(RuntimeError, match="catalog refresh failed"):
            await CatalogImporter(
                settings, factory, source=Source(changed=True, fail=True)
            ).refresh()
        async with factory() as session:
            active = await session.scalar(select(CatalogImport).where(CatalogImport.active))
            failed = await session.scalar(
                select(CatalogImport).where(CatalogImport.status == "failed")
            )
            assert active.id == first.import_id
            assert (
                "very-secret-value" not in failed.error_summary and len(failed.error_summary) <= 512
            )
        await engine.dispose()

    asyncio.run(exercise())


def test_validation_failure_rolls_back_promotion(tmp_path):
    async def exercise():
        settings, engine, factory = await database(tmp_path)
        first = await CatalogImporter(settings, factory, source=Source()).refresh()
        settings.catalog_min_printings = 99
        changed = tmp_path / "changed-invalid"
        changed.write_text(FIXTURE.read_text().splitlines()[0] + "\n")
        with pytest.raises(RuntimeError, match="catalog refresh failed"):
            await CatalogImporter(settings, factory, source=Source(changed, True)).refresh()
        async with factory() as session:
            active = await session.scalar(select(CatalogImport).where(CatalogImport.active))
            missing = await session.scalar(
                select(CardPrinting).where(
                    CardPrinting.scryfall_id == uuid.UUID("10000000-0000-4000-8000-000000000002")
                )
            )
            assert active.id == first.import_id
            assert missing is not None and missing.active
        await engine.dispose()

    asyncio.run(exercise())


def test_status_reports_active_catalog_without_secrets(tmp_path):
    async def exercise():
        settings, engine, factory = await database(tmp_path)
        result = await CatalogImporter(settings, factory, source=Source()).refresh()
        status = await read_catalog_status(factory)
        assert status["active_catalog"]["import_id"] == str(result.import_id)
        assert status["active_catalog"]["status"] == "complete"
        assert status["active_catalog"]["printing_count"] == 4
        assert "source_uri" not in status["active_catalog"]
        await engine.dispose()

    asyncio.run(exercise())


def test_download_retries_and_enforces_stream_size_limit(tmp_path):
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        return httpx.Response(503) if calls == 1 else httpx.Response(200, content=b"x" * 2048)

    async def exercise():
        settings = settings_for(tmp_path)
        settings.catalog_max_download_bytes = 1024
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            client = ScryfallClient(settings, http_client=http)
            with pytest.raises(RuntimeError, match="bounded retries"):
                await client.download_bulk(metadata(), tmp_path / "download.gz")
        assert not (tmp_path / "download.gz").exists()

    asyncio.run(exercise())
    assert calls == 2


def test_corrupt_feed_is_rejected_and_attempt_counters_survive_rollback(tmp_path):
    async def exercise():
        settings, engine, factory = await database(tmp_path)
        first = await CatalogImporter(settings, factory, source=Source()).refresh()
        settings.catalog_max_rejected_records = 1
        with pytest.raises(RuntimeError, match="catalog refresh failed"):
            await CatalogImporter(settings, factory, source=Source(changed=True)).refresh()
        status = await read_catalog_status(factory)
        assert status["active_catalog"]["import_id"] == str(first.import_id)
        assert status["active_catalog"]["printing_count"] == 4
        assert status["latest_attempt"]["status"] == "failed"
        assert status["latest_attempt"]["total_records"] == 6
        assert status["latest_attempt"]["imported_records"] == 4
        assert status["latest_attempt"]["rejected_records"] == 2
        await engine.dispose()

    asyncio.run(exercise())


def test_cli_refresh_failure_is_sanitized_and_returns_nonzero(tmp_path, capsys):
    class FailingImporter:
        def __init__(self, settings, factory):
            pass

        async def refresh(self, game):
            assert game == "all"
            raise RuntimeError("upstream token=very-secret-value")

    async def exercise():
        settings, engine, factory = await database(tmp_path)
        try:
            return await run(
                "refresh",
                settings=settings,
                session_factory=factory,
                importer_factory=FailingImporter,
            )
        finally:
            await engine.dispose()

    assert asyncio.run(exercise()) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "Catalog refresh failed" in captured.err
    assert "very-secret-value" not in captured.err
    assert "Traceback" not in captured.err


def test_cli_refresh_defaults_to_all_supported_games(tmp_path):
    requested = []

    class CompleteImporter:
        def __init__(self, settings, factory):
            pass

        async def refresh(self, game=None):
            requested.append(game)
            return ImportOutcome("complete", uuid.uuid4(), 4, 0, False)

    async def exercise():
        settings, engine, factory = await database(tmp_path)
        try:
            return await run(
                "refresh",
                settings=settings,
                session_factory=factory,
                importer_factory=CompleteImporter,
            )
        finally:
            await engine.dispose()

    assert asyncio.run(exercise()) == 0
    assert requested == ["all"]


def test_cli_refresh_requests_price_snapshots_only_after_a_completed_refresh(tmp_path, monkeypatch):
    class CompleteImporter:
        def __init__(self, settings, factory):
            pass

        async def refresh(self, game):
            assert game == "all"
            return ImportOutcome("complete", uuid.uuid4(), 4, 0, False)

    captured = []

    async def capture(session_factory):
        captured.append(session_factory)

    monkeypatch.setattr(catalog_cli, "capture_collection_price_snapshots", capture)

    async def exercise():
        settings, engine, factory = await database(tmp_path)
        try:
            result = await run(
                "refresh",
                settings=settings,
                session_factory=factory,
                importer_factory=CompleteImporter,
            )
            return result, factory
        finally:
            await engine.dispose()

    result, factory = asyncio.run(exercise())
    assert result == 0
    assert captured == [factory]


def test_cli_refresh_keeps_a_completed_catalog_result_when_snapshot_capture_fails(
    tmp_path,
    monkeypatch,
):
    class CompleteImporter:
        def __init__(self, settings, factory):
            pass

        async def refresh(self, game):
            assert game == "all"
            return ImportOutcome("complete", uuid.uuid4(), 4, 0, False)

    async def fail_capture(_session_factory):
        raise RuntimeError("snapshot storage unavailable")

    monkeypatch.setattr(catalog_cli, "capture_collection_price_snapshots", fail_capture)

    async def exercise():
        settings, engine, factory = await database(tmp_path)
        try:
            return await run(
                "refresh",
                settings=settings,
                session_factory=factory,
                importer_factory=CompleteImporter,
            )
        finally:
            await engine.dispose()

    assert asyncio.run(exercise()) == 0


def test_download_has_hard_deadline_for_trickling_stream(tmp_path):
    class TrickleStream(httpx.AsyncByteStream):
        async def __aiter__(self):
            for _ in range(10):
                await asyncio.sleep(0.02)
                yield b"x"

    async def exercise():
        settings = settings_for(tmp_path)
        settings.catalog_retry_attempts = 1
        settings.catalog_download_deadline_seconds = 0.05
        transport = httpx.MockTransport(lambda request: httpx.Response(200, stream=TrickleStream()))
        async with httpx.AsyncClient(transport=transport) as http:
            with pytest.raises(RuntimeError, match="deadline"):
                await ScryfallClient(settings, http_client=http).download_bulk(
                    metadata(), tmp_path / "trickle.gz"
                )
        assert not (tmp_path / "trickle.gz").exists()

    asyncio.run(exercise())


def test_reversible_uses_matching_face_as_canonical():
    record = json.loads(FIXTURE.read_text().splitlines()[5])
    record["card_faces"][0]["oracle_text"] = "Canonical face text"
    normalized = normalize_card(record)
    assert normalized.oracle.name == "Winter Path"
    assert normalized.oracle.oracle_text == "Canonical face text"


def test_lock_busy_returns_busy_without_attempt(tmp_path):
    class BusyLock:
        async def __aenter__(self):
            return False

        async def __aexit__(self, *args):
            return None

    async def exercise():
        settings, engine, factory = await database(tmp_path)
        result = await CatalogImporter(
            settings, factory, source=Source(), lock_factory=lambda: BusyLock()
        ).refresh()
        assert result.status == "busy"
        async with factory() as session:
            assert await session.scalar(select(func.count()).select_from(CatalogImport)) == 0
        await engine.dispose()

    asyncio.run(exercise())


def test_face_deletes_are_bounded_by_batches(tmp_path):
    from sqlalchemy import event

    async def exercise():
        settings, engine, factory = await database(tmp_path)
        deletes = 0

        def count_delete(_conn, _cursor, statement, _parameters, _context, _many):
            nonlocal deletes
            if statement.lstrip().upper().startswith("DELETE FROM CARD_FACES"):
                deletes += 1

        event.listen(engine.sync_engine, "before_cursor_execute", count_delete)
        await CatalogImporter(settings, factory, source=Source()).refresh()
        assert deletes <= 2
        await engine.dispose()

    asyncio.run(exercise())


def test_scryfall_sets_endpoint_and_metadata(tmp_path):
    from app.catalog.scryfall import SETS_URL

    requests = []
    payload = {
        "object": "list",
        "has_more": False,
        "data": [
            {
                "object": "set",
                "id": "30000000-0000-4000-8000-000000000001",
                "code": "tst",
                "name": "Wynter Test",
                "set_type": "expansion",
                "card_count": 271,
                "digital": False,
                "released_at": "2026-08-01",
                "icon_svg_uri": "https://svgs.scryfall.io/sets/tst.svg",
                "scryfall_uri": "https://scryfall.com/sets/tst",
            }
        ],
    }

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json=payload)

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            sets = await ScryfallClient(settings_for(tmp_path), http_client=http).fetch_sets()
        item = sets[uuid.UUID("30000000-0000-4000-8000-000000000001")]
        assert item.card_count == 271
        assert item.icon_svg_uri.endswith("tst.svg")

    asyncio.run(exercise())
    assert requests[0].url == httpx.URL(SETS_URL)


def test_ordinary_oracle_wins_regardless_of_reversible_input_order(tmp_path):
    async def exercise(reverse_order):
        case = tmp_path / ("reverse" if reverse_order else "forward")
        case.mkdir()
        settings, engine, factory = await database(case)
        ordinary = json.loads(FIXTURE.read_text().splitlines()[0])
        reversible = json.loads(FIXTURE.read_text().splitlines()[5])
        reversible["oracle_id"] = ordinary["oracle_id"]
        for face in reversible["card_faces"]:
            face["oracle_id"] = ordinary["oracle_id"]
        cards = [reversible, ordinary] if reverse_order else [ordinary, reversible]
        fixture = case / "order.jsonl"
        fixture.write_text("\n".join(json.dumps(card) for card in cards) + "\n")
        await CatalogImporter(settings, factory, source=Source(fixture)).refresh()
        async with factory() as session:
            oracle = await session.scalar(
                select(OracleCard).where(OracleCard.scryfall_id == uuid.UUID(ordinary["oracle_id"]))
            )
            assert oracle.name == "Winter Bloom"
            assert oracle.oracle_text == "Reach"
        await engine.dispose()

    asyncio.run(exercise(False))
    asyncio.run(exercise(True))


def test_successful_streamed_download_writes_exact_bytes(tmp_path):
    payload = b"compressed-test-payload"
    transport = httpx.MockTransport(lambda request: httpx.Response(200, content=payload))

    async def exercise():
        settings = settings_for(tmp_path)
        destination = tmp_path / "bulk.gz"
        async with httpx.AsyncClient(transport=transport) as http:
            await ScryfallClient(settings, http_client=http).download_bulk(metadata(), destination)
        assert destination.read_bytes() == payload

    asyncio.run(exercise())


def test_deadline_failure_marks_attempt_cleans_temp_and_releases_lock(tmp_path, monkeypatch):
    import tempfile as stdlib_tempfile

    from app.catalog import importer as importer_module

    created_paths = []
    original = stdlib_tempfile.NamedTemporaryFile

    def tracked_temporary(*args, **kwargs):
        kwargs["dir"] = tmp_path
        handle = original(*args, **kwargs)
        created_paths.append(Path(handle.name))
        return handle

    class TrackingLock:
        entered = 0
        exited = 0

        async def __aenter__(self):
            type(self).entered += 1
            return True

        async def __aexit__(self, *args):
            type(self).exited += 1

    class DeadlineSource(Source):
        async def download_bulk(self, _metadata, destination):
            await asyncio.sleep(0.05)
            raise RuntimeError("Scryfall download exceeded its hard deadline")

    async def exercise():
        settings, engine, factory = await database(tmp_path / "db-case")
        first = await CatalogImporter(
            settings, factory, source=Source(), lock_factory=TrackingLock
        ).refresh()
        settings.catalog_download_deadline_seconds = 0.01
        with pytest.raises(RuntimeError, match="catalog refresh failed"):
            await CatalogImporter(
                settings,
                factory,
                source=DeadlineSource(changed=True),
                lock_factory=TrackingLock,
            ).refresh()
        status = await read_catalog_status(factory)
        assert status["active_catalog"]["import_id"] == str(first.import_id)
        assert status["latest_attempt"]["status"] == "failed"
        assert all(not path.exists() for path in created_paths)
        settings.catalog_download_deadline_seconds = 1
        subsequent = await CatalogImporter(
            settings, factory, source=Source(changed=True), lock_factory=TrackingLock
        ).refresh()
        assert subsequent.status == "complete"
        assert TrackingLock.entered == TrackingLock.exited == 3
        await engine.dispose()

    (tmp_path / "db-case").mkdir()
    monkeypatch.setattr(importer_module.tempfile, "NamedTemporaryFile", tracked_temporary)
    asyncio.run(exercise())


def test_multiface_normalization_aggregates_search_and_color_fields():
    record = {
        "id": "10000000-0000-4000-8000-000000000099",
        "oracle_id": "20000000-0000-4000-8000-000000000099",
        "name": "Scholar // Skywing",
        "lang": "en",
        "layout": "transform",
        "cmc": 2,
        "color_identity": ["U"],
        "keywords": ["Flying"],
        "legalities": {"modern": "legal"},
        "set_id": "30000000-0000-4000-8000-000000000001",
        "set": "tst",
        "set_name": "Wynter Test",
        "set_type": "expansion",
        "released_at": "2026-08-01",
        "collector_number": "99",
        "rarity": "uncommon",
        "digital": False,
        "promo": False,
        "finishes": ["nonfoil"],
        "games": ["paper"],
        "prices": {},
        "card_faces": [
            {
                "name": "Scholar",
                "mana_cost": "{1}{U}",
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
    normalized = normalize_card(record)
    assert normalized.oracle.name == "Scholar // Skywing"
    assert normalized.oracle.type_line == "Creature - Human Wizard // Creature - Bird"
    assert normalized.oracle.oracle_text == "Draw a card.\n//\nFlying"
    assert normalized.oracle.colors == ["U"]
    assert normalized.printing.colors == ["U"]


def test_image_urls_are_allowlisted_and_known_keys_only():
    record = json.loads(FIXTURE.read_text().splitlines()[0])
    record["image_uris"] = {
        "normal": "https://cards.scryfall.io/normal/front.jpg",
        "large": "https://user:member-742955f5f2c4@example.invalid/large/leak.jpg",
        "small": "https://192.0.2.102/internal.jpg",
        "png": "javascript:alert(1)",
        "art_crop": "https://cards.scryfall.io:444/art.jpg",
        "border_crop": "https://evil.example/border.jpg",
        "unknown": "https://cards.scryfall.io/unknown.jpg",
    }
    record["card_faces"] = [
        {
            "name": "Safe Face",
            "image_uris": {
                "normal": "https://cards.scryfall.io/normal/face.jpg",
                "large": "http://cards.scryfall.io/large/face.jpg",
            },
        }
    ]
    record["set_icon_svg_uri"] = "https://192.0.2.68/internal-set.svg"
    normalized = normalize_card(record)
    assert normalized.printing.image_uris == {
        "normal": "https://cards.scryfall.io/normal/front.jpg"
    }
    assert normalized.faces[0].image_uris == {"normal": "https://cards.scryfall.io/normal/face.jpg"}
    assert normalized.card_set.icon_svg_uri is None
    record["set_icon_svg_uri"] = "https://svgs.scryfall.io/sets/safe.svg"
    normalized = normalize_card(record)
    assert normalized.card_set.icon_svg_uri == "https://svgs.scryfall.io/sets/safe.svg"


def test_set_icon_urls_allow_only_scryfall_svg_cdn(tmp_path):
    async def exercise(icon_uri):
        payload = {
            "object": "list",
            "has_more": False,
            "data": [
                {
                    "object": "set",
                    "id": "30000000-0000-4000-8000-000000000099",
                    "code": "safe",
                    "name": "Safe Set",
                    "set_type": "expansion",
                    "released_at": "2026-08-01",
                    "card_count": 1,
                    "digital": False,
                    "icon_svg_uri": icon_uri,
                    "scryfall_uri": "https://scryfall.com/sets/safe",
                }
            ],
        }
        transport = httpx.MockTransport(lambda request: httpx.Response(200, json=payload))
        async with httpx.AsyncClient(transport=transport) as http:
            rows = await ScryfallClient(settings_for(tmp_path), http_client=http).fetch_sets()
            return next(iter(rows.values())).icon_svg_uri

    assert (
        asyncio.run(exercise("https://svgs.scryfall.io/sets/safe.svg"))
        == "https://svgs.scryfall.io/sets/safe.svg"
    )
    for unsafe in (
        "http://svgs.scryfall.io/sets/safe.svg",
        "https://user:member-03e4ee7653d6@example.invalid/sets/safe.svg",
        "https://svgs.scryfall.io:444/sets/safe.svg",
        "https://192.0.2.179/set.svg",
        "javascript:alert(1)",
    ):
        assert asyncio.run(exercise(unsafe)) is None
