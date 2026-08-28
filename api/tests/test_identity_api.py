import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import dependencies
from app.dependencies import CurrentAuth
from app.errors import AppError
from app.models import LoginAttempt, Role, User, UserSession
from app.security import hash_password, hash_token, identifier_hash, new_session_token


async def _create_authenticated_user(
    app: FastAPI,
    *,
    role: Role,
    must_change_password: bool,
    email: str,
) -> tuple[str, str, uuid.UUID]:
    temporary_password = "test-only-credential-23fb14b61cf2"
    now = datetime.now(UTC)
    user_id = uuid.uuid4()
    async with app.state.session_factory() as database:
        user = User(
            id=user_id,
            email=email,
            email_normalized=email.lower(),
            display_name="Wynter Administrator",
            display_name_normalized=f"wynter administrator {user_id}",
            password_hash=hash_password(temporary_password),
            role=role,
            is_active=True,
            must_change_password=must_change_password,
            password_changed_at=now,
        )
        database.add(user)
        raw = await _add_session(database, app, user_id, now)
        await database.commit()
    return raw, temporary_password, user_id


async def _add_session(database, app: FastAPI, user_id: uuid.UUID, now: datetime) -> str:
    raw = new_session_token()
    database.add(
        UserSession(
            user_id=user_id,
            token_hash=hash_token(raw, app.state.settings.session_pepper),
            created_at=now,
            expires_at=now + timedelta(hours=1),
            last_seen_at=now,
            client_ip="192.0.2.169",
            user_agent="WynterLabs identity test",
        )
    )
    return raw


async def _add_authenticated_session(app: FastAPI, user_id: uuid.UUID) -> str:
    async with app.state.session_factory() as database:
        raw = await _add_session(database, app, user_id, datetime.now(UTC))
        await database.commit()
        return raw


async def _add_expired_session(app: FastAPI, user_id: uuid.UUID) -> None:
    expired_at = datetime.now(UTC) - timedelta(hours=1)
    async with app.state.session_factory() as database:
        database.add(
            UserSession(
                user_id=user_id,
                token_hash=hash_token(new_session_token(), app.state.settings.session_pepper),
                created_at=expired_at - timedelta(hours=1),
                expires_at=expired_at,
                last_seen_at=expired_at - timedelta(hours=1),
                client_ip="192.0.2.21",
                user_agent="Expired WynterLabs identity test",
            )
        )
        await database.commit()


async def _add_login_attempts(
    app: FastAPI,
    *,
    email: str,
    client_ip: str,
    created_at: datetime,
    count: int,
) -> None:
    identity = identifier_hash(email.lower(), app.state.settings.session_pepper)
    async with app.state.session_factory() as database:
        database.add_all(
            LoginAttempt(
                identifier_hash=identity,
                client_ip=client_ip,
                succeeded=False,
                created_at=created_at,
            )
            for _ in range(count)
        )
        await database.commit()


async def _login_attempt_count(app: FastAPI) -> int:
    async with app.state.session_factory() as database:
        return len(list((await database.scalars(select(LoginAttempt.id))).all()))


async def _login_attempt_created_ats(app: FastAPI) -> list[datetime]:
    async with app.state.session_factory() as database:
        return list((await database.scalars(select(LoginAttempt.created_at))).all())


async def _add_retention_sessions(app: FastAPI, user_id: uuid.UUID, now: datetime) -> None:
    async with app.state.session_factory() as database:
        database.add_all(
            [
                UserSession(
                    user_id=user_id,
                    token_hash=hash_token(new_session_token(), app.state.settings.session_pepper),
                    created_at=now - timedelta(days=32),
                    expires_at=now - timedelta(days=31),
                    last_seen_at=now - timedelta(days=32),
                    client_ip="192.0.2.238",
                    user_agent="Old expired session",
                ),
                UserSession(
                    user_id=user_id,
                    token_hash=hash_token(new_session_token(), app.state.settings.session_pepper),
                    created_at=now - timedelta(days=30),
                    expires_at=now - timedelta(days=29),
                    last_seen_at=now - timedelta(days=30),
                    client_ip="192.0.2.174",
                    user_agent="Recent expired session",
                ),
                UserSession(
                    user_id=user_id,
                    token_hash=hash_token(new_session_token(), app.state.settings.session_pepper),
                    created_at=now - timedelta(days=32),
                    expires_at=now + timedelta(days=1),
                    last_seen_at=now - timedelta(days=32),
                    revoked_at=now - timedelta(days=31),
                    client_ip="192.0.2.103",
                    user_agent="Old revoked session",
                ),
                UserSession(
                    user_id=user_id,
                    token_hash=hash_token(new_session_token(), app.state.settings.session_pepper),
                    created_at=now - timedelta(days=30),
                    expires_at=now + timedelta(days=1),
                    last_seen_at=now - timedelta(days=30),
                    revoked_at=now - timedelta(days=29),
                    client_ip="192.0.2.139",
                    user_agent="Recent revoked session",
                ),
            ]
        )
        await database.commit()


async def _session_user_agents(app: FastAPI, user_id: uuid.UUID) -> set[str]:
    async with app.state.session_factory() as database:
        return set(
            (
                await database.scalars(
                    select(UserSession.user_agent).where(UserSession.user_id == user_id)
                )
            ).all()
        )


async def _session_revocations(app: FastAPI, user_id: uuid.UUID) -> list[datetime | None]:
    async with app.state.session_factory() as database:
        return list(
            (
                await database.scalars(
                    select(UserSession.revoked_at)
                    .where(UserSession.user_id == user_id)
                    .order_by(UserSession.created_at)
                )
            ).all()
        )


async def _password_state(app: FastAPI, user_id: uuid.UUID) -> tuple[bool, datetime]:
    async with app.state.session_factory() as database:
        user = await database.scalar(select(User).where(User.id == user_id))
        assert user is not None
        changed_at = user.password_changed_at
        if changed_at.tzinfo is None:
            changed_at = changed_at.replace(tzinfo=UTC)
        return user.must_change_password, changed_at


def create_authenticated_admin(
    app: FastAPI,
    *,
    must_change_password: bool,
) -> tuple[str, str, uuid.UUID]:
    return asyncio.run(
        _create_authenticated_user(
            app,
            role=Role.ADMIN,
            must_change_password=must_change_password,
            email="member-7de408b17fe5@example.invalid",
        )
    )


def _auth_for_role(role: Role) -> CurrentAuth:
    now = datetime.now(UTC)
    user_id = uuid.uuid4()
    return CurrentAuth(
        user=User(
            id=user_id,
            email=f"{role.value}@wynterlabs.com",
            email_normalized=f"{role.value}@wynterlabs.com",
            display_name=role.value.title(),
            display_name_normalized=f"{role.value}-{user_id}",
            password_hash="not-used",
            role=role,
            is_active=True,
            must_change_password=False,
            password_changed_at=now,
        ),
        session=UserSession(
            user_id=user_id,
            token_hash=uuid.uuid4().hex + uuid.uuid4().hex,
            created_at=now,
            expires_at=now + timedelta(hours=1),
            last_seen_at=now,
            client_ip="192.0.2.11",
            user_agent="WynterLabs authorization test",
        ),
    )


def owner_payload() -> dict[str, str]:
    return {
        "email": "member-51b284fa7c82@example.invalid",
        "display_name": "Wynter Owner",
        "password": "test-only-credential-9ca6000d783f",
    }


def test_readiness_checks_database(client) -> None:
    response = client.get("/api/health/ready")
    assert response.status_code == 200
    assert response.json()["status"] == "ready"


def test_owner_setup_is_secret_protected_and_one_time(client, bootstrap_secret: str) -> None:
    assert client.get("/api/v1/setup/status").json() == {"available": True}

    rejected = client.post(
        "/api/v1/setup/owner",
        json=owner_payload(),
        headers={"X-Bootstrap-Secret": "test-only-credential-886c438a9801"},
    )
    assert rejected.status_code == 403
    assert rejected.json()["error"]["code"] == "invalid_bootstrap_secret"

    created = client.post(
        "/api/v1/setup/owner",
        json=owner_payload(),
        headers={"X-Bootstrap-Secret": bootstrap_secret},
    )
    assert created.status_code == 201
    assert created.json()["role"] == "owner"
    assert created.json()["email"] == "member-b610374a21a3@example.invalid"

    closed = client.post(
        "/api/v1/setup/owner",
        json=owner_payload(),
        headers={"X-Bootstrap-Secret": bootstrap_secret},
    )
    assert closed.status_code == 409
    assert closed.json()["error"]["code"] == "setup_closed"
    assert client.get("/api/v1/setup/status").json() == {"available": False}


def test_identity_contract_includes_admin_and_ready_owner(client, bootstrap_secret: str) -> None:
    created = client.post(
        "/api/v1/setup/owner",
        json=owner_payload(),
        headers={"X-Bootstrap-Secret": bootstrap_secret},
    )
    assert Role.ADMIN.value == "admin"
    assert created.status_code == 201
    assert created.json()["must_change_password"] is False


def test_login_session_and_logout(client, bootstrap_secret: str) -> None:
    client.post(
        "/api/v1/setup/owner",
        json=owner_payload(),
        headers={"X-Bootstrap-Secret": bootstrap_secret},
    )

    failure = client.post(
        "/api/v1/auth/login",
        json={"email": "member-f513e0bde329@example.invalid", "password": "test-only-credential-de36586e5c75"},
    )
    assert failure.status_code == 401
    assert failure.json()["error"]["code"] == "invalid_credentials"

    login = client.post(
        "/api/v1/auth/login",
        json={
            "email": "member-cd0b2b5ffd7d@example.invalid",
            "password": "test-only-credential-dc63f5f71647",
        },
    )
    assert login.status_code == 200
    assert "wynterlabs_session=" in login.headers["set-cookie"]
    assert "HttpOnly" in login.headers["set-cookie"]
    assert "SameSite=lax" in login.headers["set-cookie"]

    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["display_name"] == "Wynter Owner"

    sessions = client.get("/api/v1/account/sessions")
    assert sessions.status_code == 200
    assert len(sessions.json()) == 1
    assert sessions.json()[0]["current"] is True
    assert "token_hash" not in sessions.json()[0]

    logout = client.post("/api/v1/auth/logout")
    assert logout.status_code == 204
    assert client.get("/api/v1/auth/me").status_code == 401


def test_active_session_list_omits_expired_sessions(client: TestClient, app: FastAPI) -> None:
    cookie, _, user_id = create_authenticated_admin(app, must_change_password=False)
    asyncio.run(_add_expired_session(app, user_id))
    client.cookies.set("wynterlabs_session", cookie)

    response = client.get("/api/v1/account/sessions")

    assert response.status_code == 200
    assert len(response.json()) == 1
    assert response.json()[0]["current"] is True


def test_login_returns_the_same_error_for_unknown_user_and_wrong_password(
    client: TestClient,
    bootstrap_secret: str,
) -> None:
    client.post(
        "/api/v1/setup/owner",
        json=owner_payload(),
        headers={"X-Bootstrap-Secret": bootstrap_secret},
    )

    unknown = client.post(
        "/api/v1/auth/login",
        json={"email": "member-133aa30c54bf@example.invalid", "password": "test-only-credential-f05c124ad641"},
    )
    wrong = client.post(
        "/api/v1/auth/login",
        json={"email": "member-6c3c899f1c0e@example.invalid", "password": "test-only-credential-b51397437a4a"},
    )

    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json()["error"]["code"] == wrong.json()["error"]["code"] == "invalid_credentials"
    assert (
        unknown.json()["error"]["message"]
        == wrong.json()["error"]["message"]
        == "Email or password is incorrect."
    )


def test_login_limit_applies_to_shared_ip_without_recording_an_extra_attempt(
    client: TestClient,
    app: FastAPI,
) -> None:
    now = datetime.now(UTC)
    for index in range(10):
        asyncio.run(
            _add_login_attempts(
                app,
                email=f"attempt-{index}@wynterlabs.com",
                client_ip="testclient",
                created_at=now,
                count=1,
            )
        )

    response = client.post(
        "/api/v1/auth/login",
        json={"email": "member-ebc0c03e104c@example.invalid", "password": "test-only-credential-e398e1351d75"},
    )

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "rate_limited"
    assert asyncio.run(_login_attempt_count(app)) == 10


def test_login_limit_applies_to_identifier_across_ips(
    client: TestClient,
    app: FastAPI,
) -> None:
    email = "member-4ff3a29edbee@example.invalid"
    now = datetime.now(UTC)
    for index in range(10):
        asyncio.run(
            _add_login_attempts(
                app,
                email=email,
                client_ip=f"198.51.100.{index}",
                created_at=now,
                count=1,
            )
        )

    blocked = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "test-only-credential-ebc43a238080"},
    )
    assert blocked.status_code == 429


def test_login_limit_ignores_attempts_older_than_the_window(
    client: TestClient,
    app: FastAPI,
) -> None:
    now = datetime.now(UTC)
    asyncio.run(
        _add_login_attempts(
            app,
            email="member-cd1a1b174454@example.invalid",
            client_ip="203.0.113.20",
            created_at=now - timedelta(minutes=6),
            count=10,
        )
    )
    allowed = client.post(
        "/api/v1/auth/login",
        json={"email": "member-5f3ac90115eb@example.invalid", "password": "test-only-credential-79ca73b668e0"},
    )
    assert allowed.status_code == 401
    assert allowed.json()["error"]["code"] == "invalid_credentials"


def test_login_cleanup_is_bounded_and_preserves_the_active_throttle_window(
    client: TestClient,
    app: FastAPI,
) -> None:
    now = datetime.now(UTC)
    asyncio.run(
        _add_login_attempts(
            app,
            email="member-e1b732c1558e@example.invalid",
            client_ip="198.51.100.90",
            created_at=now - timedelta(days=31),
            count=251,
        )
    )
    for index in range(10):
        asyncio.run(
            _add_login_attempts(
                app,
                email=f"recent-{index}@wynterlabs.com",
                client_ip="testclient",
                created_at=now,
                count=1,
            )
        )

    blocked = client.post(
        "/api/v1/auth/login",
        json={"email": "member-e3735c3b7396@example.invalid", "password": "test-only-credential-3e001e0520c1"},
    )

    assert blocked.status_code == 429
    attempts = asyncio.run(_login_attempt_created_ats(app))
    retention_cutoff = (now - timedelta(days=30)).replace(tzinfo=None)
    throttle_cutoff = (now - timedelta(minutes=5)).replace(tzinfo=None)
    old_attempts = [created_at for created_at in attempts if created_at < retention_cutoff]
    recent_attempts = [created_at for created_at in attempts if created_at >= throttle_cutoff]
    assert len(old_attempts) == 1
    assert len(recent_attempts) == 10


def test_login_cleanup_removes_only_old_expired_or_revoked_sessions(
    client: TestClient,
    app: FastAPI,
) -> None:
    _, _, user_id = create_authenticated_admin(app, must_change_password=False)
    now = datetime.now(UTC)
    asyncio.run(_add_retention_sessions(app, user_id, now))

    rejected = client.post(
        "/api/v1/auth/login",
        json={"email": "member-845b7cdf51fb@example.invalid", "password": "test-only-credential-d62a822c18d1"},
    )

    assert rejected.status_code == 401
    user_agents = asyncio.run(_session_user_agents(app, user_id))
    assert "Old expired session" not in user_agents
    assert "Old revoked session" not in user_agents
    assert "Recent expired session" in user_agents
    assert "Recent revoked session" in user_agents
    assert "WynterLabs identity test" in user_agents


def test_forced_password_user_can_only_me_logout_and_change_password(
    client: TestClient, app: FastAPI
) -> None:
    cookie, temporary_password, user_id = create_authenticated_admin(app, must_change_password=True)
    client.cookies.set("wynterlabs_session", cookie)
    must_change_password, original_changed_at = asyncio.run(_password_state(app, user_id))
    assert must_change_password is True

    assert client.get("/api/v1/auth/me").status_code == 200
    logout = client.post("/api/v1/auth/logout")
    assert logout.status_code == 204

    cookie = asyncio.run(_add_authenticated_session(app, user_id))
    asyncio.run(_add_authenticated_session(app, user_id))
    client.cookies.set("wynterlabs_session", cookie)

    denied = client.get("/api/v1/catalog/status")
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "password_change_required"
    account_denied = client.get("/api/v1/account/sessions")
    assert account_denied.status_code == 403
    assert account_denied.json()["error"]["code"] == "password_change_required"

    wrong = client.post(
        "/api/v1/auth/change-password",
        json={
            "current_password": "test-only-credential-b262a10e9319",
            "new_password": "test-only-credential-86eee5efacb0",
        },
    )
    assert wrong.status_code == 400
    assert wrong.json()["error"]["code"] == "current_password_invalid"

    changed = client.post(
        "/api/v1/auth/change-password",
        json={
            "current_password": temporary_password,
            "new_password": "test-only-credential-d5b29782cd03",
        },
    )
    assert changed.status_code == 204
    assert "Max-Age=0" in changed.headers["set-cookie"]
    assert client.get("/api/v1/auth/me").status_code == 401
    revocations = asyncio.run(_session_revocations(app, user_id))
    assert len(revocations) == 3
    assert all(revoked_at is not None for revoked_at in revocations)
    must_change_password, changed_at = asyncio.run(_password_state(app, user_id))
    assert must_change_password is False
    assert changed_at > original_changed_at

    old_login = client.post(
        "/api/v1/auth/login",
        json={"email": "member-144719a1c501@example.invalid", "password": temporary_password},
    )
    assert old_login.status_code == 401
    fresh_login = client.post(
        "/api/v1/auth/login",
        json={
            "email": "member-8559cc556b53@example.invalid",
            "password": "test-only-credential-493d08b9648c",
        },
    )
    assert fresh_login.status_code == 200
    assert fresh_login.json()["status"] == "authenticated"
    assert fresh_login.json()["user"]["must_change_password"] is False


def test_member_cannot_use_catalog_operator_dependency() -> None:
    dependency = getattr(dependencies, "require_catalog_operator", None)
    assert dependency is not None
    with pytest.raises(AppError) as error:
        asyncio.run(dependency(_auth_for_role(Role.MEMBER)))
    assert error.value.status_code == 403
    assert error.value.code == "admin_required"


def test_admin_cannot_use_owner_dependency() -> None:
    dependency = getattr(dependencies, "require_owner", None)
    assert dependency is not None
    with pytest.raises(AppError) as error:
        asyncio.run(dependency(_auth_for_role(Role.ADMIN)))
    assert error.value.status_code == 403
    assert error.value.code == "owner_required"
