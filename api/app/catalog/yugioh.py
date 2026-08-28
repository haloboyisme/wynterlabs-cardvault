"""YGOPRODeck API v7 adapter."""

import asyncio
import uuid
from datetime import UTC, datetime
from typing import Any

import httpx

from app.catalog.importer import (
    NormalizedCard,
    NormalizedOracle,
    NormalizedPrinting,
    NormalizedSet,
)
from app.catalog.providers import approved_https_url, stream_json_response
from app.config import Settings

YUGIOH_CARDS_URL = "https://db.ygoprodeck.com/api/v7/cardinfo.php"
YUGIOH_IMAGE_HOST = "images.ygoprodeck.com"
YUGIOH_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "wynterlabs:catalog:yugioh")


def _identity(kind: str, value: object) -> uuid.UUID:
    return uuid.uuid5(YUGIOH_NAMESPACE, f"{kind}:{value}")


def _rarity(value: object) -> str:
    rarity = str(value or "unknown").strip() or "unknown"
    if len(rarity) > 32 and rarity.startswith("Duel Terminal "):
        rarity = f"DT {rarity.removeprefix('Duel Terminal ')}"
    return rarity[:32]


def normalize_yugioh_card(
    record: dict[str, Any], sets: dict[str, Any] | None = None
) -> list[NormalizedCard]:
    if not isinstance(record, dict):
        raise ValueError("Yu-Gi-Oh! card record must be an object")
    provider_id = str(record.get("id") or "").strip()
    name = str(record.get("name") or "").strip()
    printings = record.get("card_sets")
    if not provider_id or not name or not isinstance(printings, list):
        raise ValueError("Yu-Gi-Oh! card is missing required identity fields")
    images = record.get("card_images") if isinstance(record.get("card_images"), list) else []
    first_image = next((row.get("image_url") for row in images if isinstance(row, dict)), None)
    image = approved_https_url(first_image, YUGIOH_IMAGE_HOST)
    now = datetime.now(UTC)
    result: list[NormalizedCard] = []
    for item in printings:
        if not isinstance(item, dict):
            raise ValueError("Yu-Gi-Oh! set printing is malformed")
        full_code = str(item.get("set_code") or "").strip()
        set_name = str(item.get("set_name") or "").strip()
        if not full_code or not set_name:
            raise ValueError("Yu-Gi-Oh! set printing is missing identity")
        family = full_code.split("-", 1)[0]
        price = str(item.get("set_price") or "").strip()
        rarity = _rarity(item.get("set_rarity"))
        result.append(
            NormalizedCard(
                card_set=NormalizedSet(
                    "yugioh",
                    _identity("set", family),
                    family,
                    set_name,
                    "expansion",
                    None,
                    0,
                    False,
                    None,
                    now,
                    None,
                ),
                oracle=NormalizedOracle(
                    "yugioh",
                    _identity("oracle", provider_id),
                    name,
                    "yugioh",
                    None,
                    0,
                    str(record.get("type") or "") or None,
                    str(record.get("desc") or "") or None,
                    [str(record["attribute"])] if record.get("attribute") else [],
                    [],
                    [str(record["race"])] if record.get("race") else [],
                    {},
                ),
                printing=NormalizedPrinting(
                    "yugioh",
                    _identity("printing", f"{provider_id}:{full_code}:{rarity}"),
                    "en",
                    full_code,
                    rarity,
                    None,
                    None,
                    None,
                    False,
                    False,
                    "yugioh",
                    None,
                    None,
                    None,
                    None,
                    {"normal": image} if image else {},
                    {"usd": price} if price else {},
                    ["nonfoil"],
                    ["yugioh"],
                    [str(record["attribute"])] if record.get("attribute") else [],
                    [],
                    {},
                ),
                faces=[],
            )
        )
    if not result:
        raise ValueError("Yu-Gi-Oh! card has no set printings")
    return result


class YugiohClient:
    game = "yugioh"

    def __init__(self, settings: Settings, *, http_client: httpx.AsyncClient | None = None):
        self.settings, self._client = settings, http_client

    async def _request(self, params: dict[str, int]) -> list[dict[str, Any]]:
        client = self._client or httpx.AsyncClient(
            timeout=httpx.Timeout(self.settings.catalog_http_timeout_seconds),
            follow_redirects=False,
        )
        try:
            for attempt in range(self.settings.catalog_retry_attempts):
                try:
                    payload = await stream_json_response(
                        client,
                        YUGIOH_CARDS_URL,
                        params=params,
                        headers={
                            "Accept": "application/json",
                            "User-Agent": "WynterLabs-Cards/0.3",
                        },
                        max_bytes=self.settings.catalog_max_provider_response_bytes,
                    )
                    rows = payload.get("data") if isinstance(payload, dict) else None
                    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
                        raise ValueError("provider response contained invalid card data")
                    return rows
                except (httpx.HTTPError, OSError, ValueError):
                    if attempt + 1 == self.settings.catalog_retry_attempts:
                        raise RuntimeError(
                            "Yu-Gi-Oh! provider request failed after bounded retries"
                        ) from None
                    await asyncio.sleep(min(2**attempt, 4))
        finally:
            if self._client is None:
                await client.aclose()
        raise RuntimeError("Yu-Gi-Oh! provider request failed")

    async def fetch_cards(self) -> list[dict[str, Any]]:
        page_size = self.settings.catalog_yugioh_page_size
        rows: list[dict[str, Any]] = []
        for page in range(self.settings.catalog_provider_max_pages):
            page_rows = await self._request({"num": page_size, "offset": page * page_size})
            rows.extend(
                row
                for row in page_rows
                if isinstance(row.get("card_sets"), list) and row["card_sets"]
            )
            if len(rows) > self.settings.catalog_provider_max_records:
                raise ValueError("Yu-Gi-Oh! response exceeded configured record limit")
            if len(page_rows) < page_size:
                return rows
        raise ValueError("Yu-Gi-Oh! pagination exceeded configured page limit")
