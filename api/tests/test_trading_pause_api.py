import uuid
from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event
from test_admin_api import _authenticated_client

from app.models import Role

MEMBER_ID = uuid.UUID("44444444-4444-4444-4444-444444444444")
OWNER_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
ROW_ID = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")


@pytest.fixture
def member(app: FastAPI) -> Iterator[TestClient]:
    with _authenticated_client(
        app,
        user_id=MEMBER_ID,
        role=Role.MEMBER,
        email="member-598e304b7535@example.invalid",
        display_name="Paused Member",
    ) as client:
        yield client


@pytest.fixture
def owner(app: FastAPI) -> Iterator[TestClient]:
    with _authenticated_client(
        app,
        user_id=OWNER_ID,
        role=Role.OWNER,
        email="member-97becd358ab6@example.invalid",
        display_name="Wynter Owner",
    ) as client:
        yield client


def _paused(response) -> None:
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "trading_paused"


def test_member_trade_discovery_and_mutations_are_paused_before_validation(
    member: TestClient,
) -> None:
    requests = [
        ("get", "/api/v1/trades", None),
        ("post", "/api/v1/trades", {}),
        ("put", f"/api/v1/trades/{ROW_ID}", {}),
        ("delete", f"/api/v1/trades/{ROW_ID}", None),
        ("get", "/api/v1/wants", None),
        ("post", "/api/v1/wants", {}),
        ("put", f"/api/v1/wants/{ROW_ID}", {}),
        ("delete", f"/api/v1/wants/{ROW_ID}", None),
        ("get", "/api/v1/trade-matches", None),
        ("post", "/api/v1/trade-reports", {}),
        ("get", "/api/v1/trade-reports", None),
    ]
    for method, path, body in requests:
        call = getattr(member, method)
        response = call(path, json=body) if body is not None else call(path)
        _paused(response)


def test_account_enforcement_and_owner_moderation_remain_available(
    member: TestClient, owner: TestClient
) -> None:
    account = member.get("/api/v1/trading/account")
    assert account.status_code == 200
    assert account.json()["status"] == "active"

    moderation = owner.get("/api/v1/admin/trade-moderation/reports")
    assert moderation.status_code == 200
    assert moderation.json() == []


def test_paused_member_request_never_queries_trading_data(app: FastAPI, member: TestClient) -> None:
    statements: list[str] = []

    def capture(_connection, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement.lower())

    engine = app.state.session_factory.kw["bind"]
    event.listen(engine.sync_engine, "before_cursor_execute", capture)
    try:
        response = member.get("/api/v1/trades")
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", capture)

    _paused(response)
    assert not any(
        table in statement
        for statement in statements
        for table in ("trade_listings", "want_listings", "trade_reports")
    )
