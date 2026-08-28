import asyncio
import io
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from sqlalchemy import select

from app import identity_cli
from app.identity_cli import BreakGlassRejected, owner_mfa_status, reset_owner_mfa
from app.models import (
    MfaCredential,
    MfaLoginChallenge,
    MfaRecoveryCode,
    Role,
    SecurityAuditEvent,
    User,
    UserSession,
)
from app.security import hash_token, new_session_token


async def _seed_owner(app: FastAPI) -> uuid.UUID:
    owner_id = uuid.uuid4()
    now = datetime.now(UTC)
    async with app.state.session_factory() as database:
        database.add(
            User(
                id=owner_id,
                email="member-b1f1fb0ef32a@example.invalid",
                email_normalized="member-5acb8ff61b49@example.invalid",
                display_name="Owner",
                display_name_normalized="owner",
                password_hash="test-hash",
                role=Role.OWNER,
                owner_slot=1,
                is_active=True,
                must_change_password=False,
                password_changed_at=now,
            )
        )
        database.add(
            MfaCredential(
                user_id=owner_id,
                encrypted_totp_secret="test-only-credential-48f607089690",
                enabled_at=now,
                pending_expires_at=None,
            )
        )
        database.add(
            MfaRecoveryCode(user_id=owner_id, generation=1, code_hash="test-hash", created_at=now)
        )
        database.add(
            MfaLoginChallenge(
                user_id=owner_id,
                token_hash="a" * 64,
                expires_at=now + timedelta(minutes=5),
                client_ip="192.0.2.176",
                user_agent="cli test",
            )
        )
        database.add(
            UserSession(
                user_id=owner_id,
                token_hash=hash_token(new_session_token(), app.state.settings.session_pepper),
                expires_at=now + timedelta(hours=1),
                client_ip="192.0.2.25",
                user_agent="cli test",
            )
        )
        await database.commit()
    return owner_id


def test_break_glass_resets_only_the_exact_active_owner(app: FastAPI) -> None:
    owner_id = asyncio.run(_seed_owner(app))

    async def verify() -> None:
        async with app.state.session_factory() as database:
            status = await owner_mfa_status(database)
            assert status.owner_id == owner_id
            assert status.mfa_enabled is True
            result = await reset_owner_mfa(database, owner_id, "RESET-OWNER-MFA", datetime.now(UTC))
            await database.commit()
            assert result.revoked_sessions == 1
        async with app.state.session_factory() as database:
            assert (
                await database.scalar(
                    select(MfaCredential).where(MfaCredential.user_id == owner_id)
                )
                is None
            )
            assert (
                await database.scalar(
                    select(MfaRecoveryCode).where(MfaRecoveryCode.user_id == owner_id)
                )
                is None
            )
            event = await database.scalar(select(SecurityAuditEvent))
            assert event is not None and event.event_type == "owner_mfa_break_glass"
            session = await database.scalar(
                select(UserSession).where(UserSession.user_id == owner_id)
            )
            assert session is not None and session.revoked_at is not None

    asyncio.run(verify())


def test_break_glass_rejects_wrong_confirmation_without_mutation(app: FastAPI) -> None:
    owner_id = asyncio.run(_seed_owner(app))

    async def verify() -> None:
        async with app.state.session_factory() as database:
            try:
                await reset_owner_mfa(database, owner_id, "wrong", datetime.now(UTC))
            except BreakGlassRejected:
                await database.rollback()
            else:
                raise AssertionError("break-glass accepted an incorrect confirmation")
        async with app.state.session_factory() as database:
            assert (
                await database.scalar(
                    select(MfaCredential).where(MfaCredential.user_id == owner_id)
                )
                is not None
            )

    asyncio.run(verify())


def test_break_glass_rejects_non_owner_and_inactive_owner_uuids(app: FastAPI) -> None:
    owner_id = asyncio.run(_seed_owner(app))

    async def verify() -> None:
        async with app.state.session_factory() as database:
            member_id = uuid.uuid4()
            database.add(
                User(
                    id=member_id,
                    email="member-d0c111209084@example.invalid",
                    email_normalized="member-76cfe8d3b35a@example.invalid",
                    display_name="Member",
                    display_name_normalized="member",
                    password_hash="test-hash",
                    role=Role.MEMBER,
                    is_active=True,
                    must_change_password=False,
                    password_changed_at=datetime.now(UTC),
                )
            )
            await database.commit()
            for candidate in (uuid.uuid4(), member_id):
                with pytest.raises(BreakGlassRejected):
                    await reset_owner_mfa(database, candidate, "RESET-OWNER-MFA", datetime.now(UTC))
                await database.rollback()
            owner = await database.get(User, owner_id)
            assert owner is not None
            owner.is_active = False
            await database.commit()
            with pytest.raises(BreakGlassRejected):
                await reset_owner_mfa(database, owner_id, "RESET-OWNER-MFA", datetime.now(UTC))
            await database.rollback()

    asyncio.run(verify())


def test_break_glass_audit_failure_rolls_back_mutation(app: FastAPI, monkeypatch) -> None:
    owner_id = asyncio.run(_seed_owner(app))

    def audit_failure(**kwargs):
        raise RuntimeError("audit unavailable")

    monkeypatch.setattr(identity_cli, "new_security_audit_event", audit_failure)

    async def verify() -> None:
        async with app.state.session_factory() as database:
            with pytest.raises(RuntimeError, match="audit unavailable"):
                await reset_owner_mfa(database, owner_id, "RESET-OWNER-MFA", datetime.now(UTC))
            await database.rollback()
        async with app.state.session_factory() as database:
            assert await database.scalar(
                select(MfaCredential).where(MfaCredential.user_id == owner_id)
            )
            assert await database.scalar(
                select(MfaRecoveryCode).where(MfaRecoveryCode.user_id == owner_id)
            )
            session = await database.scalar(
                select(UserSession).where(UserSession.user_id == owner_id)
            )
            assert session is not None and session.revoked_at is None

    asyncio.run(verify())


def test_owner_mfa_status_cli_output_is_non_secret(app: FastAPI) -> None:
    owner_id = asyncio.run(_seed_owner(app))
    stdout = io.StringIO()
    assert (
        identity_cli.main(
            ["owner-mfa-status"], session_factory=app.state.session_factory, stdout=stdout
        )
        == 0
    )
    output = stdout.getvalue()
    assert str(owner_id) in output
    assert "mfa_enabled=True" in output
    assert "member-5cbf93e369e2@example.invalid" not in output
    assert "encrypted" not in output
