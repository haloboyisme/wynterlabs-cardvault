"""Real PostgreSQL row-lock races for privileged MFA completion."""

import asyncio
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import Settings
from app.main import create_app
from app.mfa import encrypt_totp_secret, generate_totp_secret, new_recovery_codes, totp_at
from app.mfa_service import _RECOVERY_PREFIX
from app.models import MfaCredential, MfaLoginChallenge, MfaRecoveryCode, User, UserSession
from app.security import hash_mfa_challenge_token, hash_password, hash_token, new_session_token


async def _clear(factory: async_sessionmaker) -> None:
    async with factory() as database:
        for model in (MfaLoginChallenge, MfaRecoveryCode, MfaCredential, UserSession, User):
            await database.execute(delete(model))
        await database.commit()


@pytest.fixture
def harness(tmp_path: Path):
    url = os.environ["CARDS_TEST_DATABASE_URL"]
    bootstrap, pepper, key = tmp_path / "bootstrap", tmp_path / "pepper", tmp_path / "mfa_key"
    bootstrap.write_text("mfa-concurrency-bootstrap")
    pepper.write_text("p" * 64)
    key.write_bytes(bytes(range(32)))
    settings = Settings(
        database_url=url,
        bootstrap_secret_file=str(bootstrap),
        session_pepper_file=str(pepper),
        mfa_encryption_key_file=str(key),
        environment="development",
    )
    engine = create_async_engine(url, poolclass=NullPool)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    asyncio.run(_clear(factory))
    app, user_id, secret, recovery_code = (
        create_app(settings=settings, session_factory=factory),
        uuid.uuid4(),
        generate_totp_secret(),
        new_recovery_codes(1)[0],
    )
    now = datetime.now(UTC)

    async def seed() -> None:
        async with factory() as database:
            user = User(
                id=user_id,
                email="member-440413339983@example.invalid",
                email_normalized="member-ed3e35badc03@example.invalid",
                display_name="MFA Race Owner",
                display_name_normalized="mfa race owner",
                password_hash=hash_password("postgres mfa owner password"),
                role="OWNER",
                owner_slot=1,
                is_active=True,
                must_change_password=False,
                password_changed_at=now,
            )
            database.add(user)
            # Models intentionally expose no relationship; establish the FK row
            # before adding dependent MFA records on PostgreSQL.
            await database.flush()
            database.add(
                MfaCredential(
                    user_id=user_id,
                    encrypted_totp_secret=encrypt_totp_secret(secret, settings.mfa_encryption_key),
                    enabled_at=now,
                    pending_expires_at=None,
                )
            )
            database.add(
                MfaRecoveryCode(
                    user_id=user_id,
                    generation=1,
                    code_hash=hash_password(_RECOVERY_PREFIX + recovery_code.replace("-", "")),
                    created_at=now,
                )
            )
            for _ in range(2):
                database.add(
                    UserSession(
                        user_id=user_id,
                        token_hash=hash_token(new_session_token(), settings.session_pepper),
                        expires_at=now + timedelta(hours=1),
                        client_ip="192.0.2.27",
                        user_agent="mfa race seed",
                    )
                )
            await database.commit()

    asyncio.run(seed())
    yield app, factory, user_id, secret, recovery_code
    asyncio.run(engine.dispose())


async def _challenge(factory, user_id, settings, now: datetime) -> str:
    raw = new_session_token()
    async with factory() as database:
        database.add(
            MfaLoginChallenge(
                user_id=user_id,
                token_hash=hash_mfa_challenge_token(raw, settings.session_pepper),
                expires_at=now + timedelta(minutes=5),
                client_ip="192.0.2.196",
                user_agent="mfa race test",
            )
        )
        await database.commit()
    return raw


def _race(app, tokens: tuple[str, str], path: str, code: str) -> list[int]:
    barrier = threading.Barrier(2)

    def submit(raw: str) -> int:
        with TestClient(app) as client:
            client.cookies.set("wynterlabs_pre_auth", raw, path="/api/v1/auth/mfa")
            barrier.wait(timeout=10)
            return client.post(path, json={"code": code}).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        return list(pool.map(submit, tokens))


async def _state(factory, user_id) -> tuple[int, int, int]:
    async with factory() as database:
        used = await database.scalar(
            select(func.count(MfaRecoveryCode.id)).where(
                MfaRecoveryCode.user_id == user_id, MfaRecoveryCode.used_at.is_not(None)
            )
        )
        active = await database.scalar(
            select(func.count(UserSession.id)).where(
                UserSession.user_id == user_id, UserSession.revoked_at.is_(None)
            )
        )
        revoked = await database.scalar(
            select(func.count(UserSession.id)).where(
                UserSession.user_id == user_id, UserSession.revoked_at.is_not(None)
            )
        )
        return int(used or 0), int(active or 0), int(revoked or 0)


def test_recovery_redemption_has_exactly_one_postgres_winner(harness) -> None:
    app, factory, user_id, _, recovery_code = harness
    now = datetime.now(UTC)
    tokens = (
        asyncio.run(_challenge(factory, user_id, app.state.settings, now)),
        asyncio.run(_challenge(factory, user_id, app.state.settings, now)),
    )
    assert sorted(_race(app, tokens, "/api/v1/auth/mfa/recovery", recovery_code)) == [200, 401]
    assert asyncio.run(_state(factory, user_id)) == (1, 1, 2)


def test_same_totp_counter_has_exactly_one_postgres_winner(harness) -> None:
    app, factory, user_id, secret, _ = harness
    now = datetime.now(UTC)
    tokens = (
        asyncio.run(_challenge(factory, user_id, app.state.settings, now)),
        asyncio.run(_challenge(factory, user_id, app.state.settings, now)),
    )
    assert sorted(
        _race(app, tokens, "/api/v1/auth/mfa/totp", totp_at(secret, int(now.timestamp())))
    ) == [200, 401]
