"""One Piece Card Game adapter for the free tcgjson bulk catalog."""

import asyncio
import gzip
import io
import json
import re
import uuid
from datetime import UTC, date, datetime
from typing import Any

import httpx

from app.catalog.importer import NormalizedCard, NormalizedOracle, NormalizedPrinting, NormalizedSet
from app.catalog.providers import approved_https_url
from app.config import Settings

ONE_PIECE_CATALOG_URL = (
    "https://github.com/HanClinto/tcgjson/releases/latest/download/one-piece.full.json.gz"
)
ONE_PIECE_IMAGE_HOST = "tcgplayer-cdn.tcgplayer.com"
ONE_PIECE_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "wynterlabs:catalog:onepiece")


def _identity(kind: str, value: object) -> uuid.UUID:
    return uuid.uuid5(ONE_PIECE_NAMESPACE, f"{kind}:{value}")


def _timestamp(value: object) -> datetime:
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
        except ValueError:
            pass
    return datetime.now(UTC)


def _date(value: object) -> date | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def _strings(value: object) -> list[str]:
    return [str(item).strip() for item in value if str(item).strip()] if isinstance(value, list) else []


def _finishes(value: object) -> list[str]:
    names = [item.lower() for item in _strings(value)]
    finishes: list[str] = []
    if any("normal" in item or "nonfoil" in item for item in names):
        finishes.append("nonfoil")
    if any("foil" in item and "nonfoil" not in item for item in names):
        finishes.append("foil")
    return finishes or ["nonfoil"]


def normalize_one_piece_card(record: dict[str, Any]) -> NormalizedCard:
    if not isinstance(record, dict):
        raise ValueError("One Piece card record must be an object")
    product_id = str(record.get("productId") or "").strip()
    name = str(record.get("name") or "").strip()
    printed_number = str(record.get("collectorNumber") or "").strip()
    collector_number = printed_number or (f"TCG-{product_id}" if product_id else "")
    card_set = record.get("_set")
    if not product_id or not name or not collector_number or not isinstance(card_set, dict):
        raise ValueError("One Piece card is missing required identity fields")
    set_id = str(card_set.get("setId") or "").strip()
    set_name = str(card_set.get("name") or "").strip()
    if not set_id or not set_name:
        raise ValueError("One Piece card is missing set identity")
    set_code = (str(card_set.get("abbreviation") or "").strip() or f"SET-{set_id}")[:16]
    metadata = record.get("metadata") if isinstance(record.get("metadata"), dict) else {}
    custom = metadata.get("customAttributes") if isinstance(metadata.get("customAttributes"), dict) else {}
    colors = _strings(metadata.get("colors") or custom.get("color"))
    card_types = _strings(metadata.get("cardTypes") or custom.get("cardType"))
    subtypes = _strings(custom.get("subtypes"))
    image = next(
        (
            approved
            for item in _strings(record.get("imageUrls"))
            if (approved := approved_https_url(item, ONE_PIECE_IMAGE_HOST)) is not None
        ),
        None,
    )
    released_at = _date(card_set.get("releaseDate") or custom.get("releaseDate"))
    updated_at = _timestamp(record.get("_catalog_generated_at"))
    canonical_name = re.sub(r"\s+\(\d{3}\)$", "", name).strip() or name
    cost = str(custom.get("cost") or "").strip()
    return NormalizedCard(
        card_set=NormalizedSet(
            "onepiece", _identity("set", set_id), set_code, set_name, "expansion",
            released_at, int(card_set.get("productCount") or 0), False, None,
            updated_at, None,
        ),
        oracle=NormalizedOracle(
            "onepiece", _identity("oracle", product_id), canonical_name, "onepiece", None,
            float(cost) if cost.replace(".", "", 1).isdigit() else 0,
            " / ".join(card_types) or None,
            str(metadata.get("rulesText") or custom.get("description") or "") or None,
            colors, colors, subtypes, {},
        ),
        printing=NormalizedPrinting(
            "onepiece", _identity("printing", product_id), "en", collector_number,
            str(record.get("rarity") or "unknown")[:32], released_at, None, None, False,
            "promo" in set_name.lower(), "onepiece", None, None, None,
            f"https://www.tcgplayer.com/product/{product_id}",
            {"normal": image} if image else {}, {}, _finishes(record.get("foilings")),
            ["onepiece"], colors, colors, {},
        ),
        faces=[],
    )


class OnePieceClient:
    game = "onepiece"

    def __init__(self, settings: Settings, *, http_client: httpx.AsyncClient | None = None):
        self.settings, self._client = settings, http_client

    async def fetch_cards(self) -> list[dict[str, Any]]:
        client = self._client or httpx.AsyncClient(
            timeout=httpx.Timeout(max(self.settings.catalog_http_timeout_seconds, 60)),
            follow_redirects=True,
        )
        try:
            for attempt in range(self.settings.catalog_retry_attempts):
                try:
                    async with client.stream(
                        "GET", ONE_PIECE_CATALOG_URL,
                        headers={"Accept": "application/gzip, application/octet-stream", "User-Agent": "WynterLabs-Cards/0.3"},
                    ) as response:
                        response.raise_for_status()
                        maximum = self.settings.catalog_max_provider_response_bytes
                        compressed = bytearray()
                        async for chunk in response.aiter_bytes():
                            if len(chunk) > maximum - len(compressed):
                                raise ValueError("One Piece catalog exceeded configured size limit")
                            compressed.extend(chunk)
                    with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as archive:
                        decoded = archive.read(self.settings.catalog_max_download_bytes + 1)
                    if len(decoded) > self.settings.catalog_max_download_bytes:
                        raise ValueError("One Piece catalog expanded beyond configured size limit")
                    payload = json.loads(decoded)
                    if not isinstance(payload, dict):
                        raise ValueError("One Piece catalog was not an object")
                    sets = payload.get("sets")
                    products = payload.get("products")
                    meta = payload.get("meta")
                    if not isinstance(sets, list) or not isinstance(products, list) or not isinstance(meta, dict):
                        raise ValueError("One Piece catalog had an invalid shape")
                    if len(products) > self.settings.catalog_provider_max_records:
                        raise ValueError("One Piece catalog exceeded configured record limit")
                    sets_by_id = {
                        str(item.get("setId")): item
                        for item in sets if isinstance(item, dict) and item.get("setId") is not None
                    }
                    generated_at = meta.get("generatedAt")
                    rows = []
                    for product in products:
                        if not isinstance(product, dict):
                            raise ValueError("One Piece catalog contained invalid card data")
                        card_set = sets_by_id.get(str(product.get("setId")))
                        if card_set is not None:
                            rows.append({**product, "_set": card_set, "_catalog_generated_at": generated_at})
                    return rows
                except (httpx.HTTPError, OSError, ValueError, json.JSONDecodeError, gzip.BadGzipFile):
                    if attempt + 1 == self.settings.catalog_retry_attempts:
                        raise RuntimeError("One Piece provider request failed after bounded retries") from None
                    await asyncio.sleep(min(2**attempt, 4))
        finally:
            if self._client is None:
                await client.aclose()
        raise RuntimeError("One Piece provider request failed")
