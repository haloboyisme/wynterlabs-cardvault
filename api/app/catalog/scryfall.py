import asyncio
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from urllib.parse import urlparse

import httpx

from app.config import Settings

BULK_METADATA_URL = "https://api.scryfall.com/bulk-data/default-cards"
SETS_URL = "https://api.scryfall.com/sets"
SCRYFALL_USER_AGENT = "WynterLabs-Cards/0.3 (+https://wynterlabs.com)"
SCRYFALL_ACCEPT = "application/json"
_ALLOWED_DOWNLOAD_HOSTS = {"data.scryfall.io"}


@dataclass(frozen=True)
class BulkMetadata:
    bulk_id: uuid.UUID
    updated_at: datetime
    download_uri: str
    compressed_size: int


@dataclass(frozen=True)
class SetMetadata:
    scryfall_id: uuid.UUID
    code: str
    name: str
    set_type: str
    released_at: date | None
    card_count: int
    digital: bool
    icon_svg_uri: str | None
    source_uri: str
    source_updated_at: datetime


class ScryfallClient:
    def __init__(self, settings: Settings, *, http_client: httpx.AsyncClient | None = None):
        self.settings = settings
        self._client = http_client

    def _headers(self) -> dict[str, str]:
        return {"User-Agent": SCRYFALL_USER_AGENT, "Accept": SCRYFALL_ACCEPT}

    async def _request(self, method: str, url: str, **kwargs) -> httpx.Response:
        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(
            timeout=httpx.Timeout(self.settings.catalog_http_timeout_seconds),
            follow_redirects=False,
        )
        try:
            last_error: Exception | None = None
            for attempt in range(self.settings.catalog_retry_attempts):
                try:
                    response = await client.request(method, url, headers=self._headers(), **kwargs)
                    response.raise_for_status()
                    return response
                except (httpx.HTTPError, OSError) as error:
                    last_error = error
                    if attempt + 1 < self.settings.catalog_retry_attempts:
                        await asyncio.sleep(min(2**attempt, 4))
            raise RuntimeError("Scryfall request failed after bounded retries") from last_error
        finally:
            if owns_client:
                await client.aclose()

    async def fetch_bulk_metadata(self) -> BulkMetadata:
        response = await self._request("GET", BULK_METADATA_URL)
        payload = response.json()
        download_uri = payload.get("jsonl_download_uri")
        if payload.get("object") != "bulk_data" or payload.get("type") != "default_cards":
            raise ValueError("Scryfall metadata is not the default_cards bulk dataset")
        self._validate_download_uri(download_uri)
        compressed_size = int(payload.get("compressed_size", 0))
        if compressed_size <= 0 or compressed_size > self.settings.catalog_max_download_bytes:
            raise ValueError("Scryfall bulk download size is outside configured bounds")
        return BulkMetadata(
            bulk_id=uuid.UUID(payload["id"]),
            updated_at=datetime.fromisoformat(payload["updated_at"].replace("Z", "+00:00")),
            download_uri=download_uri,
            compressed_size=compressed_size,
        )

    async def fetch_sets(self) -> dict[uuid.UUID, SetMetadata]:
        response = await self._request("GET", SETS_URL)
        payload = response.json()
        if payload.get("object") != "list" or payload.get("has_more") is not False:
            raise ValueError("Scryfall sets response was not a complete list")
        rows = payload.get("data")
        if not isinstance(rows, list):
            raise ValueError("Scryfall sets response omitted data")
        fetched_at = datetime.now(UTC)
        result = {}
        for row in rows:
            if not isinstance(row, dict) or row.get("object") != "set":
                raise ValueError("Scryfall sets response contained an invalid record")
            set_id = uuid.UUID(row["id"])
            released = row.get("released_at")
            item = SetMetadata(
                scryfall_id=set_id,
                code=str(row["code"]),
                name=str(row["name"]),
                set_type=str(row["set_type"]),
                released_at=date.fromisoformat(released) if released else None,
                card_count=int(row["card_count"]),
                digital=bool(row["digital"]),
                icon_svg_uri=approved_set_icon_url(row.get("icon_svg_uri")),
                source_uri=str(row["scryfall_uri"]),
                source_updated_at=fetched_at,
            )
            if item.card_count < 0 or not item.code or set_id in result:
                raise ValueError("Scryfall sets response contained invalid identity data")
            result[set_id] = item
        return result

    async def download_bulk(self, metadata: BulkMetadata, destination: Path) -> None:
        try:
            async with asyncio.timeout(self.settings.catalog_download_deadline_seconds):
                await self._download_with_retries(metadata, destination)
        except TimeoutError:
            destination.unlink(missing_ok=True)
            raise RuntimeError("Scryfall download exceeded its hard deadline") from None

    async def _download_with_retries(
        self,
        metadata: BulkMetadata,
        destination: Path,
    ) -> None:
        self._validate_download_uri(metadata.download_uri)
        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(
            timeout=httpx.Timeout(self.settings.catalog_download_timeout_seconds),
            follow_redirects=False,
        )
        try:
            last_error: Exception | None = None
            for attempt in range(self.settings.catalog_retry_attempts):
                written = 0
                try:
                    async with client.stream(
                        "GET", metadata.download_uri, headers=self._headers()
                    ) as response:
                        response.raise_for_status()
                        with destination.open("wb") as output:
                            async for chunk in response.aiter_bytes():
                                written += len(chunk)
                                if written > self.settings.catalog_max_download_bytes:
                                    raise ValueError(
                                        "Scryfall download exceeded configured size limit"
                                    )
                                output.write(chunk)
                    if written == 0:
                        raise ValueError("Scryfall download was empty")
                    return
                except (httpx.HTTPError, OSError, ValueError) as error:
                    destination.unlink(missing_ok=True)
                    last_error = error
                    if attempt + 1 < self.settings.catalog_retry_attempts:
                        await asyncio.sleep(min(2**attempt, 4))
            raise RuntimeError("Scryfall download failed after bounded retries") from last_error
        finally:
            if owns_client:
                await client.aclose()

    @staticmethod
    def _validate_download_uri(uri: object) -> None:
        if not isinstance(uri, str):
            raise ValueError("Scryfall metadata omitted the JSONL download URI")
        parsed = urlparse(uri)
        if parsed.scheme != "https" or parsed.hostname not in _ALLOWED_DOWNLOAD_HOSTS:
            raise ValueError("Scryfall download URI is not an approved HTTPS source")


def approved_set_icon_url(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = urlparse(value)
        port = parsed.port
    except ValueError:
        return None
    if (
        parsed.scheme != "https"
        or parsed.hostname != "svgs.scryfall.io"
        or parsed.username is not None
        or parsed.password is not None
        or port not in (None, 443)
        or not parsed.path.endswith(".svg")
    ):
        return None
    return value
