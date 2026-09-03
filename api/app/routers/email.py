import asyncio
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app import email_delivery as mail
from app.config import Settings
from app.database import get_db
from app.dependencies import CurrentAuth, get_settings, require_role_manager
from app.email_schemas import (
    EmailConfigurationOut,
    EmailConfigurationUpdate,
    EmailRequest,
    EmailResetRequest,
    EmailTestRequest,
    EmailTokenRequest,
)
from app.errors import AppError
from app.identity import lock_user_credentials, revoke_mfa_trust, revoke_user_sessions
from app.models import (
    EmailActionToken,
    EmailDeliverySettings,
    LoginAttempt,
    MfaLoginChallenge,
    User,
)
from app.security import hash_password, hash_token, identifier_hash, verify_password

router = APIRouter(tags=["account email"])
GENERIC = {"message": "If this account is eligible, an email will arrive shortly. Check spam too."}


def invalid_link():
    return AppError(
        400,
        "invalid_email_link",
        "This link is invalid, expired, or already used. Request a new one.",
    )


async def limit_requests(database, request, settings, identity):
    now = datetime.now(UTC)
    ip = "account-email:" + (request.client.host if request.client else "unknown")
    digest = identifier_hash("account-email:" + identity.lower(), settings.session_pepper)
    base = (LoginAttempt.created_at >= now - timedelta(minutes=15),)
    ip_count = await database.scalar(
        select(func.count(LoginAttempt.id)).where(*base, LoginAttempt.client_ip == ip)
    )
    identity_count = await database.scalar(
        select(func.count(LoginAttempt.id)).where(*base, LoginAttempt.identifier_hash == digest)
    )
    if (ip_count or 0) >= 10 or (identity_count or 0) >= 3:
        raise AppError(429, "rate_limited", "Too many email requests. Try again in 15 minutes.")
    database.add(LoginAttempt(identifier_hash=digest, client_ip=ip, succeeded=False))
    await database.commit()


@router.get("/api/v1/email/status")
async def status(database: AsyncSession = Depends(get_db)):
    return {"enabled": await mail.enabled_config(database) is not None}


@router.get("/api/v1/admin/email", response_model=EmailConfigurationOut | None)
async def configuration(
    auth: CurrentAuth = Depends(require_role_manager), database: AsyncSession = Depends(get_db)
):
    row = await database.get(EmailDeliverySettings, 1)
    return (
        {**mail.config_values(row), "has_password": bool(row.password_ciphertext)} if row else None
    )


@router.put("/api/v1/admin/email", response_model=EmailConfigurationOut)
async def update_configuration(
    payload: EmailConfigurationUpdate,
    auth: CurrentAuth = Depends(require_role_manager),
    database: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    user = await lock_user_credentials(database, auth.user.id)
    if user is None or not verify_password(
        payload.current_password.get_secret_value(), user.password_hash
    ):
        raise AppError(400, "current_password_invalid", "Current password is incorrect.")
    row = await database.get(EmailDeliverySettings, 1)
    password = payload.password.get_secret_value()
    if not password and row:
        password = mail.decrypt_password(row.password_ciphertext, settings)
    if not password:
        raise AppError(
            400, "smtp_password_required", "Enter the provider's app password or SMTP password."
        )
    values = payload.model_dump(exclude={"password", "current_password"})
    if payload.enabled:
        try:
            await asyncio.to_thread(mail.check_connection, {**values, "password": password})
        except Exception:
            raise AppError(
                400,
                "smtp_connection_failed",
                "Cannot connect securely to the mail provider. "
                "Check the host, port and credentials.",
            ) from None
    if row is None:
        row = EmailDeliverySettings(id=1)
        database.add(row)
    for key, value in values.items():
        setattr(row, key, value)
    row.password_ciphertext = mail.encrypt_password(password, settings)
    row.updated_at = datetime.now(UTC)
    await database.commit()
    return {**values, "has_password": True}


@router.post("/api/v1/admin/email/test")
async def test_delivery(
    payload: EmailTestRequest,
    request: Request,
    auth: CurrentAuth = Depends(require_role_manager),
    database: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    if not verify_password(payload.current_password.get_secret_value(), auth.user.password_hash):
        raise AppError(400, "current_password_invalid", "Current password is incorrect.")
    await limit_requests(database, request, settings, "smtp-test:" + str(auth.user.id))
    row = await mail.enabled_config(database)
    if not row:
        raise AppError(400, "email_disabled", "Save and enable email settings first.")
    try:
        await asyncio.to_thread(
            mail.send_message,
            mail.transport_config(row, settings),
            auth.user.email,
            "CardVault email connection test",
            "CardVault can send email. Verification and password-reset links use this connection.",
        )
    except Exception:
        raise AppError(
            502,
            "email_send_failed",
            "The provider did not accept the test email. Check your settings.",
        ) from None
    return {"message": "Test email accepted by the provider. Check your inbox and spam."}


async def request_link(purpose, payload, request, tasks, database, settings):
    await limit_requests(database, request, settings, str(payload.email))
    row = await mail.enabled_config(database)
    if row:
        user = await database.scalar(
            select(User)
            .where(User.email_normalized == str(payload.email).lower())
            .with_for_update()
        )
        if user and user.is_active and (user.email_verification_required == (purpose == "verify")):
            await mail.issue_link(database, user, purpose, row, settings, tasks)
            await database.commit()
    return GENERIC


@router.post("/api/v1/email/request-reset")
async def request_reset(
    payload: EmailRequest,
    request: Request,
    tasks: BackgroundTasks,
    database: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    return await request_link("reset", payload, request, tasks, database, settings)


@router.post("/api/v1/email/request-verification")
async def request_verification(
    payload: EmailRequest,
    request: Request,
    tasks: BackgroundTasks,
    database: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    return await request_link("verify", payload, request, tasks, database, settings)


async def redeem(database, settings, raw, purpose):
    # Lock user before token (same order as password/email changes); re-read token
    # after acquiring the lock so two simultaneous redemptions cannot both succeed.
    digest = hash_token(raw, settings.session_pepper)
    user_id = await database.scalar(
        select(EmailActionToken.user_id).where(EmailActionToken.token_hash == digest)
    )
    if user_id is None:
        raise invalid_link()
    user = await lock_user_credentials(database, user_id)
    token = await database.scalar(
        select(EmailActionToken)
        .where(EmailActionToken.token_hash == digest)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    now = datetime.now(UTC)
    if (
        not user
        or not token
        or not user.is_active
        or token.purpose != purpose
        or token.consumed_at is not None
        or mail.utc(token.expires_at) <= now
        or token.target_email != user.email_normalized
        or mail.utc(token.password_version) != mail.utc(user.password_changed_at)
    ):
        raise invalid_link()
    if purpose == "reset" and user.email_verification_required:
        raise invalid_link()
    token.consumed_at = now
    return user, now


@router.post("/api/v1/email/verify")
async def verify_email(
    payload: EmailTokenRequest,
    database: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    user, now = await redeem(database, settings, payload.token, "verify")
    user.email_verification_required = False
    await database.execute(
        update(EmailActionToken)
        .where(EmailActionToken.user_id == user.id, EmailActionToken.purpose == "verify")
        .values(consumed_at=now)
    )
    await database.commit()
    return {"message": "Email verified. You can now sign in."}


@router.post("/api/v1/email/reset")
async def reset_password(
    payload: EmailResetRequest,
    response: Response,
    database: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    user, now = await redeem(database, settings, payload.token, "reset")
    user.password_hash = hash_password(payload.password)
    user.password_changed_at = now
    user.must_change_password = False
    await revoke_user_sessions(database, user.id, now)
    await revoke_mfa_trust(database, user.id, now)
    await database.execute(
        update(MfaLoginChallenge)
        .where(MfaLoginChallenge.user_id == user.id)
        .values(consumed_at=now)
    )
    await database.execute(
        update(EmailActionToken).where(EmailActionToken.user_id == user.id).values(consumed_at=now)
    )
    await database.commit()
    response.delete_cookie(settings.cookie_name, path="/")
    response.delete_cookie("wynterlabs_mfa_trust", path="/api/v1/auth", samesite="strict")
    return {
        "message": "Password changed. Sign in again; your two-step verification remains enabled."
    }
