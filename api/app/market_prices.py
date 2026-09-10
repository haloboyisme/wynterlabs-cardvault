"""Daily, server-side TCGCSV cache. Quotes are market/listing aggregates, not sold records."""

import asyncio
import fcntl
import json
import logging
import re
import time
import uuid
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

import httpx
from sqlalchemy import select

from app.models import CardPrinting, CardSet, CollectionItem, OracleCard

log = logging.getLogger(__name__)
CATEGORIES = {
    "mtg": 1,
    "pokemon": 3,
    "yugioh": 2,
    "onepiece": 68,
    "digimon": 63,
    "starwars": 79,
    "unionarena": 81,
    "lorcana": 71,
    "riftbound": 89,
}
DAY = 86400


def normalized(value):
    return re.sub(r"[^\w]", "", str(value).casefold())


def number(value):
    value = str(value).split("/")[0].strip().casefold()
    return str(int(value)) if value.isdigit() else value


def choose_group(groups, code, name):
    matches = [g for g in groups if normalized(g.get("name", "")) == normalized(name)]
    if not matches:
        matches = [
            g
            for g in groups
            if g.get("abbreviation") and normalized(g["abbreviation"]) == normalized(code)
        ]
    return matches[0]["groupId"] if len(matches) == 1 else None


def match_product(products, name, collector, source_uri):
    linked = re.search(r"^https://(?:www\.)?tcgplayer\.com/product/(\d+)(?:/|$)", source_uri or "")
    if linked:
        ids = [p["productId"] for p in products if p.get("productId") == int(linked[1])]
        return ids[0] if len(ids) == 1 else None
    matches = []
    for p in products:
        # Remove only a numeric display suffix, not edition/variant descriptors.
        title = re.sub(r"\s+\(\d+\)$", "", p.get("name", ""))
        fields = p.get("extendedData") or []
        card_number = next((f.get("value") for f in fields if f.get("name") == "Number"), None)
        if (
            card_number is not None
            and normalized(title) == normalized(name)
            and number(card_number) == number(collector)
        ):
            matches.append(p["productId"])
    return matches[0] if len(matches) == 1 else None


def money(value):
    try:
        price = Decimal(str(value))
        return (
            str(price.quantize(Decimal("0.01")))
            if price.is_finite() and 0 <= price <= 999999999
            else None
        )
    except (InvalidOperation, ValueError):
        return None


def quote_rows(prices, product_id):
    return [
        {
            "variant": str(p.get("subTypeName", "Unknown"))[:80],
            **{
                key: money(p.get(source))
                for key, source in (
                    ("low", "lowPrice"),
                    ("mid", "midPrice"),
                    ("high", "highPrice"),
                    ("market", "marketPrice"),
                )
            },
        }
        for p in prices
        if p.get("productId") == product_id
    ]


def cache_root(settings):
    return Path(settings.catalog_media_cache_dir) / "market-prices"


def read_json(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def write_json(path, value):
    temporary = path.with_suffix(f".{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(json.dumps(value))
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


async def cached_fetch(client, root, path, text=False):
    cache = root / (path.replace("/", "_") + ".json")
    existing = read_json(cache)
    if existing and time.time() - existing["fetched"] < DAY:
        if "error" in existing:
            raise ValueError("Feed unavailable during current daily window")
        return existing["data"]
    try:
        await asyncio.sleep(0.12)
        async with client.stream("GET", "https://tcgcsv.com/" + path) as response:
            response.raise_for_status()
            body = bytearray()
            async for chunk in response.aiter_bytes():
                body.extend(chunk)
                if len(body) > 25_000_000:
                    raise ValueError("Feed exceeds size limit")
        payload = body.decode().strip() if text else json.loads(body)
        if not text and (
            not isinstance(payload, dict)
            or payload.get("success") is not True
            or not isinstance(payload.get("results"), list)
        ):
            raise ValueError("Invalid provider response")
        write_json(cache, {"fetched": time.time(), "data": payload})
        return payload
    except Exception:
        write_json(cache, {"fetched": time.time(), "error": True})
        raise


async def refresh_market_prices(settings, factory):
    root = cache_root(settings)
    root.mkdir(parents=True, exist_ok=True)
    with (root / "refresh.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        state = read_json(root / "status.json") or {}
        if time.time() - state.get("attempted", 0) < DAY:
            return
        previous_status = state.get("status")
        state.update(attempted=time.time(), status="refreshing")
        write_json(root / "status.json", state)
        try:
            async with factory() as db:
                rows = (
                    await db.execute(
                        select(
                            CardPrinting.id,
                            CardPrinting.game,
                            OracleCard.name,
                            CardPrinting.collector_number,
                            CardPrinting.source_uri,
                            CardSet.code,
                            CardSet.name.label("set_name"),
                        )
                        .join(OracleCard, OracleCard.id == CardPrinting.oracle_card_id)
                        .join(CardSet, CardSet.id == CardPrinting.card_set_id)
                        .where(
                            CardPrinting.custom_owner_id.is_(None),
                            CardPrinting.language == "en",
                            CardPrinting.active.is_(True),
                            CardPrinting.id.in_(select(CollectionItem.printing_id)),
                        )
                        .distinct()
                    )
                ).all()
            matched = 0
            failed = 0
            groups_cache = {}
            product_cache = {}
            requested_groups = set()
            async with httpx.AsyncClient(
                timeout=30,
                follow_redirects=False,
                headers={"User-Agent": "WynterLabs-CardVault/2.5.10"},
            ) as client:
                updated = await cached_fetch(client, root, "last-updated.txt", text=True)
                if updated == state.get("provider_updated_at") and previous_status == "complete":
                    state["status"] = "complete"
                    write_json(root / "status.json", state)
                    return
                # Validate timestamp; never label an old provider build as fresh.
                datetime.fromisoformat(updated.replace("Z", "+00:00"))
                for row in rows:
                    category = CATEGORIES.get(row.game)
                    if category is None:
                        continue
                    try:
                        if category not in groups_cache:
                            groups_cache[category] = (
                                await cached_fetch(client, root, f"tcgplayer/{category}/groups")
                            )["results"]
                        group = choose_group(groups_cache[category], row.code, row.set_name)
                        record = {
                            "provider_updated_at": updated,
                            "checked_at": datetime.now(UTC).isoformat(),
                            "quotes": [],
                            "product_id": None,
                        }
                        if group is not None:
                            key = (category, group)
                            if key not in product_cache:
                                if key not in requested_groups and len(requested_groups) >= 300:
                                    continue
                                requested_groups.add(key)
                                products = (
                                    await cached_fetch(
                                        client, root, f"tcgplayer/{category}/{group}/products"
                                    )
                                )["results"]
                                prices = (
                                    await cached_fetch(
                                        client, root, f"tcgplayer/{category}/{group}/prices"
                                    )
                                )["results"]
                                product_cache[key] = products, prices
                            products, prices = product_cache[key]
                            product_id = match_product(
                                products, row.name, row.collector_number, row.source_uri
                            )
                            if product_id is not None:
                                record.update(
                                    product_id=product_id, quotes=quote_rows(prices, product_id)
                                )
                                matched += bool(record["quotes"])
                        write_json(root / f"card-{row.id}.json", record)
                    except (httpx.HTTPError, ValueError, KeyError, TypeError):
                        failed += 1
            state.update(
                status="complete" if not failed else "partial",
                matched=matched,
                checked=len(rows),
                failed=failed,
                completed_at=datetime.now(UTC).isoformat(),
                provider_updated_at=updated,
            )
            write_json(root / "status.json", state)
        except asyncio.CancelledError:
            state.update(status="interrupted", attempted=0)
            write_json(root / "status.json", state)
            raise
        except Exception as error:
            state.update(status="unavailable")
            write_json(root / "status.json", state)
            log.warning("Daily market price refresh unavailable (%s)", type(error).__name__)


async def market_price_loop(settings, factory):
    if settings.environment != "production":
        return
    while True:
        try:
            await refresh_market_prices(settings, factory)
        except Exception as error:
            log.warning("Market price cache unavailable (%s)", type(error).__name__)
        await asyncio.sleep(900)


def collection_market_total(rows, root):
    """Sum owned quantities with an unambiguous matching finish; never substitute asking prices."""
    total = Decimal("0")
    asking = Decimal("0")
    priced = missing = asking_copies = stale_copies = 0
    stamps = []
    feeds = {}
    aliases = {"nonfoil": "normal", "etched": "etchedfoil"}
    for printing_id, finish, quantity, custom_owner_id in rows:
        if printing_id not in feeds:
            feeds[printing_id] = (
                read_json(root / f"card-{printing_id}.json") or {}
                if custom_owner_id is None
                else {}
            )
        feed = feeds[printing_id]
        target = aliases.get(normalized(finish), normalized(finish))
        quotes = [q for q in feed.get("quotes", []) if normalized(q.get("variant", "")) == target]
        price = money(quotes[0].get("market")) if len(quotes) == 1 else None
        if price is None:
            missing += quantity
            continue
        total += Decimal(price) * quantity
        priced += quantity
        mid = money(quotes[0].get("mid"))
        if mid is not None:
            asking += Decimal(mid) * quantity
            asking_copies += quantity
        try:
            stamp = datetime.fromisoformat(feed["provider_updated_at"].replace("Z", "+00:00"))
            if stamp.tzinfo is None:
                raise ValueError("Missing timezone")
            stamps.append(stamp)
            stale = (datetime.now(UTC) - stamp).total_seconds() > 36 * 3600
        except (KeyError, TypeError, ValueError):
            stale = True
        stale_copies += quantity if stale else 0
    return {
        "value_usd": f"{total:.2f}" if priced or not missing else None,
        "asking_value_usd": f"{asking:.2f}" if priced and asking_copies == priced else None,
        "priced_copies": priced,
        "unpriced_copies": missing,
        "stale_copies": stale_copies,
        "provider_updated_at": min(stamps).isoformat() if stamps else None,
    }
