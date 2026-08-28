"""Transactional privileged MFA operations.

Callers own commit/rollback so challenge consumption and session issuance remain
one database transaction.
"""

import base64
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import quote

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.errors import AppError
from app.mfa import (
    decrypt_totp_secret,
    encrypt_totp_secret,
    generate_totp_secret,
    matching_totp_counter,
    new_recovery_codes,
    normalize_recovery_code,
)
from app.models import (
    MfaCredential,
    MfaLoginChallenge,
    MfaRecoveryCode,
    Role,
    SecurityAuditEvent,
    User,
    UserSession,
)
from app.security import (
    expires_at,
    hash_mfa_challenge_token,
    hash_password,
    hash_token,
    new_mfa_challenge_token,
    new_session_token,
    verify_password,
)

_RECOVERY_PREFIX = "wynterlabs-recovery-v1:"
AUDIT_MFA_ENROLLED = "mfa_enrolled"
AUDIT_MFA_RECOVERY_CODES_REGENERATED = "mfa_recovery_codes_regenerated"
AUDIT_MFA_RECOVERY_CODE_REDEEMED = "mfa_recovery_code_redeemed"
AUDIT_OWNER_MFA_BREAK_GLASS = "owner_mfa_break_glass"

_AUDIT_DETAILS: dict[str, frozenset[str]] = {
    AUDIT_MFA_ENROLLED: frozenset({"recovery_generation", "recovery_codes"}),
    AUDIT_MFA_RECOVERY_CODES_REGENERATED: frozenset({"recovery_generation", "recovery_codes"}),
    AUDIT_MFA_RECOVERY_CODE_REDEEMED: frozenset({"revoked_sessions"}),
    AUDIT_OWNER_MFA_BREAK_GLASS: frozenset({"revoked_sessions"}),
}


def _normalized_utc(value: datetime) -> datetime:
    """Normalize SQLite's naive timestamp round-trip before MFA expiry checks."""
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def new_security_audit_event(
    *, user_id, event_type: str, actor_type: str, details: dict[str, int]
) -> SecurityAuditEvent:
    """Create a deliberately small, non-secret MFA audit event."""
    expected_actor = "console" if event_type == AUDIT_OWNER_MFA_BREAK_GLASS else "self"
    if event_type not in _AUDIT_DETAILS or actor_type != expected_actor:
        raise ValueError("Unsupported MFA audit event")
    if set(details) != _AUDIT_DETAILS[event_type] or any(
        not isinstance(value, int) for value in details.values()
    ):
        raise ValueError("Unsupported MFA audit details")
    return SecurityAuditEvent(
        subject_user_id=user_id, event_type=event_type, actor_type=actor_type, details=details
    )


@dataclass(frozen=True)
class EnrollmentMaterial:
    secret: str
    otpauth_uri: str
    expires_at: datetime


def require_privileged_mfa_role(user: User) -> None:
    if user.role not in (Role.OWNER, Role.ADMIN):
        raise AppError(403, "admin_required", "Administrator access is required.")


async def _locked_user(database: AsyncSession, user_id) -> User:
    user = await database.scalar(select(User).where(User.id == user_id).with_for_update())
    if user is None or not user.is_active:
        raise AppError(401, "not_authenticated", "Sign in to continue.")
    return user


async def _locked_credential(database: AsyncSession, user_id) -> MfaCredential | None:
    return await database.scalar(
        select(MfaCredential).where(MfaCredential.user_id == user_id).with_for_update()
    )


def _recovery_hash(code: str) -> str:
    return hash_password(_RECOVERY_PREFIX + normalize_recovery_code(code))


async def _replace_recovery_codes(
    database: AsyncSession, user_id, generation: int, now: datetime
) -> list[str]:
    codes = new_recovery_codes()
    await database.execute(delete(MfaRecoveryCode).where(MfaRecoveryCode.user_id == user_id))
    database.add_all(
        MfaRecoveryCode(
            user_id=user_id,
            generation=generation,
            code_hash=_recovery_hash(code),
            created_at=now,
        )
        for code in codes
    )
    return codes


async def mfa_status(database: AsyncSession, user: User) -> tuple[bool, bool, int]:
    locked = await _locked_user(database, user.id)
    require_privileged_mfa_role(locked)
    credential = await _locked_credential(database, locked.id)
    enabled = bool(credential and credential.enabled_at)
    if not enabled:
        return True, False, 0
    remaining = await database.scalar(
        select(func.count(MfaRecoveryCode.id)).where(
            MfaRecoveryCode.user_id == locked.id, MfaRecoveryCode.used_at.is_(None)
        )
    )
    return True, True, int(remaining or 0)


async def begin_enrollment(
    database: AsyncSession, user: User, password: str, settings: Settings, now: datetime
) -> EnrollmentMaterial:
    locked = await _locked_user(database, user.id)
    require_privileged_mfa_role(locked)
    if not verify_password(password, locked.password_hash):
        raise AppError(400, "current_password_invalid", "Current password is incorrect.")
    credential = await _locked_credential(database, locked.id)
    if credential and credential.enabled_at:
        raise AppError(409, "mfa_already_enabled", "Two-step verification is already enabled.")
    secret = generate_totp_secret()
    expires = now + timedelta(minutes=settings.mfa_challenge_minutes)
    if credential is None:
        credential = MfaCredential(
            user_id=locked.id, encrypted_totp_secret="", pending_expires_at=expires
        )
        database.add(credential)
    credential.encrypted_totp_secret = encrypt_totp_secret(secret, settings.mfa_encryption_key)
    credential.enabled_at = None
    credential.pending_expires_at = expires
    credential.last_totp_counter = None
    encoded = base64.b32encode(secret).decode().rstrip("=")
    label = quote(f"WynterLabs CardVault:{locked.email}")
    uri = (
        f"otpauth://totp/{label}?secret={encoded}"
        f"&issuer={quote('WynterLabs CardVault')}"
        "&algorithm=SHA1&digits=6&period=30"
    )
    return EnrollmentMaterial(secret=encoded, otpauth_uri=uri, expires_at=expires)


async def confirm_enrollment(
    database: AsyncSession, user: User, code: str, settings: Settings, now: datetime
) -> list[str]:
    locked = await _locked_user(database, user.id)
    require_privileged_mfa_role(locked)
    credential = await _locked_credential(database, locked.id)
    if (
        not credential
        or credential.enabled_at
        or not credential.pending_expires_at
        or _normalized_utc(credential.pending_expires_at) <= now
    ):
        raise AppError(400, "mfa_enrollment_invalid", "The enrollment code is invalid or expired.")
    try:
        secret = decrypt_totp_secret(credential.encrypted_totp_secret, settings.mfa_encryption_key)
    except Exception as error:
        raise AppError(500, "mfa_unavailable", "Two-step verification is unavailable.") from error
    counter = matching_totp_counter(secret, code, int(now.timestamp()))
    if counter is None:
        raise AppError(400, "mfa_enrollment_invalid", "The enrollment code is invalid or expired.")
    credential.enabled_at = now
    credential.pending_expires_at = None
    credential.last_totp_counter = counter
    codes = await _replace_recovery_codes(database, locked.id, 1, now)
    database.add(
        new_security_audit_event(
            user_id=locked.id,
            event_type=AUDIT_MFA_ENROLLED,
            actor_type="self",
            details={"recovery_generation": 1, "recovery_codes": len(codes)},
        )
    )
    return codes


async def regenerate_recovery_codes(
    database: AsyncSession, user: User, password: str, code: str, settings: Settings, now: datetime
) -> list[str]:
    locked = await _locked_user(database, user.id)
    require_privileged_mfa_role(locked)
    if not verify_password(password, locked.password_hash):
        raise AppError(400, "current_password_invalid", "Current password is incorrect.")
    credential = await _locked_credential(database, locked.id)
    if not credential or not credential.enabled_at:
        raise AppError(409, "mfa_not_enabled", "Two-step verification is not enabled.")
    try:
        counter = matching_totp_counter(
            decrypt_totp_secret(credential.encrypted_totp_secret, settings.mfa_encryption_key),
            code,
            int(now.timestamp()),
        )
    except Exception as error:
        raise AppError(500, "mfa_unavailable", "Two-step verification is unavailable.") from error
    if counter is None or (
        credential.last_totp_counter is not None and counter <= credential.last_totp_counter
    ):
        raise AppError(400, "mfa_totp_invalid", "The authenticator code is invalid.")
    credential.last_totp_counter = counter
    previous = await database.scalar(
        select(func.max(MfaRecoveryCode.generation)).where(MfaRecoveryCode.user_id == locked.id)
    )
    generation = int(previous or 0) + 1
    codes = await _replace_recovery_codes(database, locked.id, generation, now)
    database.add(
        new_security_audit_event(
            user_id=locked.id,
            event_type=AUDIT_MFA_RECOVERY_CODES_REGENERATED,
            actor_type="self",
            details={"recovery_generation": generation, "recovery_codes": len(codes)},
        )
    )
    return codes


def create_mfa_challenge(
    user: User, settings: Settings, now: datetime, client_ip: str, user_agent: str
) -> tuple[MfaLoginChallenge, str]:
    raw = new_mfa_challenge_token()
    return MfaLoginChallenge(
        user_id=user.id,
        token_hash=hash_mfa_challenge_token(raw, settings.session_pepper),
        expires_at=now + timedelta(minutes=settings.mfa_challenge_minutes),
        client_ip=client_ip[:64],
        user_agent=user_agent[:256],
    ), raw


def create_full_session(
    user: User, settings: Settings, now: datetime, client_ip: str, user_agent: str
) -> tuple[UserSession, str]:
    raw = new_session_token()
    return UserSession(
        user_id=user.id,
        token_hash=hash_token(raw, settings.session_pepper),
        expires_at=expires_at(settings.session_hours),
        client_ip=client_ip[:64],
        user_agent=user_agent[:256],
    ), raw


async def _locked_challenge(
    database: AsyncSession, raw: str, settings: Settings
) -> MfaLoginChallenge | None:
    return await database.scalar(
        select(MfaLoginChallenge)
        .where(
            MfaLoginChallenge.token_hash == hash_mfa_challenge_token(raw, settings.session_pepper)
        )
        .with_for_update()
    )


def _invalid_challenge(
    challenge: MfaLoginChallenge | None, now: datetime, settings: Settings, *, clear: bool = False
) -> None:
    if challenge and challenge.consumed_at is None:
        challenge.failed_attempts += 1
        if challenge.failed_attempts >= settings.mfa_challenge_max_attempts:
            challenge.consumed_at = now
            clear = True
    headers = None
    if clear:
        headers = {"Set-Cookie": _pre_auth_cookie_deletion(settings)}
    raise AppError(
        401,
        "mfa_challenge_invalid",
        "Two-step verification could not be completed.",
        headers=headers,
    )


def _pre_auth_cookie_deletion(settings: Settings) -> str:
    secure = "; Secure" if settings.environment == "production" else ""
    return (
        f"wynterlabs_pre_auth=; HttpOnly; Max-Age=0; Path=/api/v1/auth/mfa; SameSite=Strict{secure}"
    )


async def _locked_challenge_user(
    database: AsyncSession, challenge: MfaLoginChallenge, now: datetime, settings: Settings
) -> User:
    user = await database.scalar(select(User).where(User.id == challenge.user_id).with_for_update())
    if user is None or not user.is_active:
        _invalid_challenge(challenge, now, settings, clear=True)
    return user


async def complete_totp_challenge(
    database: AsyncSession,
    raw: str | None,
    code: str,
    settings: Settings,
    now: datetime,
    client_ip: str,
    user_agent: str,
) -> tuple[User, str]:
    challenge = await _locked_challenge(database, raw or "", settings) if raw else None
    if not challenge or challenge.consumed_at or _normalized_utc(challenge.expires_at) <= now:
        _invalid_challenge(challenge, now, settings, clear=True)
    user = await _locked_challenge_user(database, challenge, now, settings)
    credential = await _locked_credential(database, user.id)
    if not credential or not credential.enabled_at:
        _invalid_challenge(challenge, now, settings, clear=True)
    try:
        counter = matching_totp_counter(
            decrypt_totp_secret(credential.encrypted_totp_secret, settings.mfa_encryption_key),
            code,
            int(now.timestamp()),
        )
    except Exception as error:
        raise AppError(500, "mfa_unavailable", "Two-step verification is unavailable.") from error
    if counter is None or (
        credential.last_totp_counter is not None and counter <= credential.last_totp_counter
    ):
        _invalid_challenge(challenge, now, settings)
    credential.last_totp_counter = counter
    challenge.consumed_at = now
    session, session_raw = create_full_session(user, settings, now, client_ip, user_agent)
    database.add(session)
    return user, session_raw


async def complete_recovery_challenge(
    database: AsyncSession,
    raw: str | None,
    code: str,
    settings: Settings,
    now: datetime,
    client_ip: str,
    user_agent: str,
) -> tuple[User, str]:
    challenge = await _locked_challenge(database, raw or "", settings) if raw else None
    if not challenge or challenge.consumed_at or _normalized_utc(challenge.expires_at) <= now:
        _invalid_challenge(challenge, now, settings, clear=True)
    user = await _locked_challenge_user(database, challenge, now, settings)
    credential = await _locked_credential(database, user.id)
    if not credential or not credential.enabled_at:
        _invalid_challenge(challenge, now, settings, clear=True)
    candidates = list(
        (
            await database.scalars(
                select(MfaRecoveryCode)
                .where(MfaRecoveryCode.user_id == user.id, MfaRecoveryCode.used_at.is_(None))
                .with_for_update()
            )
        ).all()
    )
    normalized = _RECOVERY_PREFIX + normalize_recovery_code(code)
    matched = next(
        (item for item in candidates if verify_password(normalized, item.code_hash)), None
    )
    if matched is None:
        _invalid_challenge(challenge, now, settings)
    matched.used_at = now
    challenge.consumed_at = now
    from app.identity import revoke_user_sessions

    revoked = await revoke_user_sessions(database, user.id, now)
    session, session_raw = create_full_session(user, settings, now, client_ip, user_agent)
    database.add(session)
    database.add(
        new_security_audit_event(
            user_id=user.id,
            event_type=AUDIT_MFA_RECOVERY_CODE_REDEEMED,
            actor_type="self",
            details={"revoked_sessions": revoked},
        )
    )
    return user, session_raw
