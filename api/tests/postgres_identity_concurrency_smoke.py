import asyncio
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app import mfa_service
from app.config import Settings
from app.main import create_app
from app.models import LoginAttempt, User, UserSession
from app.routers import auth as auth_router
from app.security import verify_password

OWNER_PASSWORD = "test-only-credential-9fc690f7f682"
INITIAL_ADMIN_PASSWORD = "test-only-credential-10450a21eeb3"
OWNER_LOGIN_RESET_PASSWORD = "test-only-credential-0d3beb0834c0"
OWNER_CHANGE_RESET_PASSWORD = "test-only-credential-e984ee0f9d5e"
OWNER_PRELOAD_RESET_PASSWORD = "test-only-credential-4ab7c1715fb6"
ADMIN_CHANGED_PASSWORD = "test-only-credential-62e06beacf71"


@dataclass
class Harness:
    app: FastAPI
    owner: TestClient
    admin_id: uuid.UUID
    session_factory: async_sessionmaker[AsyncSession]


async def clear_identity_tables(factory: async_sessionmaker[AsyncSession]) -> None:
    async with factory() as database:
        await database.execute(delete(LoginAttempt))
        await database.execute(delete(UserSession))
        await database.execute(delete(User))
        await database.commit()


async def credential_state(
    factory: async_sessionmaker[AsyncSession],
    user_id: uuid.UUID,
) -> tuple[str, bool, int]:
    async with factory() as database:
        user = await database.scalar(select(User).where(User.id == user_id))
        assert user is not None
        active_sessions = await database.scalar(
            select(UserSession)
            .where(
                UserSession.user_id == user_id,
                UserSession.revoked_at.is_(None),
            )
            .with_only_columns(UserSession.id)
        )
        active_count = 0 if active_sessions is None else 1
        if active_count:
            remaining = await database.scalars(
                select(UserSession.id).where(
                    UserSession.user_id == user_id,
                    UserSession.revoked_at.is_(None),
                )
            )
            active_count = len(list(remaining.all()))
        return user.password_hash, user.must_change_password, active_count


@pytest.fixture
def harness(tmp_path: Path):
    database_url = os.environ["CARDS_TEST_DATABASE_URL"]
    bootstrap_file = tmp_path / "bootstrap_secret"
    bootstrap_file.write_text("identity-concurrency-bootstrap")
    pepper_file = tmp_path / "session_pepper"
    mfa_key_file = tmp_path / "mfa_key"
    pepper_file.write_text("p" * 64)
    mfa_key_file.write_bytes(bytes(range(32)))
    settings = Settings(
        database_url=database_url,
        bootstrap_secret_file=str(bootstrap_file),
        session_pepper_file=str(pepper_file),
        mfa_encryption_key_file=str(mfa_key_file),
        environment="development",
    )
    engine = create_async_engine(database_url, poolclass=NullPool)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    asyncio.run(clear_identity_tables(factory))
    app = create_app(settings=settings, session_factory=factory)

    with TestClient(app) as owner:
        created_owner = owner.post(
            "/api/v1/setup/owner",
            json={
                "email": "member-872764100c46@example.invalid",
                "display_name": "Wynter Owner",
                "password": OWNER_PASSWORD,
            },
            headers={"X-Bootstrap-Secret": "test-only-credential-654cb9a58390"},
        )
        assert created_owner.status_code == 201
        owner_login = owner.post(
            "/api/v1/auth/login",
            json={"email": "member-2406f1a55267@example.invalid", "password": OWNER_PASSWORD},
        )
        assert owner_login.status_code == 200
        created_admin = owner.post(
            "/api/v1/admin/users",
            json={
                "email": "member-cb02e1d7fea4@example.invalid",
                "display_name": "Catalog Admin",
                "temporary_password": INITIAL_ADMIN_PASSWORD,
            },
        )
        assert created_admin.status_code == 201
        yield Harness(
            app=app,
            owner=owner,
            admin_id=uuid.UUID(created_admin.json()["id"]),
            session_factory=factory,
        )

    asyncio.run(engine.dispose())


def reset_owner_password(harness: Harness, password: str):
    return harness.owner.post(
        f"/api/v1/admin/users/{harness.admin_id}/reset-password",
        json={"temporary_password": password},
    )


def test_owner_reset_serializes_with_old_password_login(harness: Harness, monkeypatch) -> None:
    entered_session_issue = threading.Event()
    release_session_issue = threading.Event()
    reset_finished = threading.Event()
    original_new_session_token = mfa_service.new_session_token

    def paused_session_token() -> str:
        entered_session_issue.set()
        assert release_session_issue.wait(10)
        return original_new_session_token()

    monkeypatch.setattr(mfa_service, "new_session_token", paused_session_token)

    with TestClient(harness.app) as login_client:
        with ThreadPoolExecutor(max_workers=2) as executor:
            login_future = executor.submit(
                login_client.post,
                "/api/v1/auth/login",
                json={
                    "email": "member-2b9fe5e9dceb@example.invalid",
                    "password": INITIAL_ADMIN_PASSWORD,
                },
            )
            assert entered_session_issue.wait(10)

            def reset():
                try:
                    return reset_owner_password(harness, OWNER_LOGIN_RESET_PASSWORD)
                finally:
                    reset_finished.set()

            reset_future = executor.submit(reset)
            reset_completed_before_login = reset_finished.wait(0.75)
            release_session_issue.set()
            login_response = login_future.result(timeout=10)
            reset_response = reset_future.result(timeout=10)

        assert reset_completed_before_login is False
        assert login_response.status_code == 200
        assert reset_response.status_code == 200
        raw_cookie = login_response.cookies.get(harness.app.state.settings.cookie_name)
        assert raw_cookie
        with TestClient(harness.app) as probe:
            probe.cookies.set(harness.app.state.settings.cookie_name, raw_cookie)
            assert probe.get("/api/v1/auth/me").status_code == 401

    password_hash, must_change_password, active_sessions = asyncio.run(
        credential_state(harness.session_factory, harness.admin_id)
    )
    assert verify_password(OWNER_LOGIN_RESET_PASSWORD, password_hash)
    assert not verify_password(INITIAL_ADMIN_PASSWORD, password_hash)
    assert must_change_password is True
    assert active_sessions == 0


def test_owner_reset_serializes_with_in_flight_password_change(
    harness: Harness,
    monkeypatch,
) -> None:
    with TestClient(harness.app) as admin:
        login = admin.post(
            "/api/v1/auth/login",
            json={
                "email": "member-f38d32310a6b@example.invalid",
                "password": INITIAL_ADMIN_PASSWORD,
            },
        )
        assert login.status_code == 200

        entered_hash = threading.Event()
        release_hash = threading.Event()
        reset_finished = threading.Event()
        original_hash_password = auth_router.hash_password

        def paused_hash(password: str) -> str:
            entered_hash.set()
            assert release_hash.wait(10)
            return original_hash_password(password)

        monkeypatch.setattr(auth_router, "hash_password", paused_hash)

        with ThreadPoolExecutor(max_workers=2) as executor:
            change_future = executor.submit(
                admin.post,
                "/api/v1/auth/change-password",
                json={
                    "current_password": INITIAL_ADMIN_PASSWORD,
                    "new_password": ADMIN_CHANGED_PASSWORD,
                },
            )
            assert entered_hash.wait(10)

            def reset():
                try:
                    return reset_owner_password(harness, OWNER_CHANGE_RESET_PASSWORD)
                finally:
                    reset_finished.set()

            reset_future = executor.submit(reset)
            reset_completed_before_change = reset_finished.wait(0.75)
            release_hash.set()
            change_response = change_future.result(timeout=10)
            reset_response = reset_future.result(timeout=10)

        assert reset_completed_before_change is False
        assert change_response.status_code == 204
        assert reset_response.status_code == 200
        assert admin.get("/api/v1/auth/me").status_code == 401

    password_hash, must_change_password, active_sessions = asyncio.run(
        credential_state(harness.session_factory, harness.admin_id)
    )
    assert verify_password(OWNER_CHANGE_RESET_PASSWORD, password_hash)
    assert not verify_password(ADMIN_CHANGED_PASSWORD, password_hash)
    assert must_change_password is True
    assert active_sessions == 0


def test_owner_reset_wins_after_change_password_dependency_preload(
    harness: Harness,
    monkeypatch,
) -> None:
    with TestClient(harness.app) as admin:
        login = admin.post(
            "/api/v1/auth/login",
            json={
                "email": "member-27203bec08ac@example.invalid",
                "password": INITIAL_ADMIN_PASSWORD,
            },
        )
        assert login.status_code == 200

        dependency_preloaded = threading.Event()
        reset_committed = threading.Event()
        original_lock_user_credentials = auth_router.lock_user_credentials

        async def lock_after_owner_reset(database, user_id):
            dependency_preloaded.set()
            assert await asyncio.to_thread(reset_committed.wait, 10)
            return await original_lock_user_credentials(database, user_id)

        monkeypatch.setattr(
            auth_router,
            "lock_user_credentials",
            lock_after_owner_reset,
        )

        with ThreadPoolExecutor(max_workers=2) as executor:
            change_future = executor.submit(
                admin.post,
                "/api/v1/auth/change-password",
                json={
                    "current_password": INITIAL_ADMIN_PASSWORD,
                    "new_password": ADMIN_CHANGED_PASSWORD,
                },
            )
            assert dependency_preloaded.wait(10)

            reset_response = reset_owner_password(
                harness,
                OWNER_PRELOAD_RESET_PASSWORD,
            )
            assert reset_response.status_code == 200
            reset_committed.set()
            change_response = change_future.result(timeout=10)

        assert change_response.status_code == 400
        assert change_response.json()["error"]["code"] == "current_password_invalid"
        assert admin.get("/api/v1/auth/me").status_code == 401

        escaped_login = admin.post(
            "/api/v1/auth/login",
            json={
                "email": "member-5b17ef861b63@example.invalid",
                "password": ADMIN_CHANGED_PASSWORD,
            },
        )
        assert escaped_login.status_code == 401

    password_hash, must_change_password, active_sessions = asyncio.run(
        credential_state(harness.session_factory, harness.admin_id)
    )
    assert verify_password(OWNER_PRELOAD_RESET_PASSWORD, password_hash)
    assert not verify_password(INITIAL_ADMIN_PASSWORD, password_hash)
    assert not verify_password(ADMIN_CHANGED_PASSWORD, password_hash)
    assert must_change_password is True
    assert active_sessions == 0
