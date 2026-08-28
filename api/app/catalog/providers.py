"""Small, provider-neutral helpers for free catalog feeds."""

import json
from collections.abc import Awaitable, Callable
from typing import Any, Protocol
from urllib.parse import urlparse

import httpx


class CatalogProvider(Protocol):
    game: str

    async def fetch_cards(self) -> list[dict[str, Any]]: ...


def approved_https_url(value: object, *hosts: str) -> str | None:
    """Return a provider URL only when it is credential-free HTTPS on an exact host."""
    if not isinstance(value, str):
        return None
    try:
        parsed = urlparse(value)
        port = parsed.port
    except ValueError:
        return None
    if (
        parsed.scheme != "https"
        or parsed.hostname not in hosts
        or parsed.username is not None
        or parsed.password is not None
        or port not in (None, 443)
    ):
        return None
    return value


async def bounded_pages(
    request: Callable[[str, dict[str, Any]], Awaitable[dict[str, Any]]],
    url: str,
    *,
    page_size: int,
    max_pages: int,
    max_records: int,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for page in range(1, max_pages + 1):
        payload = await request(url, {"page": page, "pageSize": page_size})
        data = payload.get("data")
        if not isinstance(data, list) or any(not isinstance(item, dict) for item in data):
            raise ValueError("provider response contained invalid card data")
        rows.extend(data)
        if len(rows) > max_records:
            raise ValueError("provider response exceeded configured record limit")
        total = payload.get("totalCount")
        if len(data) < page_size or (isinstance(total, int) and len(rows) >= total):
            return rows
    raise ValueError("provider pagination exceeded configured page limit")


async def stream_json_response(
    client: httpx.AsyncClient,
    url: str,
    *,
    headers: dict[str, str],
    params: dict[str, Any] | None,
    max_bytes: int,
) -> dict[str, Any]:
    """Read one provider page without accepting an unbounded in-memory body."""
    async with client.stream("GET", url, params=params, headers=headers) as response:
        response.raise_for_status()
        content_type = response.headers.get("content-type", "application/json")
        if not content_type.lower().startswith("application/json"):
            raise ValueError("provider response content type was not JSON")
        if int(response.headers.get("content-length", "0") or 0) > max_bytes:
            raise ValueError("provider response exceeded configured size limit")
        content = bytearray()
        async for chunk in response.aiter_bytes():
            if len(chunk) > max_bytes - len(content):
                raise ValueError("provider response exceeded configured size limit")
            content.extend(chunk)
    payload = json.loads(content)
    if not isinstance(payload, dict):
        raise ValueError("provider response was not an object")
    return payload
