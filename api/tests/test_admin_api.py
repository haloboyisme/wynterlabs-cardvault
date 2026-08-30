import asyncio
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from test_catalog_api import BOLT_PRINTING_ID, _seed_catalog

from app.catalog.importer import ImportOutcome
from app.models import (
    CardPrinting,
    CollectionItem,
    CollectionValueSnapshot,
    Role,
    User,
    UserSession,
)
from app.routers import admin as admin_router
from app.security import (
    hash_password,
    hash_token,
    new_session_token,
    verify_password,
)

OWNER_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
ADMIN_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")
FORCED_ADMIN_ID = uuid.UUID("33333333-3333-3333-3333-333333333333")
MEMBER_ID = uuid.UUID("44444444-4444-4444-4444-444444444444")


async def _create_authenticated_user(
    app: FastAPI,
    *,
    user_id: uuid.UUID,
    role: Role,
    email: str,
    display_name: str,
    must_change_password: bool = False,
) -> str:
    now = datetime.now(UTC)
    raw = new_session_token()
    async with app.state.session_factory() as database:
        database.add(
            User(
                id=user_id,
                email=email,
                email_normalized=email.casefold(),
                display_name=display_name,
                display_name_normalized=display_name.casefold(),
                password_hash=hash_password("existing winter password"),
                role=role,
                owner_slot=1 if role is Role.OWNER else None,
                is_active=True,
                must_change_password=must_change_password,
                password_changed_at=now,
            )
        )
        database.add(
            UserSession(
                user_id=user_id,
                token_hash=hash_token(raw, app.state.settings.session_pepper),
                created_at=now,
                expires_at=now + timedelta(hours=1),
                last_seen_at=now,
                client_ip="192.0.2.101",
                user_agent="WynterLabs administrator test",
            )
        )
        await database.commit()
    return raw


def _authenticated_client(
    app: FastAPI,
    *,
    user_id: uuid.UUID,
    role: Role,
    email: str,
    display_name: str,
    must_change_password: bool = False,
) -> TestClient:
    raw = asyncio.run(
        _create_authenticated_user(
            app,
            user_id=user_id,
            role=role,
            email=email,
            display_name=display_name,
            must_change_password=must_change_password,
        )
    )
    client = TestClient(app)
    client.cookies.set(app.state.settings.cookie_name, raw)
    return client


@pytest.fixture
def owner_client(app: FastAPI) -> Iterator[TestClient]:
    with _authenticated_client(
        app,
        user_id=OWNER_ID,
        role=Role.OWNER,
        email="member-93f07b124c37@example.invalid",
        display_name="Wynter Owner",
    ) as client:
        yield client


@pytest.fixture
def admin_client(app: FastAPI) -> Iterator[TestClient]:
    with _authenticated_client(
        app,
        user_id=ADMIN_ID,
        role=Role.ADMIN,
        email="member-fa64201610e9@example.invalid",
        display_name="Ready Administrator",
    ) as client:
        yield client


@pytest.fixture
def forced_admin_client(app: FastAPI) -> Iterator[TestClient]:
    with _authenticated_client(
        app,
        user_id=FORCED_ADMIN_ID,
        role=Role.ADMIN,
        email="member-0060c5387aef@example.invalid",
        display_name="Forced Administrator",
        must_change_password=True,
    ) as client:
        yield client


@pytest.fixture
def member_client(app: FastAPI) -> Iterator[TestClient]:
    with _authenticated_client(
        app,
        user_id=MEMBER_ID,
        role=Role.MEMBER,
        email="member-d5489ea81c72@example.invalid",
        display_name="Wynter Member",
    ) as client:
        yield client


async def _create_session(app: FastAPI, user_id: uuid.UUID) -> None:
    now = datetime.now(UTC)
    async with app.state.session_factory() as database:
        database.add(
            UserSession(
                user_id=user_id,
                token_hash=hash_token(new_session_token(), app.state.settings.session_pepper),
                created_at=now,
                expires_at=now + timedelta(hours=1),
                last_seen_at=now,
                client_ip="192.0.2.186",
                user_agent="WynterLabs administrator target session",
            )
        )
        await database.commit()


async def _admin_state(app: FastAPI, user_id: uuid.UUID) -> User:
    async with app.state.session_factory() as database:
        user = await database.scalar(select(User).where(User.id == user_id))
        assert user is not None
        database.expunge(user)
        return user


async def _session_revocations(app: FastAPI, user_id: uuid.UUID) -> list[datetime | None]:
    async with app.state.session_factory() as database:
        result = await database.scalars(
            select(UserSession.revoked_at)
            .where(UserSession.user_id == user_id)
            .order_by(UserSession.created_at)
        )
        return list(result.all())


def _assert_error(response, status_code: int, code: str) -> None:
    assert response.status_code == status_code
    assert response.json()["error"]["code"] == code


class FakeCatalogImporter:
    def __init__(
        self,
        outcome: ImportOutcome | None = None,
        error: Exception | None = None,
    ) -> None:
        self.outcome = outcome
        self.error = error
        self.games: list[str | None] = []

    async def refresh(self, game: str | None = None) -> ImportOutcome:
        self.games.append(game)
        if self.error is not None:
            raise self.error
        assert self.outcome is not None
        return self.outcome


def _override_catalog_importer(app: FastAPI, importer: FakeCatalogImporter):
    dependency = getattr(admin_router, "get_catalog_importer", None)
    if dependency is not None:
        app.dependency_overrides[dependency] = lambda: importer
    return dependency


async def _add_collection_item(app: FastAPI, user_id: uuid.UUID) -> None:
    async with app.state.session_factory() as database:
        printing = await database.get(CardPrinting, BOLT_PRINTING_ID)
        assert printing is not None
        database.add(
            CollectionItem(
                user_id=user_id,
                printing_id=printing.id,
                finish="nonfoil",
                condition="near_mint",
                quantity=2,
            )
        )
        await database.commit()


@pytest.mark.parametrize("client_fixture", ["owner_client", "admin_client"])
def test_catalog_status_is_available_to_ready_owner_and_admin(request, client_fixture: str) -> None:
    client = request.getfixturevalue(client_fixture)
    response = client.get("/api/v1/admin/catalog/status")
    assert response.status_code == 200
    assert response.json() == {
        "active_catalog": None,
        "latest_attempt": None,
        "games": {
            "mtg": {"active_catalog": None, "latest_attempt": None},
            "pokemon": {"active_catalog": None, "latest_attempt": None},
            "yugioh": {"active_catalog": None, "latest_attempt": None},
            "onepiece": {"active_catalog": None, "latest_attempt": None},
        },
    }


def test_catalog_status_matches_the_sanitized_cli_contract(
    owner_client: TestClient, monkeypatch
) -> None:
    import_id = uuid.uuid4()
    expected_attempt = {
        "import_id": str(import_id),
        "status": "complete",
        "source_updated_at": "2026-08-14T01:02:03+00:00",
        "completed_at": "2026-08-14T01:02:03+00:00",
        "total_records": 116703,
        "imported_records": 116703,
        "rejected_records": 0,
        "set_count": 1047,
        "oracle_count": 38626,
        "printing_count": 116703,
        "error_summary": None,
    }

    async def cli_status_shape(_session_factory):
        return {
            "active_catalog": expected_attempt,
            "latest_attempt": expected_attempt,
        }

    monkeypatch.setattr(admin_router, "read_catalog_status", cli_status_shape)
    response = owner_client.get("/api/v1/admin/catalog/status")
    assert response.status_code == 200
    assert response.json() == {
        "active_catalog": expected_attempt,
        "latest_attempt": expected_attempt,
        "games": {},
    }
    assert "source_uri" not in response.text


def test_catalog_refresh_accepts_supported_games_and_rejects_unknown(
    owner_client: TestClient, app: FastAPI
) -> None:
    importer = FakeCatalogImporter(ImportOutcome("complete", uuid.uuid4(), 2, 0, False))
    dependency = _override_catalog_importer(app, importer)
    try:
        response = owner_client.post("/api/v1/admin/catalog/refresh?game=pokemon")
        invalid = owner_client.post("/api/v1/admin/catalog/refresh?game=lorcana")
    finally:
        if dependency is not None:
            app.dependency_overrides.pop(dependency, None)
    assert response.status_code == 200
    assert importer.games == ["pokemon"]
    assert invalid.status_code == 422


def test_completed_catalog_refresh_captures_price_snapshot_for_each_collection_owner(
    owner_client: TestClient,
    app: FastAPI,
) -> None:
    asyncio.run(_seed_catalog(app))
    asyncio.run(_add_collection_item(app, OWNER_ID))
    dependency = _override_catalog_importer(
        app,
        FakeCatalogImporter(ImportOutcome("complete", uuid.uuid4(), 2, 0, False)),
    )
    try:
        response = owner_client.post("/api/v1/admin/catalog/refresh")
    finally:
        if dependency is not None:
            app.dependency_overrides.pop(dependency, None)

    async def snapshots() -> list[CollectionValueSnapshot]:
        async with app.state.session_factory() as database:
            result = await database.scalars(
                select(CollectionValueSnapshot).where(CollectionValueSnapshot.user_id == OWNER_ID)
            )
            return list(result.all())

    captured = asyncio.run(snapshots())
    assert response.status_code == 200
    assert len(captured) == 1
    assert captured[0].trigger == "price"


def test_catalog_refresh_succeeds_when_price_snapshot_capture_fails(
    owner_client: TestClient,
    app: FastAPI,
    monkeypatch,
) -> None:
    async def fail_capture(*_args, **_kwargs) -> None:
        raise RuntimeError("snapshot storage unavailable")

    monkeypatch.setattr(admin_router, "capture_collection_price_snapshots", fail_capture)
    dependency = _override_catalog_importer(
        app,
        FakeCatalogImporter(ImportOutcome("complete", uuid.uuid4(), 2, 0, False)),
    )
    try:
        response = owner_client.post("/api/v1/admin/catalog/refresh")
    finally:
        if dependency is not None:
            app.dependency_overrides.pop(dependency, None)

    assert response.status_code == 200


@pytest.mark.parametrize("client_fixture", ["owner_client", "admin_client"])
def test_catalog_refresh_returns_complete_and_unchanged_outcomes(
    request, client_fixture: str, app: FastAPI
) -> None:
    client = request.getfixturevalue(client_fixture)
    complete_id = uuid.uuid4()
    dependency = _override_catalog_importer(
        app,
        FakeCatalogImporter(ImportOutcome("complete", complete_id, 116703, 0, False)),
    )
    try:
        complete = client.post("/api/v1/admin/catalog/refresh")
        assert complete.status_code == 200
        assert complete.json() == {
            "status": "complete",
            "import_id": str(complete_id),
            "imported_records": 116703,
            "rejected_records": 0,
            "skipped": False,
        }

        unchanged_id = uuid.uuid4()
        _override_catalog_importer(
            app,
            FakeCatalogImporter(ImportOutcome("unchanged", unchanged_id, 116703, 0, True)),
        )
        unchanged = client.post("/api/v1/admin/catalog/refresh")
        assert unchanged.status_code == 200
        assert unchanged.json()["status"] == "unchanged"
        assert unchanged.json()["import_id"] == str(unchanged_id)
        assert unchanged.json()["skipped"] is True
    finally:
        if dependency is not None:
            app.dependency_overrides.pop(dependency, None)


def test_catalog_refresh_busy_is_a_controlled_conflict(
    owner_client: TestClient, app: FastAPI
) -> None:
    dependency = _override_catalog_importer(
        app,
        FakeCatalogImporter(ImportOutcome("busy", None, 0, 0, True)),
    )
    try:
        response = owner_client.post("/api/v1/admin/catalog/refresh")
    finally:
        if dependency is not None:
            app.dependency_overrides.pop(dependency, None)
    _assert_error(response, 409, "catalog_refresh_busy")


def test_catalog_refresh_failure_does_not_leak_exception_context(
    owner_client: TestClient, app: FastAPI
) -> None:
    dependency = _override_catalog_importer(
        app,
        FakeCatalogImporter(error=RuntimeError("postgres password=/run/secrets/db_password")),
    )
    try:
        response = owner_client.post("/api/v1/admin/catalog/refresh")
    finally:
        if dependency is not None:
            app.dependency_overrides.pop(dependency, None)
    _assert_error(response, 503, "catalog_refresh_failed")
    body = response.text.lower()
    assert "postgres" not in body
    assert "password" not in body
    assert "/run/secrets" not in body


@pytest.mark.parametrize(
    ("client_fixture", "status_code", "code"),
    [
        ("member_client", 403, "admin_required"),
        ("forced_admin_client", 403, "password_change_required"),
    ],
)
def test_catalog_operations_deny_member_and_forced_admin(
    request,
    client_fixture: str,
    status_code: int,
    code: str,
    app: FastAPI,
) -> None:
    client = request.getfixturevalue(client_fixture)
    dependency = _override_catalog_importer(
        app,
        FakeCatalogImporter(ImportOutcome("complete", uuid.uuid4(), 116703, 0, False)),
    )
    try:
        responses = [
            client.get("/api/v1/admin/catalog/status"),
            client.post("/api/v1/admin/catalog/refresh"),
        ]
    finally:
        if dependency is not None:
            app.dependency_overrides.pop(dependency, None)
    for response in responses:
        _assert_error(response, status_code, code)


def test_catalog_operations_deny_unauthenticated_clients(app: FastAPI) -> None:
    dependency = _override_catalog_importer(
        app,
        FakeCatalogImporter(ImportOutcome("complete", uuid.uuid4(), 116703, 0, False)),
    )
    try:
        with TestClient(app) as anonymous:
            responses = [
                anonymous.get("/api/v1/admin/catalog/status"),
                anonymous.post("/api/v1/admin/catalog/refresh"),
            ]
    finally:
        if dependency is not None:
            app.dependency_overrides.pop(dependency, None)
    for response in responses:
        _assert_error(response, 401, "not_authenticated")


def test_owner_creates_lists_disables_reactivates_and_resets_admin(
    owner_client: TestClient, app: FastAPI
) -> None:
    first_password = "test-only-credential-30891ce093aa"
    created = owner_client.post(
        "/api/v1/admin/users",
        json={
            "email": "member-cf6df92bcb2d@example.invalid",
            "display_name": "  Catalog   Admin  ",
            "temporary_password": first_password,
        },
    )
    assert created.status_code == 201
    assert created.json()["email"] == "member-ac766466aaa6@example.invalid"
    assert created.json()["display_name"] == "Catalog Admin"
    assert created.json()["role"] == "admin"
    assert created.json()["is_active"] is True
    assert created.json()["must_change_password"] is True
    assert first_password not in created.text
    assert "temporary_password" not in created.json()
    assert "password_hash" not in created.json()

    admin_id = uuid.UUID(created.json()["id"])
    admin = asyncio.run(_admin_state(app, admin_id))
    assert admin.owner_slot is None
    assert verify_password(first_password, admin.password_hash)

    listed = owner_client.get("/api/v1/admin/users")
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [str(admin_id)]
    assert str(OWNER_ID) not in listed.text

    asyncio.run(_create_session(app, admin_id))
    asyncio.run(_create_session(app, admin_id))
    disabled = owner_client.patch(
        f"/api/v1/admin/users/{admin_id}/status",
        json={"is_active": False},
    )
    assert disabled.status_code == 200
    assert disabled.json()["is_active"] is False
    assert all(
        revoked_at is not None for revoked_at in asyncio.run(_session_revocations(app, admin_id))
    )

    reactivated = owner_client.patch(
        f"/api/v1/admin/users/{admin_id}/status",
        json={"is_active": True},
    )
    assert reactivated.status_code == 200
    assert reactivated.json()["is_active"] is True

    asyncio.run(_create_session(app, admin_id))
    asyncio.run(_create_session(app, admin_id))
    before_reset = asyncio.run(_admin_state(app, admin_id)).password_changed_at
    second_password = "test-only-credential-71e3701a687e"
    reset = owner_client.post(
        f"/api/v1/admin/users/{admin_id}/reset-password",
        json={"temporary_password": second_password},
    )
    assert reset.status_code == 200
    assert reset.json()["must_change_password"] is True
    assert second_password not in reset.text

    after_reset = asyncio.run(_admin_state(app, admin_id))
    assert verify_password(second_password, after_reset.password_hash)
    assert not verify_password(first_password, after_reset.password_hash)
    assert after_reset.password_changed_at > before_reset
    assert all(
        revoked_at is not None for revoked_at in asyncio.run(_session_revocations(app, admin_id))
    )


def test_normalized_admin_identity_conflicts_and_weak_passwords_are_controlled(
    owner_client: TestClient,
) -> None:
    payload = {
        "email": "member-12e43ef62fc1@example.invalid",
        "display_name": "Catalog Admin",
        "temporary_password": "test-only-credential-9a3d1eaaf7b2",
    }
    assert owner_client.post("/api/v1/admin/users", json=payload).status_code == 201

    duplicate_email = owner_client.post(
        "/api/v1/admin/users",
        json={**payload, "email": "member-75b92f708745@example.invalid", "display_name": "Other Admin"},
    )
    _assert_error(duplicate_email, 409, "admin_identity_conflict")

    duplicate_name = owner_client.post(
        "/api/v1/admin/users",
        json={
            **payload,
            "email": "member-2f39a37ba301@example.invalid",
            "display_name": "  CATALOG   ADMIN ",
        },
    )
    _assert_error(duplicate_name, 409, "admin_identity_conflict")

    weak = owner_client.post(
        "/api/v1/admin/users",
        json={**payload, "email": "member-e0580bbdda09@example.invalid", "temporary_password": "test-only-credential-116db0267378"},
    )
    _assert_error(weak, 422, "validation_error")


@pytest.mark.parametrize("client_fixture", ["admin_client", "member_client"])
def test_non_owners_are_denied_every_account_management_endpoint(
    request, client_fixture: str
) -> None:
    client = request.getfixturevalue(client_fixture)
    target_id = uuid.uuid4()
    responses = [
        client.get("/api/v1/admin/users"),
        client.post(
            "/api/v1/admin/users",
            json={
                "email": "member-d7627c756253@example.invalid",
                "display_name": "New Administrator",
                "temporary_password": "test-only-credential-388b2e1c70cf",
            },
        ),
        client.patch(f"/api/v1/admin/users/{target_id}/status", json={"is_active": False}),
        client.post(
            f"/api/v1/admin/users/{target_id}/reset-password",
            json={"temporary_password": "test-only-credential-2a9e3f56ea21"},
        ),
    ]
    for response in responses:
        _assert_error(response, 403, "owner_required")


def test_forced_and_unauthenticated_users_cannot_manage_accounts(
    forced_admin_client: TestClient, app: FastAPI
) -> None:
    forced = forced_admin_client.get("/api/v1/admin/users")
    _assert_error(forced, 403, "password_change_required")

    with TestClient(app) as anonymous:
        unauthenticated = anonymous.get("/api/v1/admin/users")
    _assert_error(unauthenticated, 401, "not_authenticated")


def test_owner_and_member_targets_are_indistinguishable_from_missing(
    owner_client: TestClient, app: FastAPI
) -> None:
    asyncio.run(
        _create_authenticated_user(
            app,
            user_id=MEMBER_ID,
            role=Role.MEMBER,
            email="member-cd7de4f91ff0@example.invalid",
            display_name="Wynter Member",
        )
    )
    for target_id in (OWNER_ID, MEMBER_ID, uuid.uuid4()):
        status = owner_client.patch(
            f"/api/v1/admin/users/{target_id}/status", json={"is_active": False}
        )
        _assert_error(status, 404, "admin_not_found")
        reset = owner_client.post(
            f"/api/v1/admin/users/{target_id}/reset-password",
            json={"temporary_password": "test-only-credential-8624ceab9961"},
        )
        _assert_error(reset, 404, "admin_not_found")

    listed = owner_client.get("/api/v1/admin/users")
    assert listed.status_code == 200
    assert listed.json() == []
