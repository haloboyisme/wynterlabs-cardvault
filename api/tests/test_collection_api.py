import asyncio
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from test_admin_api import _authenticated_client
from test_catalog_api import (
    BOLT_OTHER_PRINTING_ID,
    BOLT_PRINTING_ID,
    POKEMON_PRINTING_ID,
    STRIKE_PRINTING_ID,
    _seed_catalog,
    _seed_supported_game_catalog,
)

from app.models import CardPrinting, CollectionItem, Role


def _error(response, status: int, code: str) -> None:
    assert response.status_code == status
    assert response.json()["error"]["code"] == code


def _create(client: TestClient, **overrides):
    payload = {
        "printing_id": str(BOLT_PRINTING_ID),
        "finish": "nonfoil",
        "condition": "near_mint",
        "quantity": 2,
    }
    payload.update(overrides)
    return client.post("/api/v1/collection/items", json=payload)


async def _item_count(app: FastAPI) -> int:
    async with app.state.session_factory() as database:
        return len(list((await database.scalars(select(CollectionItem))).all()))


async def _set_printing_active(app: FastAPI, printing_id: uuid.UUID, active: bool) -> None:
    async with app.state.session_factory() as database:
        printing = await database.scalar(select(CardPrinting).where(CardPrinting.id == printing_id))
        assert printing is not None
        printing.active = active
        await database.commit()


async def _set_collection_created_at(app: FastAPI) -> None:
    now = datetime.now(UTC)
    async with app.state.session_factory() as database:
        items = list((await database.scalars(select(CollectionItem))).all())
        created = {
            BOLT_PRINTING_ID: now - timedelta(days=3),
            BOLT_OTHER_PRINTING_ID: now - timedelta(days=2),
            STRIKE_PRINTING_ID: now - timedelta(days=1),
        }
        for item in items:
            item.created_at = created[item.printing_id]
        await database.commit()


async def _set_value_fixtures(app: FastAPI) -> None:
    now = datetime.now(UTC)
    async with app.state.session_factory() as database:
        bolt = await database.scalar(
            select(CardPrinting).where(CardPrinting.id == BOLT_PRINTING_ID)
        )
        foil = await database.scalar(
            select(CardPrinting).where(CardPrinting.id == BOLT_OTHER_PRINTING_ID)
        )
        strike = await database.scalar(
            select(CardPrinting).where(CardPrinting.id == STRIKE_PRINTING_ID)
        )
        assert bolt is not None and foil is not None and strike is not None
        bolt.finishes = ["nonfoil", "foil", "etched"]
        bolt.prices = {"usd": "1.25", "usd_foil": None, "usd_etched": "3.00"}
        bolt.price_snapshot_at = now - timedelta(hours=2)
        foil.prices = {"usd": "999.00", "usd_foil": "2.10", "usd_etched": None}
        foil.price_snapshot_at = now - timedelta(days=2)
        strike.prices = {"usd": "not-a-price", "usd_foil": None, "usd_etched": None}
        strike.price_snapshot_at = now - timedelta(days=5)
        strike.source_uri = "https://scryfall.com/card/isd/155/lightning-strike"
        await database.commit()


@pytest.fixture
def owner_client(app: FastAPI) -> Iterator[TestClient]:
    with _authenticated_client(
        app,
        user_id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
        role=Role.OWNER,
        email="member-57eaca4553d4@example.invalid",
        display_name="Wynter Owner",
    ) as client:
        yield client


@pytest.fixture
def member_client(app: FastAPI) -> Iterator[TestClient]:
    with _authenticated_client(
        app,
        user_id=uuid.UUID("44444444-4444-4444-4444-444444444444"),
        role=Role.MEMBER,
        email="member-c7ce01e08b88@example.invalid",
        display_name="Wynter Member",
    ) as client:
        yield client


@pytest.fixture
def forced_admin_client(app: FastAPI) -> Iterator[TestClient]:
    with _authenticated_client(
        app,
        user_id=uuid.UUID("33333333-3333-3333-3333-333333333333"),
        role=Role.ADMIN,
        email="member-241b7bcda587@example.invalid",
        display_name="Forced Administrator",
        must_change_password=True,
    ) as client:
        yield client


def test_collection_routes_require_ready_authentication(client: TestClient) -> None:
    _error(client.get("/api/v1/collection"), 401, "not_authenticated")
    _error(
        client.post(
            "/api/v1/collection/items",
            json={
                "printing_id": str(BOLT_PRINTING_ID),
                "finish": "nonfoil",
                "condition": "near_mint",
                "quantity": 1,
            },
        ),
        401,
        "not_authenticated",
    )


def test_forced_password_user_cannot_use_collection(
    app: FastAPI, forced_admin_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    _error(forced_admin_client.get("/api/v1/collection"), 403, "password_change_required")


def test_create_returns_private_item_with_catalog_summary(
    app: FastAPI, owner_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    response = _create(owner_client)
    assert response.status_code == 201
    body = response.json()
    assert body["quantity"] == 2
    assert body["revision"] == 1
    assert body["card"]["printing_id"] == str(BOLT_PRINTING_ID)
    assert body["card"]["name"] == "Lightning Bolt"


def test_duplicate_create_atomically_increments_tuple(
    app: FastAPI, owner_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    first = _create(owner_client, quantity=2)
    assert first.status_code == 201
    second = _create(owner_client, quantity=3)
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["quantity"] == 5
    assert second.json()["revision"] == 2
    assert asyncio.run(_item_count(app)) == 1


def test_collection_is_scoped_to_current_user(
    app: FastAPI, owner_client: TestClient, member_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    created = _create(owner_client)
    assert created.status_code == 201
    assert member_client.get("/api/v1/collection").json()["total"] == 0
    _error(
        member_client.put(
            f"/api/v1/collection/items/{created.json()['id']}",
            json={"quantity": 3, "expected_revision": 1},
        ),
        404,
        "collection_item_not_found",
    )
    _error(
        member_client.delete(
            f"/api/v1/collection/items/{created.json()['id']}?expected_revision=1"
        ),
        404,
        "collection_item_not_found",
    )


def test_create_rejects_missing_or_inactive_printing_and_finish_mismatch(
    app: FastAPI, owner_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    _error(_create(owner_client, printing_id=str(uuid.uuid4())), 404, "printing_not_found")
    _error(_create(owner_client, finish="etched"), 422, "finish_not_available")
    asyncio.run(_set_printing_active(app, BOLT_PRINTING_ID, False))
    _error(_create(owner_client), 404, "printing_not_found")


def test_create_validates_condition_and_quantity_bounds(
    app: FastAPI, owner_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    _error(_create(owner_client, condition="mint"), 422, "validation_error")
    _error(_create(owner_client, quantity=0), 422, "validation_error")
    _error(_create(owner_client, quantity=10000), 422, "validation_error")


def test_update_detects_tuple_collision_and_stale_revision(
    app: FastAPI, owner_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    first = _create(owner_client, condition="near_mint")
    second = _create(owner_client, condition="lightly_played")
    assert first.status_code == second.status_code == 201
    _error(
        owner_client.put(
            f"/api/v1/collection/items/{second.json()['id']}",
            json={"condition": "near_mint", "expected_revision": 1},
        ),
        409,
        "collection_tuple_conflict",
    )
    updated = owner_client.put(
        f"/api/v1/collection/items/{first.json()['id']}",
        json={"quantity": 4, "expected_revision": 1},
    )
    assert updated.status_code == 200
    _error(
        owner_client.put(
            f"/api/v1/collection/items/{first.json()['id']}",
            json={"quantity": 5, "expected_revision": 1},
        ),
        409,
        "collection_item_stale",
    )
    assert owner_client.get("/api/v1/collection").json()["items"][0]["quantity"] == 4


def test_update_rejects_finish_not_available_and_delete_removes_item(
    app: FastAPI, owner_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    created = _create(owner_client)
    assert created.status_code == 201
    _error(
        owner_client.put(
            f"/api/v1/collection/items/{created.json()['id']}",
            json={"finish": "etched", "expected_revision": 1},
        ),
        422,
        "finish_not_available",
    )
    deleted = owner_client.delete(
        f"/api/v1/collection/items/{created.json()['id']}?expected_revision=1"
    )
    assert deleted.status_code == 204
    assert owner_client.get("/api/v1/collection").json()["total"] == 0


def test_collection_filters_sorts_paginates_and_summarizes(
    app: FastAPI, owner_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    assert _create(owner_client, quantity=2).status_code == 201
    assert (
        _create(
            owner_client,
            printing_id=str(BOLT_OTHER_PRINTING_ID),
            finish="foil",
            condition="lightly_played",
            quantity=3,
        ).status_code
        == 201
    )
    page = owner_client.get(
        "/api/v1/collection",
        params={"condition": "lightly_played", "sort": "name", "page_size": 1},
    )
    assert page.status_code == 200
    assert page.json()["total"] == 1
    assert page.json()["pages"] == 1
    _error(
        owner_client.get("/api/v1/collection", params={"page_size": 101}),
        422,
        "validation_error",
    )
    _error(owner_client.get("/api/v1/collection", params={"sort": "bad"}), 422, "validation_error")


def test_collection_game_contract_filters_supported_games_and_hides_unknown_games(
    app: FastAPI, owner_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    asyncio.run(_seed_supported_game_catalog(app))
    assert _create(owner_client).status_code == 201
    assert _create(owner_client, printing_id=str(POKEMON_PRINTING_ID)).status_code == 201

    auto = owner_client.get("/api/v1/collection").json()
    magic = owner_client.get("/api/v1/collection", params={"game": " MTG "}).json()
    pokemon = owner_client.get("/api/v1/collection", params={"game": "pokemon"}).json()
    unknown = owner_client.get("/api/v1/collection", params={"game": "invented"}).json()

    assert {item["card"]["set"]["game"] for item in auto["items"]} == {"mtg", "pokemon"}
    assert {item["card"]["set"]["game"] for item in magic["items"]} == {"mtg"}
    assert [item["printing_id"] for item in pokemon["items"]] == [str(POKEMON_PRINTING_ID)]
    assert unknown == {"items": [], "page": 1, "page_size": 25, "total": 0, "pages": 0}


def test_collection_q_and_finish_filters_and_quantity_order_traverse_pages(
    app: FastAPI, owner_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    assert _create(owner_client, quantity=2).status_code == 201
    assert (
        _create(
            owner_client,
            printing_id=str(BOLT_OTHER_PRINTING_ID),
            finish="foil",
            condition="lightly_played",
            quantity=3,
        ).status_code
        == 201
    )
    assert (
        _create(
            owner_client,
            printing_id=str(STRIKE_PRINTING_ID),
            finish="nonfoil",
            quantity=4,
        ).status_code
        == 201
    )

    filtered = owner_client.get("/api/v1/collection", params={"q": "LIGHTNING", "finish": "FoIl"})
    assert filtered.status_code == 200
    assert filtered.json()["total"] == 1
    assert filtered.json()["items"][0]["card"]["name"] == "Lightning Bolt"
    assert filtered.json()["items"][0]["finish"] == "foil"

    pages = [
        owner_client.get(
            "/api/v1/collection",
            params={"sort": "quantity", "page": page, "page_size": 1},
        )
        for page in (1, 2, 3)
    ]
    assert [page.status_code for page in pages] == [200, 200, 200]
    assert [page.json()["items"][0]["quantity"] for page in pages] == [4, 3, 2]
    assert [page.json()["pages"] for page in pages] == [3, 3, 3]


def test_collection_advanced_filters_apply_before_counting_and_pagination(
    app: FastAPI, owner_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    assert _create(owner_client, quantity=2).status_code == 201
    assert (
        _create(
            owner_client,
            printing_id=str(BOLT_OTHER_PRINTING_ID),
            finish="foil",
            condition="lightly_played",
            quantity=3,
        ).status_code
        == 201
    )
    assert (
        _create(
            owner_client,
            printing_id=str(STRIKE_PRINTING_ID),
            finish="nonfoil",
            quantity=4,
        ).status_code
        == 201
    )
    asyncio.run(_set_value_fixtures(app))

    cases = [
        ({"collector_number": " 301 "}, [BOLT_OTHER_PRINTING_ID]),
        ({"rarity": " RARE "}, [BOLT_OTHER_PRINTING_ID]),
        (
            {"price_status": "priced", "sort": "price_desc"},
            [BOLT_OTHER_PRINTING_ID, BOLT_PRINTING_ID],
        ),
        ({"price_status": "missing"}, [STRIKE_PRINTING_ID]),
        (
            {"rarity": "rare", "price_status": "priced"},
            [BOLT_OTHER_PRINTING_ID],
        ),
    ]
    for parameters, printing_ids in cases:
        response = owner_client.get("/api/v1/collection", params=parameters)
        assert response.status_code == 200, parameters
        assert response.json()["total"] == len(printing_ids), parameters
        assert [item["printing_id"] for item in response.json()["items"]] == [
            str(printing_id) for printing_id in printing_ids
        ], parameters

    page_two = owner_client.get(
        "/api/v1/collection",
        params={"price_status": "priced", "sort": "price_desc", "page": 2, "page_size": 1},
    )
    assert page_two.status_code == 200
    assert page_two.json()["total"] == 2
    assert page_two.json()["pages"] == 2
    assert page_two.json()["items"][0]["printing_id"] == str(BOLT_PRINTING_ID)

    for parameters in (
        {"collector_number": " "},
        {"rarity": " "},
        {"price_status": "unknown"},
    ):
        _error(
            owner_client.get("/api/v1/collection", params=parameters),
            422,
            "validation_error",
        )


def test_collection_advanced_sorts_order_the_complete_result_before_pagination(
    app: FastAPI, owner_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    assert _create(owner_client, quantity=2).status_code == 201
    assert (
        _create(
            owner_client,
            printing_id=str(BOLT_OTHER_PRINTING_ID),
            finish="foil",
            condition="lightly_played",
            quantity=3,
        ).status_code
        == 201
    )
    assert (
        _create(
            owner_client,
            printing_id=str(STRIKE_PRINTING_ID),
            finish="nonfoil",
            quantity=4,
        ).status_code
        == 201
    )
    asyncio.run(_set_value_fixtures(app))
    asyncio.run(_set_collection_created_at(app))

    expected = {
        "created_desc": [STRIKE_PRINTING_ID, BOLT_OTHER_PRINTING_ID, BOLT_PRINTING_ID],
        "created_asc": [BOLT_PRINTING_ID, BOLT_OTHER_PRINTING_ID, STRIKE_PRINTING_ID],
        "name_desc": [STRIKE_PRINTING_ID, BOLT_PRINTING_ID, BOLT_OTHER_PRINTING_ID],
        "quantity_asc": [BOLT_PRINTING_ID, BOLT_OTHER_PRINTING_ID, STRIKE_PRINTING_ID],
        "price_desc": [BOLT_OTHER_PRINTING_ID, BOLT_PRINTING_ID, STRIKE_PRINTING_ID],
        "price_asc": [BOLT_PRINTING_ID, BOLT_OTHER_PRINTING_ID, STRIKE_PRINTING_ID],
        "missing_price": [STRIKE_PRINTING_ID, BOLT_OTHER_PRINTING_ID, BOLT_PRINTING_ID],
    }

    for sort, printing_ids in expected.items():
        pages = [
            owner_client.get(
                "/api/v1/collection",
                params={"sort": sort, "page": page, "page_size": 1},
            )
            for page in (1, 2, 3)
        ]
        assert [response.status_code for response in pages] == [200, 200, 200]
        assert [response.json()["items"][0]["printing_id"] for response in pages] == [
            str(printing_id) for printing_id in printing_ids
        ], sort


def test_existing_item_remains_visible_after_its_printing_becomes_inactive(
    app: FastAPI, owner_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    assert _create(owner_client).status_code == 201
    asyncio.run(_set_printing_active(app, BOLT_PRINTING_ID, False))
    response = owner_client.get("/api/v1/collection")
    assert response.status_code == 200
    assert response.json()["items"][0]["card"]["printing_id"] == str(BOLT_PRINTING_ID)
    assert response.json()["items"][0]["card"]["active"] is False


def test_collection_summary_requires_ready_authentication(
    client: TestClient, app: FastAPI, forced_admin_client: TestClient
) -> None:
    _error(client.get("/api/v1/collection/summary"), 401, "not_authenticated")
    asyncio.run(_seed_catalog(app))
    _error(
        forced_admin_client.get("/api/v1/collection/summary"),
        403,
        "password_change_required",
    )


def test_collection_summary_is_private_and_removed_from_list_response(
    app: FastAPI, owner_client: TestClient, member_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    assert _create(owner_client, quantity=2).status_code == 201
    assert (
        _create(
            owner_client,
            printing_id=str(BOLT_OTHER_PRINTING_ID),
            finish="foil",
            condition="lightly_played",
            quantity=3,
        ).status_code
        == 201
    )
    assert (
        _create(
            owner_client,
            printing_id=str(STRIKE_PRINTING_ID),
            condition="near_mint",
            quantity=3,
        ).status_code
        == 201
    )
    page = owner_client.get("/api/v1/collection")
    assert page.status_code == 200
    assert "summary" not in page.json()
    summary = owner_client.get("/api/v1/collection/summary")
    assert summary.status_code == 200
    assert summary.json() == {
        "total_copies": 8,
        "distinct_items": 3,
        "distinct_oracle_cards": 2,
        "distinct_sets": 2,
        "estimated_value_usd": "6.15",
        "priced_copies": 5,
        "unpriced_copies": 3,
        "price_snapshot_at": None,
        "finishes": [
            {"value": "nonfoil", "copies": 5},
            {"value": "foil", "copies": 3},
        ],
        "conditions": [
            {"value": "near_mint", "copies": 5},
            {"value": "lightly_played", "copies": 3},
        ],
        "sets": [
            {
                "code": "isd",
                "name": "Innistrad",
                "game": "mtg",
                "copies": 6,
                "distinct_items": 2,
            },
            {
                "code": "m10",
                "name": "Magic 2010",
                "game": "mtg",
                "copies": 2,
                "distinct_items": 1,
            },
        ],
    }
    assert member_client.get("/api/v1/collection/summary").json() == {
        "total_copies": 0,
        "distinct_items": 0,
        "distinct_oracle_cards": 0,
        "distinct_sets": 0,
        "estimated_value_usd": "0.00",
        "priced_copies": 0,
        "unpriced_copies": 0,
        "price_snapshot_at": None,
        "finishes": [],
        "conditions": [],
        "sets": [],
    }


def test_collection_summary_estimates_exact_finish_value_for_all_private_copies(
    app: FastAPI, owner_client: TestClient, member_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    asyncio.run(_set_value_fixtures(app))
    assert _create(owner_client, quantity=2).status_code == 201
    assert _create(owner_client, finish="etched", quantity=1).status_code == 201
    assert (
        _create(
            owner_client,
            printing_id=str(BOLT_OTHER_PRINTING_ID),
            finish="foil",
            quantity=3,
        ).status_code
        == 201
    )
    assert _create(owner_client, printing_id=str(STRIKE_PRINTING_ID), quantity=4).status_code == 201
    assert _create(member_client, quantity=9).status_code == 201

    summary = owner_client.get("/api/v1/collection/summary")
    assert summary.status_code == 200
    payload = summary.json()
    assert payload["estimated_value_usd"] == "11.80"
    assert payload["priced_copies"] == 6
    assert payload["unpriced_copies"] == 4
    assert datetime.fromisoformat(payload["price_snapshot_at"]) < datetime.now(UTC) - timedelta(
        hours=47
    )

    member_summary = member_client.get("/api/v1/collection/summary").json()
    assert member_summary["estimated_value_usd"] == "11.25"
    assert member_summary["priced_copies"] == 9
    assert member_summary["unpriced_copies"] == 0


def test_missing_price_workflow_is_private_and_recalculates_collection_value(
    app: FastAPI, owner_client: TestClient, member_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    asyncio.run(_set_value_fixtures(app))
    created = _create(
        owner_client,
        printing_id=str(STRIKE_PRINTING_ID),
        quantity=4,
    )
    assert created.status_code == 201

    missing = owner_client.get("/api/v1/collection/pricing/missing")
    assert missing.status_code == 200
    assert missing.json()["total"] == 1
    assert missing.json()["items"][0] == {
        "id": created.json()["id"],
        "printing_id": str(STRIKE_PRINTING_ID),
        "finish": "nonfoil",
        "condition": "near_mint",
        "quantity": 4,
        "revision": 1,
        "manual_price_usd": None,
        "source_uri": "https://scryfall.com/card/isd/155/lightning-strike",
        "card": created.json()["card"],
    }

    _error(
        member_client.put(
            f"/api/v1/collection/pricing/items/{created.json()['id']}",
            json={"manual_price_usd": "4.25", "expected_revision": 1},
        ),
        404,
        "collection_item_not_found",
    )
    saved = owner_client.put(
        f"/api/v1/collection/pricing/items/{created.json()['id']}",
        json={"manual_price_usd": "4.25", "expected_revision": 1},
    )
    assert saved.status_code == 200
    assert saved.json()["manual_price_usd"] == "4.25"
    assert saved.json()["revision"] == 2
    assert owner_client.get("/api/v1/collection/pricing/missing").json()["total"] == 0

    summary = owner_client.get("/api/v1/collection/summary").json()
    assert summary["estimated_value_usd"] == "17.00"
    assert summary["priced_copies"] == 4
    assert summary["unpriced_copies"] == 0


def test_manual_collection_price_rejects_invalid_or_stale_values(
    app: FastAPI, owner_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    created = _create(owner_client)
    item_id = created.json()["id"]
    _error(
        owner_client.put(
            f"/api/v1/collection/pricing/items/{item_id}",
            json={"manual_price_usd": "-0.01", "expected_revision": 1},
        ),
        422,
        "validation_error",
    )
    saved = owner_client.put(
        f"/api/v1/collection/pricing/items/{item_id}",
        json={"manual_price_usd": "3.50", "expected_revision": 1},
    )
    assert saved.status_code == 200
    _error(
        owner_client.put(
            f"/api/v1/collection/pricing/items/{item_id}",
            json={"manual_price_usd": "4.00", "expected_revision": 1},
        ),
        409,
        "collection_item_stale",
    )


def test_collection_set_filter_normalizes_combines_and_stays_private(
    app: FastAPI, owner_client: TestClient, member_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    assert _create(owner_client, quantity=2).status_code == 201
    assert (
        _create(
            owner_client,
            printing_id=str(BOLT_OTHER_PRINTING_ID),
            finish="foil",
            condition="lightly_played",
            quantity=3,
        ).status_code
        == 201
    )

    m10 = owner_client.get("/api/v1/collection?set=M10")
    assert m10.status_code == 200
    assert [row["card"]["set"]["code"] for row in m10.json()["items"]] == ["M10"]

    combined = owner_client.get("/api/v1/collection?set=%20ISD%20&finish=foil")
    assert combined.status_code == 200
    assert combined.json()["total"] == 1
    assert combined.json()["items"][0]["finish"] == "foil"
    assert combined.json()["items"][0]["card"]["set"]["code"] == "ISD"

    assert owner_client.get("/api/v1/collection?set=unknown").json()["total"] == 0
    assert member_client.get("/api/v1/collection?set=m10").json()["total"] == 0


def test_delete_requires_current_revision_and_preserves_stale_item(
    app: FastAPI, owner_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    missing_revision = _create(owner_client)
    assert missing_revision.status_code == 201
    _error(
        owner_client.delete(f"/api/v1/collection/items/{missing_revision.json()['id']}"),
        422,
        "validation_error",
    )
    created = _create(owner_client, condition="lightly_played")
    assert created.status_code == 201
    updated = owner_client.put(
        f"/api/v1/collection/items/{created.json()['id']}",
        json={"quantity": 4, "expected_revision": 1},
    )
    assert updated.status_code == 200
    _error(
        owner_client.delete(
            f"/api/v1/collection/items/{created.json()['id']}",
            params={"expected_revision": 1},
        ),
        409,
        "collection_item_stale",
    )
    remaining = owner_client.get("/api/v1/collection", params={"condition": "lightly_played"})
    assert remaining.status_code == 200
    assert remaining.json()["items"][0]["quantity"] == 4
    assert remaining.json()["items"][0]["revision"] == 2
