from app.market_prices import choose_group, match_product, quote_rows


def test_exact_match_ignores_numeric_display_suffix_but_rejects_ambiguity():
    product = {
        "productId": 42,
        "name": "Mocking Sprite (0159)",
        "extendedData": [{"name": "Number", "value": "159"}],
    }
    assert match_product([product], "Mocking Sprite", "159", None) == 42
    assert match_product([product], "Mocking Sprite", "744", None) is None
    assert (
        match_product([product, {**product, "productId": 43}], "Mocking Sprite", "159", None)
        is None
    )
    assert match_product([product], "Another card", "159", None) is None


def test_groups_require_unique_match():
    group = {"groupId": 1, "abbreviation": "FDN", "name": "Foundations"}
    assert choose_group([group], "fdn", "Foundations") == 1
    assert choose_group([group, {**group, "groupId": 2}], "fdn", "Foundations") is None


def test_quotes_keep_variants_separate_and_reject_invalid_prices():
    rows = quote_rows(
        [
            {
                "productId": 42,
                "subTypeName": "Normal",
                "lowPrice": 0,
                "midPrice": 2,
                "highPrice": -1,
                "marketPrice": "NaN",
            },
            {"productId": 42, "subTypeName": "Foil", "marketPrice": 3},
            {"productId": 43, "subTypeName": "Normal", "marketPrice": 999},
        ],
        42,
    )
    assert len(rows) == 2
    assert rows[0] == {
        "variant": "Normal",
        "low": "0.00",
        "mid": "2.00",
        "high": None,
        "market": None,
    }
    assert rows[1]["market"] == "3.00"


def test_price_details_are_private_and_preserve_manual_custom_values(app, tmp_path):
    import uuid

    from test_admin_api import _authenticated_client

    from app.models import Role

    app.state.settings.catalog_media_cache_dir = tmp_path / "media"
    with _authenticated_client(
        app,
        user_id=uuid.uuid4(),
        role=Role.MEMBER,
        email="price@example.com",
        display_name="Prices",
    ) as owner:
        created = owner.post(
            "/api/v1/custom-cards",
            json={"name": "Private card", "game": "custom", "value_usd": "3.25", "quantity": 2},
        )
        assert created.status_code == 201
        item = owner.get("/api/v1/collection").json()["items"][0]
        url = f"/api/v1/collection/items/{item['id']}/price-details"
        result = owner.get(url)
        assert result.status_code == 200
        assert result.json()["quantity_estimate_usd"] == "6.50"
        assert result.json()["quotes"] == []
        with _authenticated_client(
            app,
            user_id=uuid.uuid4(),
            role=Role.MEMBER,
            email="otherprice@example.com",
            display_name="Other",
        ) as other:
            assert other.get(url).status_code == 404


def test_daily_fetch_cache_limits_requests(tmp_path):
    import asyncio

    import httpx

    from app.market_prices import cached_fetch

    calls = []

    def respond(request):
        calls.append(str(request.url))
        return httpx.Response(200, json={"success": True, "results": []})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            await cached_fetch(client, tmp_path, "tcgplayer/1/groups")
            await cached_fetch(client, tmp_path, "tcgplayer/1/groups")

    asyncio.run(run())
    assert len(calls) == 1


def test_sync_matches_owned_printing_and_returns_daily_quotes(app, tmp_path, monkeypatch):
    import asyncio
    import uuid
    from datetime import UTC, datetime

    from test_admin_api import _authenticated_client
    from test_catalog_api import BOLT_PRINTING_ID, _seed_catalog

    import app.market_prices as module
    from app.models import Role

    app.state.settings.catalog_media_cache_dir = tmp_path / "media"
    asyncio.run(_seed_catalog(app))

    async def fake_fetch(client, root, path, text=False):
        if text:
            return datetime.now(UTC).isoformat()
        if path.endswith("/groups"):
            return {"results": [{"groupId": 42, "abbreviation": "M10", "name": "Magic 2010"}]}
        if path.endswith("/products"):
            return {
                "results": [
                    {
                        "productId": 123,
                        "name": "Lightning Bolt",
                        "extendedData": [{"name": "Number", "value": "146"}],
                    }
                ]
            }
        return {
            "results": [
                {
                    "productId": 123,
                    "subTypeName": "Normal",
                    "lowPrice": 1,
                    "midPrice": 2,
                    "marketPrice": 1.5,
                }
            ]
        }

    monkeypatch.setattr(module, "cached_fetch", fake_fetch)
    with _authenticated_client(
        app, user_id=uuid.uuid4(), role=Role.MEMBER, email="sync@example.com", display_name="Sync"
    ) as client:
        item = client.post(
            "/api/v1/collection/items",
            json={
                "printing_id": str(BOLT_PRINTING_ID),
                "finish": "nonfoil",
                "condition": "near_mint",
                "quantity": 1,
            },
        ).json()
        asyncio.run(module.refresh_market_prices(app.state.settings, app.state.session_factory))
        result = client.get(f"/api/v1/collection/items/{item['id']}/price-details").json()
        assert result["sync_status"] == "complete"
        assert result["quotes"][0]["market"] == "1.50"
        assert result["product_id"] == 123
        summary = client.get("/api/v1/collection/summary").json()["market_total"]
        assert summary["value_usd"] == "1.50"
        assert summary["asking_value_usd"] == "2.00"
        assert summary["priced_copies"] == 1
        with _authenticated_client(
            app,
            user_id=uuid.uuid4(),
            role=Role.MEMBER,
            email="empty-market@example.com",
            display_name="Empty",
        ) as other:
            other_total = other.get("/api/v1/collection/summary").json()["market_total"]
            assert other_total["value_usd"] == "0.00"
            assert other_total["priced_copies"] == 0
        assert result["stale"] is False
        status = module.read_json(module.cache_root(app.state.settings) / "status.json")
        assert status["checked"] == 1
        assert (
            module.read_json(
                module.cache_root(app.state.settings) / f"card-{BOLT_PRINTING_ID}.json"
            )
            is not None
        )


def test_market_total_quantities_finishes_missing_and_private(tmp_path):
    from datetime import UTC, datetime, timedelta

    from app.market_prices import collection_market_total, write_json

    write_json(
        tmp_path / "card-one.json",
        {
            "provider_updated_at": (datetime.now(UTC) - timedelta(days=3)).isoformat(),
            "quotes": [
                {"variant": "Normal", "market": "1.25", "mid": "2.00"},
                {"variant": "Foil", "market": "5.00", "mid": "6.00"},
            ],
        },
    )
    result = collection_market_total(
        [
            ("one", "nonfoil", 3, None),
            ("one", "foil", 2, None),
            ("one", "etched", 4, None),
            ("missing", "nonfoil", 5, None),
        ],
        tmp_path,
    )
    assert result["value_usd"] == "13.75"
    assert result["asking_value_usd"] == "18.00"
    assert result["priced_copies"] == 5
    assert result["unpriced_copies"] == 9
    assert result["stale_copies"] == 5
    assert collection_market_total([("missing", "nonfoil", 1, None)], tmp_path)["value_usd"] is None
    assert collection_market_total([], tmp_path)["value_usd"] == "0.00"
    assert collection_market_total([("one", "nonfoil", 1, "owner")], tmp_path)["value_usd"] is None


def test_market_total_rejects_ambiguity_and_keeps_zero(tmp_path):
    from app.market_prices import collection_market_total, write_json

    write_json(
        tmp_path / "card-one.json",
        {
            "quotes": [
                {"variant": "Normal", "market": "0.00"},
                {"variant": "Foil", "market": "8.00"},
                {"variant": "Foil", "market": "9.00"},
            ]
        },
    )
    result = collection_market_total(
        [
            ("one", "nonfoil", 2, None),
            ("one", "foil", 1, None),
        ],
        tmp_path,
    )
    assert result["value_usd"] == "0.00"
    assert result["priced_copies"] == 2
    assert result["unpriced_copies"] == 1
    assert result["asking_value_usd"] is None
