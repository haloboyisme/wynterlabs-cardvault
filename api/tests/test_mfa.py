import asyncio
import base64
import re
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from cryptography.exceptions import InvalidTag
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import select

from app.config import Settings
from app.database import Base
from app.mfa import (
    decrypt_totp_secret,
    encrypt_totp_secret,
    generate_totp_secret,
    matching_totp_counter,
    new_recovery_codes,
    normalize_recovery_code,
    totp_at,
)
from app.mfa_service import (
    AUDIT_MFA_ENROLLED,
    complete_totp_challenge,
    create_mfa_challenge,
    mfa_status,
    new_security_audit_event,
    regenerate_recovery_codes,
)
from app.models import (
    MfaCredential,
    MfaLoginChallenge,
    MfaRecoveryCode,
    MfaTrustedBrowser,
    Role,
    SecurityAuditEvent,
    User,
    UserSession,
)
from app.security import hash_password, hash_token, new_session_token, verify_password


@pytest.mark.parametrize(
    ("unix_time", "expected"),
    [
        (59, "94287082"),
        (1111111109, "07081804"),
        (1111111111, "14050471"),
        (1234567890, "89005924"),
        (2000000000, "69279037"),
        (20000000000, "65353130"),
    ],
)
def test_rfc6238_sha1_vectors(unix_time: int, expected: str) -> None:
    assert totp_at(b"12345678901234567890", unix_time, digits=8) == expected


def test_encrypted_totp_secret_rejects_tampering() -> None:
    key = bytes(range(32))
    encoded = encrypt_totp_secret(b"01234567890123456789", key)
    assert decrypt_totp_secret(encoded, key) == b"01234567890123456789"
    with pytest.raises(InvalidTag):
        decrypt_totp_secret(encoded, bytes(reversed(range(32))))
    raw = bytearray(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
    raw[-1] ^= 1
    with pytest.raises(InvalidTag):
        decrypt_totp_secret(base64.urlsafe_b64encode(raw).decode().rstrip("="), key)


def test_counter_matching_accepts_one_step_skew_and_rejects_invalid_input() -> None:
    secret = "test-only-credential-933fc7a599b1"
    now = 1_111_111_111
    assert matching_totp_counter(secret, totp_at(secret, now - 30), now) == (now // 30) - 1
    assert matching_totp_counter(secret, "12345", now) is None
    assert matching_totp_counter(secret, "abcdef", now) is None


def test_generated_secrets_and_recovery_codes_are_normalized_and_distinct() -> None:
    assert len(generate_totp_secret()) == 20
    codes = new_recovery_codes()
    assert len(codes) == len(set(codes)) == 10
    assert all(len(code) == 23 and code.count("-") == 3 for code in codes)
    assert normalize_recovery_code(codes[0].lower()) == codes[0].replace("-", "")


def test_mfa_key_requires_exactly_32_bytes(tmp_path: Path) -> None:
    path = tmp_path / "mfa_key"
    path.write_bytes(b"x" * 31)
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        bootstrap_secret_file=str(tmp_path / "unused-bootstrap"),
        session_pepper_file=str(tmp_path / "unused-pepper"),
        mfa_encryption_key_file=str(path),
        environment="development",
    )
    with pytest.raises(ValueError, match="exactly 32 bytes"):
        _ = settings.mfa_encryption_key


def test_mfa_key_path_is_required_at_settings_construction(tmp_path: Path) -> None:
    with pytest.raises(ValidationError):
        Settings(
            database_url="sqlite+aiosqlite:///:memory:",
            bootstrap_secret_file=str(tmp_path / "bootstrap"),
            session_pepper_file=str(tmp_path / "pepper"),
            environment="development",
        )


def test_mfa_models_are_in_metadata() -> None:
    assert {
        "mfa_credentials",
        "mfa_login_challenges",
        "mfa_recovery_codes",
        "mfa_trusted_browsers",
        "security_audit_events",
    } <= set(Base.metadata.tables)


def test_users_expose_privileged_mfa_onboarding_state() -> None:
    assert hasattr(User, "must_setup_mfa")


async def _enrolled_owner(app, *, active: bool = True) -> tuple[User, str, bytes]:
    now = datetime.now(UTC)
    secret = generate_totp_secret()
    async with app.state.session_factory() as database:
        user = User(
            id=uuid.uuid4(),
            email="member-77c653755f17@example.invalid",
            email_normalized="member-0356f299a285@example.invalid",
            display_name="MFA Owner",
            display_name_normalized="mfa owner",
            password_hash=hash_password("mfa owner password"),
            role=Role.OWNER,
            owner_slot=1,
            is_active=active,
            must_change_password=False,
            password_changed_at=now,
        )
        database.add(user)
        database.add(
            MfaCredential(
                user_id=user.id,
                encrypted_totp_secret=encrypt_totp_secret(
                    secret, app.state.settings.mfa_encryption_key
                ),
                enabled_at=now,
                pending_expires_at=None,
            )
        )
        challenge, raw = create_mfa_challenge(
            user, app.state.settings, now, "192.0.2.10", "mfa test"
        )
        database.add(challenge)
        await database.commit()
    return user, raw, secret


def test_mfa_wrong_attempt_keeps_cookie_but_exhaustion_clears_actual_error_response(
    app, client
) -> None:
    _, raw, _ = asyncio.run(_enrolled_owner(app))
    client.cookies.set("wynterlabs_pre_auth", raw, path="/api/v1/auth/mfa")
    first = client.post("/api/v1/auth/mfa/totp", json={"code": "000000"})
    assert first.status_code == 401
    assert first.json()["error"]["code"] == "mfa_challenge_invalid"
    assert "Max-Age=0" not in first.headers.get("set-cookie", "")
    assert first.headers["cache-control"] == "no-store"
    for _ in range(app.state.settings.mfa_challenge_max_attempts - 1):
        exhausted = client.post("/api/v1/auth/mfa/totp", json={"code": "000000"})
    assert exhausted.status_code == 401
    assert "Max-Age=0" in exhausted.headers["set-cookie"]


def test_disabled_mfa_challenge_is_generic_and_clears_cookie(app, client) -> None:
    _, raw, _ = asyncio.run(_enrolled_owner(app, active=False))
    client.cookies.set("wynterlabs_pre_auth", raw, path="/api/v1/auth/mfa")
    response = client.post("/api/v1/auth/mfa/totp", json={"code": "000000"})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "mfa_challenge_invalid"
    assert "Max-Age=0" in response.headers["set-cookie"]


def test_totp_challenge_accepts_sqlite_naive_challenge_expiry(app) -> None:
    user, raw, secret = asyncio.run(_enrolled_owner(app))
    now = datetime.now(UTC)

    async def complete() -> None:
        async with app.state.session_factory() as database:
            completed_user, _ = await complete_totp_challenge(
                database,
                raw,
                totp_at(secret, int(now.timestamp())),
                app.state.settings,
                now,
                "192.0.2.173",
                "mfa test",
            )
            assert completed_user.id == user.id
            await database.commit()

    asyncio.run(complete())


def test_enrolled_privileged_login_uses_only_a_scoped_pre_auth_cookie(app, client) -> None:
    _, _, _ = asyncio.run(_enrolled_owner(app))
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "member-3ad8ac120ea5@example.invalid", "password": "test-only-credential-6954a1acc951"},
    )
    assert login.status_code == 200
    assert login.json()["status"] == "mfa_required"
    cookie = login.headers["set-cookie"]
    assert re.search(
        r"wynterlabs_pre_auth=[^;]+; HttpOnly; Max-Age=300; Path=/api/v1/auth/mfa; "
        r"SameSite=strict",
        cookie,
    )
    # MFA login clears an existing full-session cookie rather than issuing one.
    assert re.search(
        r'wynterlabs_session=""; expires=[^;]+; Max-Age=0; Path=/; SameSite=lax',
        cookie,
    )

    async def sessions() -> int:
        async with app.state.session_factory() as database:
            return len(list((await database.scalars(select(UserSession))).all()))

    assert asyncio.run(sessions()) == 0


def test_totp_success_trusts_browser_for_same_browser_login_and_rejects_replay(app, client) -> None:
    _, _, secret = asyncio.run(_enrolled_owner(app))
    credentials = {"email": "member-7e3a6b1979df@example.invalid", "password": "test-only-credential-b0acde2364fa"}
    now = datetime.now(UTC)
    code = totp_at(secret, int(now.timestamp()))
    assert client.post("/api/v1/auth/login", json=credentials).json()["status"] == "mfa_required"
    completed = client.post("/api/v1/auth/mfa/totp", json={"code": code})
    assert completed.status_code == 200
    assert "Max-Age=0" in completed.headers["set-cookie"]
    assert "wynterlabs_mfa_trust=" in completed.headers["set-cookie"]
    assert client.post("/api/v1/auth/logout").status_code == 204
    assert client.post("/api/v1/auth/login", json=credentials).json()["status"] == "authenticated"
    replay = client.post("/api/v1/auth/mfa/totp", json={"code": code})
    assert replay.status_code == 401
    assert replay.json()["error"]["code"] == "mfa_challenge_invalid"


def test_expired_challenge_is_generic_and_clears_the_pre_auth_cookie(app, client) -> None:
    _, raw, _ = asyncio.run(_enrolled_owner(app))

    async def expire() -> None:
        async with app.state.session_factory() as database:
            challenge = await database.scalar(select(MfaLoginChallenge))
            assert challenge is not None
            challenge.expires_at = datetime.now(UTC) - timedelta(seconds=1)
            await database.commit()

    asyncio.run(expire())
    client.cookies.set("wynterlabs_pre_auth", raw, path="/api/v1/auth/mfa")
    response = client.post("/api/v1/auth/mfa/totp", json={"code": "000000"})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "mfa_challenge_invalid"
    assert "Max-Age=0" in response.headers["set-cookie"]


def test_regeneration_invalidates_all_old_recovery_codes(app) -> None:
    user, _, secret = asyncio.run(_enrolled_owner(app))
    now = datetime.now(UTC)

    async def regenerate_twice() -> tuple[list[str], list[str], list[MfaRecoveryCode]]:
        async with app.state.session_factory() as database:
            first = await regenerate_recovery_codes(
                database,
                user,
                "mfa owner password",
                totp_at(secret, int(now.timestamp())),
                app.state.settings,
                now,
            )
            await database.commit()
        async with app.state.session_factory() as database:
            second = await regenerate_recovery_codes(
                database,
                user,
                "mfa owner password",
                totp_at(secret, int((now + timedelta(seconds=30)).timestamp())),
                app.state.settings,
                now + timedelta(seconds=30),
            )
            await database.commit()
        async with app.state.session_factory() as database:
            rows = list((await database.scalars(select(MfaRecoveryCode))).all())
            return first, second, rows

    first, second, rows = asyncio.run(regenerate_twice())
    assert len(first) == len(second) == 10
    assert set(first).isdisjoint(second)
    assert {row.generation for row in rows} == {2}
    assert all(
        not any(
            verify_password("wynterlabs-recovery-v1:" + code.replace("-", ""), row.code_hash)
            for row in rows
        )
        for code in first
    )


def test_audit_event_allowlist_and_member_mfa_status_are_supported(app) -> None:
    with pytest.raises(ValueError):
        new_security_audit_event(
            user_id=uuid.uuid4(),
            event_type=AUDIT_MFA_ENROLLED,
            actor_type="console",
            details={"recovery_generation": 1, "recovery_codes": 10},
        )
    with pytest.raises(ValueError):
        new_security_audit_event(
            user_id=uuid.uuid4(),
            event_type=AUDIT_MFA_ENROLLED,
            actor_type="self",
            details={"recovery_generation": 1, "recovery_codes": 10, "secret": "test-only-credential-a90d0936c5b5"},
        )

    async def status_for_member() -> None:
        async with app.state.session_factory() as database:
            member = User(
                id=uuid.uuid4(),
                email="member-53db52451cb8@example.invalid",
                email_normalized="member-4eed40d481bd@example.invalid",
                display_name="Member MFA",
                display_name_normalized="member mfa",
                password_hash=hash_password("member mfa password"),
                role=Role.MEMBER,
                is_active=True,
                must_change_password=False,
                password_changed_at=datetime.now(UTC),
            )
            database.add(member)
            await database.commit()
            assert await mfa_status(database, member) == (True, False, 0)

    asyncio.run(status_for_member())


def test_recovery_code_consumes_one_code_revokes_old_sessions_and_audits(app, client) -> None:
    user, raw, _ = asyncio.run(_enrolled_owner(app))
    recovery_code = "ABCDE-FGHIJ-KLMNO-PQRST"

    async def seed() -> None:
        async with app.state.session_factory() as database:
            database.add(
                MfaRecoveryCode(
                    user_id=user.id,
                    generation=1,
                    code_hash=hash_password(
                        "wynterlabs-recovery-v1:" + recovery_code.replace("-", "")
                    ),
                    created_at=datetime.now(UTC),
                )
            )
            for _ in range(2):
                database.add(
                    UserSession(
                        user_id=user.id,
                        token_hash=hash_token(
                            new_session_token(), app.state.settings.session_pepper
                        ),
                        expires_at=datetime.now(UTC) + timedelta(hours=1),
                        client_ip="192.0.2.22",
                        user_agent="mfa test",
                    )
                )
            await database.commit()

    asyncio.run(seed())
    client.cookies.set("wynterlabs_pre_auth", raw, path="/api/v1/auth/mfa")
    response = client.post("/api/v1/auth/mfa/recovery", json={"code": recovery_code})
    assert response.status_code == 200

    async def state() -> tuple[int, int, int]:
        async with app.state.session_factory() as database:
            used = len(
                list(
                    (
                        await database.scalars(
                            select(MfaRecoveryCode).where(MfaRecoveryCode.used_at.is_not(None))
                        )
                    ).all()
                )
            )
            active = len(
                list(
                    (
                        await database.scalars(
                            select(UserSession).where(UserSession.revoked_at.is_(None))
                        )
                    ).all()
                )
            )
            events = len(
                list(
                    (
                        await database.scalars(
                            select(SecurityAuditEvent).where(
                                SecurityAuditEvent.event_type == "mfa_recovery_code_redeemed"
                            )
                        )
                    ).all()
                )
            )
            return used, active, events

    assert asyncio.run(state()) == (1, 1, 1)


def test_account_mfa_one_time_responses_are_no_store(app, client) -> None:
    created = client.post(
        "/api/v1/setup/owner",
        json={
            "email": "member-fdcc4595767c@example.invalid",
            "display_name": "Owner",
            "password": "test-only-credential-adcf3f747187",
        },
        headers={"X-Bootstrap-Secret": "test-only-credential-44caad84f071"},
    )
    assert created.status_code == 201
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "member-062fa281d1d5@example.invalid", "password": "test-only-credential-04cfc81b6740"},
    )
    assert login.status_code == 200
    response = client.post(
        "/api/v1/account/mfa/enrollment",
        json={"current_password": "test-only-credential-9b24520507c2"},
    )
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"


def test_owner_enrollment_activates_encrypted_secret_and_returns_codes_once(app, client) -> None:
    password = "test-only-credential-01eb7324f716"
    assert (
        client.post(
            "/api/v1/setup/owner",
            json={"email": "member-c52914e2d0d8@example.invalid", "display_name": "Owner", "password": password},
            headers={"X-Bootstrap-Secret": "test-only-credential-b4e31bd14a93"},
        ).status_code
        == 201
    )
    assert (
        client.post(
            "/api/v1/auth/login", json={"email": "member-441be91ff8fe@example.invalid", "password": password}
        ).status_code
        == 200
    )
    begun = client.post("/api/v1/account/mfa/enrollment", json={"current_password": password})
    assert begun.status_code == 200
    material = begun.json()
    assert set(material) == {"secret", "otpauth_uri", "expires_at"}
    secret = base64.b32decode(material["secret"] + "=" * (-len(material["secret"]) % 8))
    confirmed = client.post(
        "/api/v1/account/mfa/enrollment/confirm",
        json={"code": totp_at(secret, int(datetime.now(UTC).timestamp()))},
    )
    assert confirmed.status_code == 200
    assert len(confirmed.json()["recovery_codes"]) == 10

    async def state() -> tuple[bool, bool, int]:
        async with app.state.session_factory() as database:
            credential = await database.scalar(select(MfaCredential))
            assert credential is not None
            assert material["secret"] not in credential.encrypted_totp_secret
            events = len(list((await database.scalars(select(SecurityAuditEvent))).all()))
            return credential.enabled_at is not None, credential.pending_expires_at is None, events

    assert asyncio.run(state()) == (True, True, 1)


def test_new_owner_is_restricted_until_mfa_enrollment(app, client) -> None:
    created = client.post(
        "/api/v1/setup/owner",
        json={
            "email": "owner-required@example.com",
            "display_name": "Required Owner",
            "password": "correct horse winter battery",
        },
        headers={"X-Bootstrap-Secret": "winter-bootstrap-secret-for-tests"},
    )
    assert created.status_code == 201
    assert created.json()["must_setup_mfa"] is True
    login = client.post(
        "/api/v1/auth/login",
        json={
            "email": "owner-required@example.com",
            "password": "correct horse winter battery",
        },
    )
    assert login.json()["user"]["must_setup_mfa"] is True
    blocked = client.get("/api/v1/account/sessions")
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "mfa_setup_required"
    assert client.get("/api/v1/account/mfa").status_code == 200


def test_member_can_enroll_in_optional_mfa(app, client) -> None:
    registered = client.post(
        "/api/v1/registration",
        json={
            "email": "optional-mfa@example.com",
            "display_name": "Optional MFA",
            "password": "correct horse winter battery",
        },
    )
    assert registered.status_code == 201
    assert registered.json()["must_setup_mfa"] is False
    status = client.get("/api/v1/account/mfa")
    assert status.status_code == 200
    assert status.json() == {"eligible": True, "enabled": False, "recovery_codes_remaining": 0}


def test_trusted_mfa_is_browser_specific_and_expires_without_sliding(app, client) -> None:
    _, _, secret = asyncio.run(_enrolled_owner(app))
    credentials = {"email": "mfa-owner@wynterlabs.com", "password": "mfa owner password"}
    assert client.post("/api/v1/auth/login", json=credentials).json()["status"] == "mfa_required"
    code = totp_at(secret, int(datetime.now(UTC).timestamp()))
    assert client.post("/api/v1/auth/mfa/totp", json={"code": code}).status_code == 200

    with TestClient(app) as other_browser:
        assert (
            other_browser.post("/api/v1/auth/login", json=credentials).json()["status"]
            == "mfa_required"
        )

    async def expire_trust() -> None:
        async with app.state.session_factory() as database:
            trust = await database.scalar(select(MfaTrustedBrowser))
            assert trust is not None
            trust.expires_at = datetime.now(UTC) - timedelta(seconds=1)
            await database.commit()

    asyncio.run(expire_trust())
    assert client.post("/api/v1/auth/logout").status_code == 204
    assert client.post("/api/v1/auth/login", json=credentials).json()["status"] == "mfa_required"
