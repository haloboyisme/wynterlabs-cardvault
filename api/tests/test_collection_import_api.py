from __future__ import annotations

import asyncio
import csv
import io
import uuid
from collections.abc import Iterator
from datetime import timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from test_admin_api import _authenticated_client
from test_catalog_api import BOLT_PRINTING_ID, _seed_catalog

from app.models import CardPrinting, CollectionImportPreview, Role, utcnow


def _error(response, status: int, code: str) -> None:
    assert response.status_code == status
    assert response.json()["error"]["code"] == code


def _csv(printing_id: uuid.UUID = BOLT_PRINTING_ID, quantity: int = 2) -> bytes:
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\r\n")
    writer.writerow(
        (
            "schema_version",
            "scryfall_printing_id",
            "card_name",
            "set_code",
            "collector_number",
            "language",
            "finish",
            "condition",
            "quantity",
        )
    )
    writer.writerow(
        (
            "1",
            str(printing_id),
            "Lightning Bolt",
            "lea",
            "161",
            "en",
            "nonfoil",
            "near_mint",
            str(quantity),
        )
    )
    return stream.getvalue().encode()


@pytest.fixture
def owner_client(app: FastAPI) -> Iterator[TestClient]:
    with _authenticated_client(
        app,
        user_id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
        role=Role.OWNER,
        email="member-b996198b5a95@example.invalid",
        display_name="Wynter Owner",
    ) as client:
        yield client


@pytest.fixture
def member_client(app: FastAPI) -> Iterator[TestClient]:
    with _authenticated_client(
        app,
        user_id=uuid.UUID("44444444-4444-4444-4444-444444444444"),
        role=Role.MEMBER,
        email="member-8be14b2211fd@example.invalid",
        display_name="Wynter Member",
    ) as client:
        yield client


@pytest.fixture
def forced_client(app: FastAPI) -> Iterator[TestClient]:
    with _authenticated_client(
        app,
        user_id=uuid.UUID("33333333-3333-3333-3333-333333333333"),
        role=Role.ADMIN,
        email="member-c0288f5d91b9@example.invalid",
        display_name="Forced",
        must_change_password=True,
    ) as client:
        yield client


async def _expire(app: FastAPI, preview_id: uuid.UUID) -> None:
    async with app.state.session_factory() as database:
        preview = await database.scalar(
            select(CollectionImportPreview).where(CollectionImportPreview.id == preview_id)
        )
        assert preview is not None
        now = utcnow()
        preview.created_at = now - timedelta(hours=2)
        preview.expires_at = now - timedelta(hours=1)
        await database.commit()


async def _stored_preview(app: FastAPI, preview_id: uuid.UUID) -> CollectionImportPreview:
    async with app.state.session_factory() as database:
        preview = await database.scalar(
            select(CollectionImportPreview).where(CollectionImportPreview.id == preview_id)
        )
        assert preview is not None
        database.expunge(preview)
        return preview


async def _set_printing_active(app: FastAPI, active: bool) -> None:
    async with app.state.session_factory() as database:
        printing = await database.scalar(
            select(CardPrinting).where(CardPrinting.id == BOLT_PRINTING_ID)
        )
        assert printing is not None
        printing.active = active
        await database.commit()


def test_collection_import_routes_require_ready_auth(
    client: TestClient, forced_client: TestClient
) -> None:
    _error(
        client.post(
            "/api/v1/collection/imports/preview",
            content=_csv(),
            headers={"content-type": "text/csv"},
        ),
        401,
        "not_authenticated",
    )
    _error(
        forced_client.post(
            "/api/v1/collection/imports/preview",
            content=_csv(),
            headers={"content-type": "text/csv"},
        ),
        403,
        "password_change_required",
    )


def test_preview_confirm_and_export_are_private_and_exact(
    app: FastAPI, owner_client: TestClient, member_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    raw_csv = _csv(quantity=2)
    preview_response = owner_client.post(
        "/api/v1/collection/imports/preview",
        content=raw_csv,
        headers={"content-type": "text/csv"},
    )
    assert preview_response.status_code == 201
    preview = preview_response.json()
    preview_id = preview["id"]
    assert preview["summary"] == {
        "additions": 1,
        "increments": 0,
        "errors": 0,
        "total_rows": 1,
    }
    assert preview["rows"][0]["source_row"] == 2
    assert preview["rows"][0]["classification"] == "addition"
    assert raw_csv.decode() not in str(
        asyncio.run(_stored_preview(app, uuid.UUID(preview_id))).rows
    )

    assert owner_client.get(f"/api/v1/collection/imports/{preview_id}").status_code == 200
    _error(
        member_client.get(f"/api/v1/collection/imports/{preview_id}"),
        404,
        "collection_import_not_found",
    )

    confirmed = owner_client.post(f"/api/v1/collection/imports/{preview_id}/confirm")
    assert confirmed.status_code == 200
    assert confirmed.json()["applied_rows"] == 1
    collection = owner_client.get("/api/v1/collection").json()
    assert collection["total"] == 1
    assert collection["items"][0]["quantity"] == 2
    _error(
        owner_client.post(f"/api/v1/collection/imports/{preview_id}/confirm"),
        409,
        "collection_import_already_confirmed",
    )

    exported = owner_client.get("/api/v1/collection/export.csv")
    assert exported.status_code == 200
    assert exported.headers["content-type"].startswith("text/csv")
    assert "attachment" in exported.headers["content-disposition"]
    assert exported.headers["cache-control"] == "no-store"
    assert str(BOLT_PRINTING_ID) in exported.text
    assert "Lightning Bolt" in exported.text


def test_preview_increment_stale_digest_cancel_and_expiry(
    app: FastAPI, owner_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    created = owner_client.post(
        "/api/v1/collection/items",
        json={
            "printing_id": str(BOLT_PRINTING_ID),
            "finish": "nonfoil",
            "condition": "near_mint",
            "quantity": 2,
        },
    )
    assert created.status_code == 201

    preview = owner_client.post(
        "/api/v1/collection/imports/preview",
        content=_csv(quantity=3),
        headers={"content-type": "text/csv"},
    ).json()
    assert preview["rows"][0]["classification"] == "increment"
    assert preview["rows"][0]["resulting_quantity"] == 5

    changed = owner_client.put(
        f"/api/v1/collection/items/{created.json()['id']}",
        json={"quantity": 4, "expected_revision": 1},
    )
    assert changed.status_code == 200
    _error(
        owner_client.post(f"/api/v1/collection/imports/{preview['id']}/confirm"),
        409,
        "collection_import_stale",
    )

    cancelled = owner_client.delete(f"/api/v1/collection/imports/{preview['id']}")
    assert cancelled.status_code == 204
    _error(
        owner_client.get(f"/api/v1/collection/imports/{preview['id']}"),
        404,
        "collection_import_not_found",
    )

    expiring = owner_client.post(
        "/api/v1/collection/imports/preview",
        content=_csv(quantity=1),
        headers={"content-type": "text/csv"},
    ).json()
    asyncio.run(_expire(app, uuid.UUID(expiring["id"])))
    _error(
        owner_client.post(f"/api/v1/collection/imports/{expiring['id']}/confirm"),
        410,
        "collection_import_expired",
    )


def test_preview_reports_unknown_printing_and_cannot_confirm(
    app: FastAPI, owner_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    preview = owner_client.post(
        "/api/v1/collection/imports/preview",
        content=_csv(uuid.uuid4()),
        headers={"content-type": "text/csv"},
    )
    assert preview.status_code == 201
    body = preview.json()
    assert body["summary"]["errors"] == 1
    assert body["rows"][0]["classification"] == "error"
    assert body["rows"][0]["error_code"] == "printing_not_found"
    _error(
        owner_client.post(f"/api/v1/collection/imports/{body['id']}/confirm"),
        422,
        "collection_import_has_errors",
    )


def test_preview_rejects_wrong_media_type_and_invalid_csv(owner_client: TestClient) -> None:
    _error(
        owner_client.post(
            "/api/v1/collection/imports/preview",
            content=_csv(),
            headers={"content-type": "application/json"},
        ),
        415,
        "unsupported_media_type",
    )
    _error(
        owner_client.post(
            "/api/v1/collection/imports/preview",
            content=b"bad",
            headers={"content-type": "text/csv"},
        ),
        422,
        "invalid_headers",
    )
    _error(
        owner_client.post(
            "/api/v1/collection/imports/preview",
            content=b"x" * (2 * 1024 * 1024 + 1),
            headers={"content-type": "text/csv"},
        ),
        422,
        "file_too_large",
    )


def test_existing_inactive_printing_can_increment_but_not_create(
    app: FastAPI, owner_client: TestClient
) -> None:
    asyncio.run(_seed_catalog(app))
    created = owner_client.post(
        "/api/v1/collection/items",
        json={
            "printing_id": str(BOLT_PRINTING_ID),
            "finish": "nonfoil",
            "condition": "near_mint",
            "quantity": 2,
        },
    )
    assert created.status_code == 201
    asyncio.run(_set_printing_active(app, False))

    increment = owner_client.post(
        "/api/v1/collection/imports/preview",
        content=_csv(quantity=1),
        headers={"content-type": "text/csv"},
    )
    assert increment.status_code == 201
    assert increment.json()["rows"][0]["classification"] == "increment"
    confirmed = owner_client.post(f"/api/v1/collection/imports/{increment.json()['id']}/confirm")
    assert confirmed.status_code == 200
    assert owner_client.get("/api/v1/collection").json()["items"][0]["quantity"] == 3

    new_tuple = _csv(quantity=1).replace(b"near_mint", b"lightly_played")
    preview = owner_client.post(
        "/api/v1/collection/imports/preview",
        content=new_tuple,
        headers={"content-type": "text/csv"},
    )
    assert preview.status_code == 201
    assert preview.json()["rows"][0]["error_code"] == "printing_inactive"
