import logging
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import func, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.database import get_db
from app.dependencies import CurrentAuth, get_settings, require_auth
from app.errors import AppError
from app.identity import lock_user_credentials, revoke_user_sessions
from app.mfa_service import create_full_session, create_mfa_challenge
from app.models import LoginAttempt, MfaCredential, Role, User
from app.retention import cleanup_identity_history
from app.schemas import ChangePasswordRequest, LoginRequest, LoginResult, UserOut
from app.security import (
    hash_password,
    identifier_hash,
    verify_password,
)

router = APIRouter(prefix="/api/v1/auth", tags=["authentication"])
logger = logging.getLogger(__name__)
MAX_ATTEMPTS = 10
WINDOW_MINUTES = 5


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _set_session_cookie(response: Response, settings: Settings, raw: str) -> None:
    response.set_cookie(
        settings.cookie_name,
        raw,
        max_age=settings.session_hours * 3600,
        httponly=True,
        secure=settings.environment == "production",
        samesite="lax",
        path="/",
    )


def _set_pre_auth_cookie(response: Response, settings: Settings, raw: str) -> None:
    response.set_cookie(
        "wynterlabs_pre_auth",
        raw,
        max_age=settings.mfa_challenge_minutes * 60,
        httponly=True,
        secure=settings.environment == "production",
        samesite="strict",
        path="/api/v1/auth/mfa",
    )


@router.post("/login", response_model=LoginResult)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    database: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> LoginResult:
    normalized = str(payload.email).lower()
    ip = client_ip(request)
    identity = identifier_hash(normalized, settings.session_pepper)
    now = datetime.now(UTC)
    try:
        await cleanup_identity_history(request.app.state.session_factory, settings, now)
    except SQLAlchemyError:
        logger.exception("Identity retention cleanup failed")
    cutoff = now - timedelta(minutes=WINDOW_MINUTES)
    attempt_count = await database.scalar(
        select(func.count(LoginAttempt.id)).where(
            LoginAttempt.created_at >= cutoff,
            or_(
                LoginAttempt.client_ip == ip,
                LoginAttempt.identifier_hash == identity,
            ),
        )
    )
    if (attempt_count or 0) >= MAX_ATTEMPTS:
        raise AppError(429, "rate_limited", "Too many login attempts. Try again later.")

    user = await database.scalar(
        select(User).where(User.email_normalized == normalized).with_for_update()
    )
    valid = verify_password(payload.password, user.password_hash if user else None)
    database.add(
        LoginAttempt(
            identifier_hash=identity,
            client_ip=ip,
            succeeded=bool(valid and user and user.is_active),
        )
    )
    if not user or not valid or not user.is_active:
        await database.commit()
        raise AppError(401, "invalid_credentials", "Email or password is incorrect.")

    enrolled = await database.scalar(
        select(MfaCredential).where(
            MfaCredential.user_id == user.id,
            MfaCredential.enabled_at.is_not(None),
        )
    )
    if enrolled and user.role in (Role.OWNER, Role.ADMIN):
        challenge, raw = create_mfa_challenge(
            user, settings, now, ip, request.headers.get("user-agent", "unknown")
        )
        database.add(challenge)
        await database.commit()
        response.delete_cookie(settings.cookie_name, path="/")
        _set_pre_auth_cookie(response, settings, raw)
        return LoginResult(status="mfa_required", challenge_expires_at=challenge.expires_at)
    session, raw = create_full_session(
        user, settings, now, ip, request.headers.get("user-agent", "unknown")
    )
    database.add(session)
    await database.commit()
    _set_session_cookie(response, settings, raw)
    return LoginResult(status="authenticated", user=UserOut.model_validate(user))


@router.post("/change-password", status_code=204)
async def change_password(
    payload: ChangePasswordRequest,
    response: Response,
    auth: CurrentAuth = Depends(require_auth),
    database: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> None:
    now = datetime.now(UTC)
    user = await lock_user_credentials(database, auth.user.id)
    if user is None:
        raise AppError(401, "not_authenticated", "Sign in to continue.")
    if not verify_password(payload.current_password, user.password_hash):
        raise AppError(
            400,
            "current_password_invalid",
            "Current password is incorrect.",
        )
    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = False
    user.password_changed_at = now
    await revoke_user_sessions(database, user.id, now)
    await database.commit()
    response.delete_cookie(settings.cookie_name, path="/")


@router.post("/logout", status_code=204)
async def logout(
    response: Response,
    auth: CurrentAuth = Depends(require_auth),
    database: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> None:
    auth.session.revoked_at = datetime.now(UTC)
    await database.commit()
    response.delete_cookie(settings.cookie_name, path="/")


@router.get("/me", response_model=UserOut)
async def me(auth: CurrentAuth = Depends(require_auth)) -> User:
    return auth.user
