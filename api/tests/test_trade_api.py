import asyncio
import uuid
from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from test_admin_api import _authenticated_client
from test_catalog_api import (
    BOLT_OTHER_PRINTING_ID,
    BOLT_PRINTING_ID,
    STRIKE_PRINTING_ID,
    _seed_catalog,
)

from app.models import Role, TradeStrike, User

MEMBER_A_ID = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
MEMBER_B_ID = uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
OWNER_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")


@pytest.fixture(autouse=True)
def enable_underlying_trading_contract(app: FastAPI) -> None:
    app.state.settings.trading_enabled = True


@pytest.fixture
def member_a(app: FastAPI) -> Iterator[TestClient]:
    with _authenticated_client(
        app,
        user_id=MEMBER_A_ID,
        role=Role.MEMBER,
        email="member-070ed5d29e71@example.invalid",
        display_name="Trader Alpha",
    ) as client:
        yield client


@pytest.fixture
def member_b(app: FastAPI) -> Iterator[TestClient]:
    with _authenticated_client(
        app,
        user_id=MEMBER_B_ID,
        role=Role.MEMBER,
        email="member-96357119abbb@example.invalid",
        display_name="Trader Beta",
    ) as client:
        yield client


@pytest.fixture
def owner(app: FastAPI) -> Iterator[TestClient]:
    with _authenticated_client(
        app,
        user_id=OWNER_ID,
        role=Role.OWNER,
        email="member-dfa9cd9a6129@example.invalid",
        display_name="Wynter Owner",
    ) as client:
        yield client


def _collection_item(
    client: TestClient, quantity=4, printing_id=BOLT_PRINTING_ID, finish="nonfoil"
):
    response = client.post(
        "/api/v1/collection/items",
        json={
            "printing_id": str(printing_id),
            "finish": finish,
            "condition": "near_mint",
            "quantity": quantity,
        },
    )
    assert response.status_code == 201
    return response.json()


def test_trading_routes_exist_and_require_ready_auth(client):
    assert client.get("/api/v1/trading/account").status_code == 401
    assert client.get("/api/v1/trades").status_code == 401
    assert client.get("/api/v1/wants").status_code == 401
    assert client.get("/api/v1/trade-matches").status_code == 401
    assert client.post("/api/v1/trade-reports", json={}).status_code == 401
    assert client.get("/api/v1/admin/trade-moderation/reports").status_code == 401


def test_matches_disclose_only_display_name_and_listed_card_details(
    app: FastAPI, member_a: TestClient, member_b: TestClient
):
    asyncio.run(_seed_catalog(app))
    item = _collection_item(member_b)
    trade = member_b.post(
        "/api/v1/trades",
        json={"collection_item_id": item["id"], "quantity": 2},
    )
    assert trade.status_code == 201
    want = member_a.post(
        "/api/v1/wants",
        json={"oracle_id": trade.json()["oracle_id"], "quantity": 1},
    )
    assert want.status_code == 201

    response = member_a.get("/api/v1/trade-matches")
    assert response.status_code == 200
    match = response.json()["items"][0]
    assert match["member_display_name"] == "Trader Beta"
    assert match["card_name"] == "Lightning Bolt"
    assert match["available_quantity"] == 2
    serialized = str(response.json()).lower()
    assert "email" not in serialized
    assert "contact" not in serialized
    assert "message" not in serialized


def test_three_upheld_reports_suspend_only_trading_and_remove_active_listings(
    app: FastAPI, member_a: TestClient, member_b: TestClient, owner: TestClient
):
    asyncio.run(_seed_catalog(app))
    items = [
        _collection_item(member_b),
        _collection_item(member_b, printing_id=BOLT_OTHER_PRINTING_ID, finish="foil"),
        _collection_item(member_b, printing_id=STRIKE_PRINTING_ID),
    ]
    trades = [
        member_b.post(
            "/api/v1/trades",
            json={"collection_item_id": item["id"], "quantity": 2},
        ).json()
        for item in items
    ]

    for index in range(3):
        report = member_a.post(
            "/api/v1/trade-reports",
            json={
                "listing_id": trades[index]["id"],
                "reason": "spam",
                "details": f"Evidence {index}",
            },
        )
        assert report.status_code == 201
        decision = owner.post(
            f"/api/v1/admin/trade-moderation/reports/{report.json()['id']}",
            json={
                "action": "uphold",
                "expected_revision": report.json()["revision"],
                "note": "Reviewed evidence",
            },
        )
        assert decision.status_code == 200

    account = member_b.get("/api/v1/trading/account")
    assert account.status_code == 200
    assert account.json()["status"] == "suspended"
    assert account.json()["active_strikes"] == 3
    assert account.json()["support_email"] == "member-dca27ea374b4@example.invalid"
    assert member_b.get("/api/v1/collection").status_code == 200
    assert member_b.get("/api/v1/decks").status_code == 200
    assert member_b.get("/api/v1/trades").json()["items"][0]["status"] == "removed"


async def _active_strike_id(app: FastAPI) -> uuid.UUID:
    async with app.state.session_factory() as database:
        strike = await database.scalar(select(TradeStrike).where(TradeStrike.status == "active"))
        assert strike is not None
        return strike.id


def test_same_member_cannot_turn_one_listing_into_multiple_strikes(
    app: FastAPI, member_a: TestClient, member_b: TestClient, owner: TestClient
):
    asyncio.run(_seed_catalog(app))
    item = _collection_item(member_b)
    trade = member_b.post(
        "/api/v1/trades",
        json={"collection_item_id": item["id"], "quantity": 1},
    ).json()
    report = member_a.post(
        "/api/v1/trade-reports",
        json={"listing_id": trade["id"], "reason": "spam"},
    ).json()
    assert (
        owner.post(
            f"/api/v1/admin/trade-moderation/reports/{report['id']}",
            json={"action": "uphold", "expected_revision": report["revision"]},
        ).status_code
        == 200
    )

    repeated = member_a.post(
        "/api/v1/trade-reports",
        json={"listing_id": trade["id"], "reason": "spam"},
    )

    assert repeated.status_code == 409
    assert repeated.json()["error"]["code"] == "trade_report_exists"
    account = member_b.get("/api/v1/trading/account").json()
    assert account["active_strikes"] == 1
    assert account["status"] == "active"


def test_admin_can_remove_listing_void_strike_and_deactivate_ordinary_member(
    app: FastAPI, member_a: TestClient, member_b: TestClient, owner: TestClient
):
    asyncio.run(_seed_catalog(app))
    item = _collection_item(member_b)
    trade = member_b.post(
        "/api/v1/trades",
        json={"collection_item_id": item["id"], "quantity": 1},
    ).json()

    removed = owner.post(
        f"/api/v1/admin/trade-moderation/listings/{trade['id']}",
        json={"status": "removed", "expected_revision": trade["revision"], "note": "Spam listing"},
    )
    assert removed.status_code == 200
    assert removed.json()["status"] == "removed"

    report = member_a.post(
        "/api/v1/trade-reports",
        json={"listing_id": trade["id"], "reason": "spam"},
    )
    assert report.status_code == 404

    restored = owner.post(
        f"/api/v1/admin/trade-moderation/listings/{trade['id']}",
        json={
            "status": "active",
            "expected_revision": removed.json()["revision"],
            "note": "Restored for review",
        },
    )
    assert restored.status_code == 200
    report = member_a.post(
        "/api/v1/trade-reports",
        json={"listing_id": trade["id"], "reason": "spam"},
    ).json()
    assert (
        owner.post(
            f"/api/v1/admin/trade-moderation/reports/{report['id']}",
            json={"action": "uphold", "expected_revision": report["revision"]},
        ).status_code
        == 200
    )
    strike_id = asyncio.run(_active_strike_id(app))
    queue = owner.get("/api/v1/admin/trade-moderation/reports")
    assert queue.status_code == 200
    upheld = next(row for row in queue.json() if row["id"] == report["id"])
    assert upheld["strike_id"] == str(strike_id)
    assert upheld["strike_revision"] == 1
    assert upheld["strike_status"] == "active"
    voided = owner.post(
        f"/api/v1/admin/trade-moderation/strikes/{strike_id}/void",
        json={"expected_revision": 1, "note": "Appeal evidence accepted"},
    )
    assert voided.status_code == 200
    assert voided.json()["active_strikes"] == 0

    deactivated = owner.post(
        f"/api/v1/admin/trade-moderation/users/{MEMBER_B_ID}/account-status",
        json={"is_active": False, "note": "Owner moderation"},
    )
    assert deactivated.status_code == 204

    async def state():
        async with app.state.session_factory() as database:
            user = await database.get(User, MEMBER_B_ID)
            return user.is_active

    assert asyncio.run(state()) is False
