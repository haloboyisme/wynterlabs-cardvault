"""Pokémon TCG API v2 adapter."""

import asyncio
import io
import json
import uuid
import zipfile
from datetime import UTC, datetime
from pathlib import PurePosixPath
from typing import Any

import httpx

from app.catalog.importer import (
    NormalizedCard,
    NormalizedOracle,
    NormalizedPrinting,
    NormalizedSet,
)
from app.catalog.providers import approved_https_url, bounded_pages, stream_json_response
from app.config import Settings

POKEMON_CARDS_URL = "https://api.pokemontcg.io/v2/cards"
POKEMON_ARCHIVE_URL = (
    "https://codeload.github.com/PokemonTCG/pokemon-tcg-data/zip/refs/heads/master"
)
POKEMON_IMAGE_HOSTS = ("images.pokemontcg.io",)
POKEMON_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "wynterlabs:catalog:pokemon")


def _cards_from_archive(payload: bytes, *, max_records: int, max_uncompressed: int):
    records: list[dict[str, Any]] = []
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        members = archive.infolist()
        if sum(member.file_size for member in members) > max_uncompressed:
            raise ValueError("Pokémon archive exceeded configured size limit")
        for member in members:
            path = PurePosixPath(member.filename)
            if path.is_absolute() or ".." in path.parts or member.is_dir():
                continue
            if member.filename.endswith("/sets/en.json"):
                sets = json.loads(archive.read(member))
                break
        else:
            raise ValueError("Pokémon archive did not contain English set data")
        if not isinstance(sets, list):
            raise ValueError("Pokémon archive set data was invalid")
        sets_by_id = {
            str(item.get("id")): item for item in sets if isinstance(item, dict) and item.get("id")
        }
        for member in members:
            name = member.filename
            if "/cards/en/" not in name or not name.endswith(".json") or member.is_dir():
                continue
            cards = json.loads(archive.read(member))
            if not isinstance(cards, list):
                raise ValueError("Pokémon archive card data was invalid")
            for card in cards:
                if not isinstance(card, dict):
                    raise ValueError("Pokémon archive contained an invalid card")
                set_id = str(card.get("id") or "").split("-", 1)[0]
                set_data = sets_by_id.get(set_id)
                if not set_data:
                    raise ValueError("Pokémon archive card set was missing")
                records.append({**card, "set": set_data})
                if len(records) > max_records:
                    raise ValueError("Pokémon archive exceeded configured record limit")
    return records


def _identity(kind: str, value: object) -> uuid.UUID:
    return uuid.uuid5(POKEMON_NAMESPACE, f"{kind}:{value}")


def _released(value: object):
    if not isinstance(value, str):
        return None
    try:
        return datetime.strptime(value, "%Y/%m/%d").date()
    except ValueError:
        return None


def _updated(value: object) -> datetime:
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
        except ValueError:
            try:
                return datetime.strptime(value, "%Y/%m/%d %H:%M:%S").replace(tzinfo=UTC)
            except ValueError:
                pass
    return datetime.now(UTC)


def _legalities(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {
        str(key).strip().lower(): str(item).strip().lower()
        for key, item in value.items()
        if str(key).strip() and str(item).strip()
    }


def _prices_and_finishes(record: dict[str, Any]) -> tuple[dict[str, str | None], list[str]]:
    prices = (record.get("tcgplayer") or {}).get("prices") or {}
    if not isinstance(prices, dict):
        return {}, ["nonfoil"]
    result: dict[str, str | None] = {}
    finishes: list[str] = []
    normal = prices.get("normal")
    if isinstance(normal, dict):
        finishes.append("nonfoil")
    normal_market = normal.get("market") if isinstance(normal, dict) else None
    if isinstance(normal_market, int | float | str) and str(normal_market).strip():
        result["usd"] = str(normal_market)
    for key in ("holofoil", "reverseHolofoil"):
        value = prices.get(key)
        if isinstance(value, dict) and "foil" not in finishes:
            finishes.append("foil")
        market = value.get("market") if isinstance(value, dict) else None
        if isinstance(market, int | float | str) and str(market).strip():
            result["usd_foil"] = str(market)
            break
    return result, finishes or ["nonfoil"]


def normalize_pokemon_card(record: dict[str, Any]) -> NormalizedCard:
    if not isinstance(record, dict):
        raise ValueError("Pokémon card record must be an object")
    provider_id = str(record.get("id") or "").strip()
    name = str(record.get("name") or "").strip()
    number = str(record.get("number") or "").strip()
    set_data = record.get("set")
    if not provider_id or not name or not number or not isinstance(set_data, dict):
        raise ValueError("Pokémon card is missing required identity fields")
    set_id = str(set_data.get("id") or "").strip()
    set_name = str(set_data.get("name") or "").strip()
    if not set_id or not set_name:
        raise ValueError("Pokémon card is missing set identity")
    images = record.get("images") if isinstance(record.get("images"), dict) else {}
    image_uris = {
        key: approved
        for key, field in (("small", "small"), ("large", "large"))
        if (approved := approved_https_url(images.get(field), *POKEMON_IMAGE_HOSTS)) is not None
    }
    raw_types = record.get("types") if isinstance(record.get("types"), list) else []
    rules = record.get("rules") if isinstance(record.get("rules"), list) else []
    rarity = str(record.get("rarity") or "unknown")
    prices, finishes = _prices_and_finishes(record)
    # The provider's optional PTCGO code is not unique across all published sets.
    # Its stable set ID is unique and therefore safe for catalog lookup and scanning.
    set_code = set_id
    set_legalities = _legalities(set_data.get("legalities"))
    card_legalities = _legalities(record.get("legalities"))
    legalities = {**set_legalities, **card_legalities}
    source_updated_at = _updated(set_data.get("updatedAt") or record.get("updatedAt"))
    return NormalizedCard(
        card_set=NormalizedSet(
            "pokemon",
            _identity("set", set_id),
            set_code,
            set_name,
            "expansion",
            _released(set_data.get("releaseDate")),
            int(set_data.get("total") or 0),
            False,
            None,
            source_updated_at,
            None,
        ),
        oracle=NormalizedOracle(
            "pokemon",
            _identity("oracle", provider_id),
            name,
            "pokemon",
            None,
            0,
            str(record.get("supertype") or "") or None,
            "\n".join(str(rule) for rule in rules) or None,
            [str(item) for item in raw_types],
            [],
            [str(item) for item in record.get("subtypes", []) if isinstance(item, str)],
            legalities,
        ),
        printing=NormalizedPrinting(
            "pokemon",
            _identity("printing", provider_id),
            "en",
            number,
            rarity,
            _released(set_data.get("releaseDate")),
            record.get("artist") if isinstance(record.get("artist"), str) else None,
            None,
            False,
            False,
            "pokemon",
            None,
            None,
            None,
            None,
            image_uris,
            prices,
            finishes,
            ["pokemon"],
            [str(item) for item in raw_types],
            [],
            legalities,
        ),
        faces=[],
    )


class PokemonClient:
    game = "pokemon"

    def __init__(self, settings: Settings, *, http_client: httpx.AsyncClient | None = None):
        self.settings, self._client = settings, http_client

    async def _request(self, url: str, params: dict[str, Any]) -> dict[str, Any]:
        client = self._client or httpx.AsyncClient(
            timeout=httpx.Timeout(self.settings.catalog_http_timeout_seconds),
            follow_redirects=False,
        )
        try:
            for attempt in range(self.settings.catalog_retry_attempts):
                try:
                    return await stream_json_response(
                        client,
                        url,
                        params=params,
                        headers={
                            "Accept": "application/json",
                            "User-Agent": "WynterLabs-Cards/0.3",
                        },
                        max_bytes=self.settings.catalog_max_provider_response_bytes,
                    )
                except (httpx.HTTPError, OSError, ValueError):
                    if attempt + 1 == self.settings.catalog_retry_attempts:
                        raise RuntimeError(
                            "Pokémon provider request failed after bounded retries"
                        ) from None
                    await asyncio.sleep(min(2**attempt, 4))
        finally:
            if self._client is None:
                await client.aclose()
        raise RuntimeError("Pokémon provider request failed")

    async def fetch_cards(self) -> list[dict[str, Any]]:
        try:
            return await bounded_pages(
                self._request,
                POKEMON_CARDS_URL,
                page_size=250,
                max_pages=self.settings.catalog_provider_max_pages,
                max_records=self.settings.catalog_provider_max_records,
            )
        except RuntimeError:
            return await self._fetch_archive()

    async def _fetch_archive(self) -> list[dict[str, Any]]:
        client = self._client or httpx.AsyncClient(
            timeout=httpx.Timeout(max(self.settings.catalog_http_timeout_seconds, 120)),
            follow_redirects=False,
        )
        try:
            async with client.stream(
                "GET",
                POKEMON_ARCHIVE_URL,
                headers={"Accept": "application/zip", "User-Agent": "WynterLabs-Cards/0.3"},
            ) as response:
                response.raise_for_status()
                content_type = response.headers.get("content-type", "").lower()
                if "zip" not in content_type and "octet-stream" not in content_type:
                    raise ValueError("Pokémon archive response was not a ZIP file")
                maximum = self.settings.catalog_max_provider_response_bytes
                content = bytearray()
                async for chunk in response.aiter_bytes():
                    if len(chunk) > maximum - len(content):
                        raise ValueError("Pokémon archive exceeded configured size limit")
                    content.extend(chunk)
            return _cards_from_archive(
                bytes(content),
                max_records=self.settings.catalog_provider_max_records,
                max_uncompressed=maximum * 4,
            )
        finally:
            if self._client is None:
                await client.aclose()
