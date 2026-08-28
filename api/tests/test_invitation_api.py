import asyncio
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models import AccountInvitation, Role, User, UserSession
from app.security import hash_password, hash_token, new_session_token


async def _make_auth(app: FastAPI, role: Role, forced: bool = False) -> str:
    marker = uuid.uuid4().hex
    now = datetime.now(UTC)
    raw = new_session_token()
    async with app.state.session_factory() as database:
        user = User(
            email=f"{marker}@invalid.local",
            email_normalized=f"{marker}@invalid.local",
            display_name=marker,
            display_name_normalized=marker,
            password_hash=hash_password("existing winter password"),
            role=role,
            owner_slot=1 if role is Role.OWNER else None,
            is_active=True,
            must_change_password=forced,
            password_changed_at=now,
        )
        database.add(user)
        await database.flush()
        database.add(
            UserSession(
                user_id=user.id,
                token_hash=hash_token(raw, app.state.settings.session_pepper),
                created_at=now,
                expires_at=now + timedelta(hours=1),
                last_seen_at=now,
                client_ip="192.0.2.227",
                user_agent="WynterLabs invitation test",
            )
        )
        await database.commit()
    return raw


def _role_client(app: FastAPI, role: Role, forced: bool = False) -> TestClient:
    client = TestClient(app)
    client.cookies.set(app.state.settings.cookie_name, asyncio.run(_make_auth(app, role, forced)))
    return client


@pytest.fixture
def owner(app: FastAPI) -> Iterator[TestClient]:
    with _role_client(app, Role.OWNER) as client:
        yield client


def _create(owner: TestClient) -> dict:
    response = owner.post("/api/v1/admin/invitations")
    assert response.status_code == 201
    return response.json()


def _payload(token: str, marker: str) -> dict[str, str]:
    return {
        "token": token,
        "email": f"{marker}@example.com",
        "display_name": f"{marker.title()} Player",
        "password": "test-only-credential-52f4782b44b0",
    }


def _error(response, status: int, code: str) -> None:
    assert response.status_code == status
    assert response.json()["error"]["code"] == code


def test_owner_create_list_revoke_never_reexposes_token(app: FastAPI, owner: TestClient) -> None:
    created = _create(owner)
    assert len(created["raw_token"]) >= 40
    assert created["status"] == "active"
    expires = datetime.fromisoformat(created["expires_at"])
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=UTC)
    assert timedelta(days=6, hours=23) < (expires - datetime.now(UTC)) <= timedelta(days=7)
    assert created["raw_token"] not in repr(app.state.__dict__)

    listed = owner.get("/api/v1/admin/invitations")
    assert listed.status_code == 200
    assert listed.headers["cache-control"] == "no-store"
    assert listed.json()[0]["id"] == created["id"]
    assert "raw_token" not in listed.text
    assert "token_hash" not in listed.text

    revoked = owner.post(
        f"/api/v1/admin/invitations/{created['id']}/revoke",
        json={"expected_revision": 1},
    )
    assert revoked.status_code == 200
    assert revoked.json()["status"] == "revoked"
    assert revoked.json()["revision"] == 2
    _error(
        owner.post(
            f"/api/v1/admin/invitations/{created['id']}/revoke",
            json={"expected_revision": 1},
        ),
        409,
        "invitation_revision_conflict",
    )
    _error(
        owner.post(
            f"/api/v1/admin/invitations/{uuid.uuid4()}/revoke",
            json={"expected_revision": 1},
        ),
        404,
        "invitation_not_found",
    )


@pytest.mark.parametrize(
    ("role", "forced", "status", "code"),
    [
        (Role.ADMIN, False, 403, "owner_required"),
        (Role.MEMBER, False, 403, "owner_required"),
        (Role.ADMIN, True, 403, "password_change_required"),
    ],
)
def test_only_ready_owner_manages_invitations(
    app: FastAPI, role: Role, forced: bool, status: int, code: str
) -> None:
    with _role_client(app, role, forced) as client:
        _error(client.post("/api/v1/admin/invitations"), status, code)
        _error(client.get("/api/v1/admin/invitations"), status, code)
    with TestClient(app) as anonymous:
        _error(
            anonymous.post("/api/v1/admin/invitations"),
            401,
            "not_authenticated",
        )


def test_accept_once_creates_ready_member_and_session(app: FastAPI, owner: TestClient) -> None:
    created = _create(owner)
    with TestClient(app) as recipient:
        response = recipient.post(
            "/api/v1/invitations/accept",
            json=_payload(created["raw_token"], "newmember"),
        )
        assert response.status_code == 201
        assert response.headers["cache-control"] == "no-store"
        assert response.json()["role"] == "member"
        assert response.json()["must_change_password"] is False
        assert app.state.settings.cookie_name in recipient.cookies
        assert recipient.get("/api/v1/auth/me").status_code == 200

    _error(
        TestClient(app).post(
            "/api/v1/invitations/accept",
            json=_payload(created["raw_token"], "othermember"),
        ),
        400,
        "invitation_invalid",
    )

    async def state() -> tuple[int, int]:
        async with app.state.session_factory() as database:
            users = await database.scalars(
                select(User).where(User.email_normalized == "newmember@example.com")
            )
            invitation = await database.get(AccountInvitation, uuid.UUID(created["id"]))
            assert invitation is not None and invitation.used_at is not None
            sessions = await database.scalars(
                select(UserSession).where(UserSession.user_id == invitation.used_by_user_id)
            )
            return len(list(users.all())), len(list(sessions.all()))

    assert asyncio.run(state()) == (1, 1)


def test_invalid_revoked_and_expired_tokens_share_generic_error(
    app: FastAPI, owner: TestClient
) -> None:
    _error(
        TestClient(app).post(
            "/api/v1/invitations/accept",
            json=_payload("not-a-real-invitation-token", "invalid"),
        ),
        400,
        "invitation_invalid",
    )
    revoked = _create(owner)
    owner.post(
        f"/api/v1/admin/invitations/{revoked['id']}/revoke",
        json={"expected_revision": 1},
    )
    _error(
        TestClient(app).post(
            "/api/v1/invitations/accept",
            json=_payload(revoked["raw_token"], "revoked"),
        ),
        400,
        "invitation_invalid",
    )
    expired = _create(owner)

    async def expire() -> None:
        async with app.state.session_factory() as database:
            invitation = await database.get(AccountInvitation, uuid.UUID(expired["id"]))
            assert invitation is not None
            invitation.created_at = datetime.now(UTC) - timedelta(days=1)
            invitation.expires_at = datetime.now(UTC) - timedelta(seconds=1)
            await database.commit()

    asyncio.run(expire())
    _error(
        TestClient(app).post(
            "/api/v1/invitations/accept",
            json=_payload(expired["raw_token"], "expired"),
        ),
        400,
        "invitation_invalid",
    )


def test_acceptance_validates_identity_password_and_rate_limit(
    app: FastAPI, owner: TestClient
) -> None:
    created = _create(owner)
    weak = TestClient(app).post(
        "/api/v1/invitations/accept",
        json={**_payload(created["raw_token"], "weak"), "password": "test-only-credential-a793c9a1ca16"},
    )
    assert weak.status_code == 422
    owner_user = owner.get("/api/v1/auth/me").json()
    conflict = TestClient(app).post(
        "/api/v1/invitations/accept",
        json={
            **_payload(created["raw_token"], "conflict"),
            "display_name": owner_user["display_name"],
        },
    )
    _error(conflict, 409, "invitation_identity_conflict")

    client = TestClient(app)
    for index in range(10):
        response = client.post(
            "/api/v1/invitations/accept",
            json=_payload(f"invalid-token-{index:02d}-padding", f"limited{index}"),
        )
        _error(response, 400, "invitation_invalid")
    _error(
        client.post(
            "/api/v1/invitations/accept",
            json=_payload("invalid-token-last-padding", "limitedlast"),
        ),
        429,
        "rate_limited",
    )
