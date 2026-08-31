from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.database import get_db
from app.dependencies import get_settings
from app.errors import AppError
from app.models import LoginAttempt, Role, User, UserSession
from app.registration_schemas import RegistrationOut, RegistrationRequest
from app.security import expires_at, hash_password, hash_token, identifier_hash, new_session_token

router = APIRouter(prefix="/api/v1/registration", tags=["registration"])
MAX_ATTEMPTS = 10
WINDOW_MINUTES = 5


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _identity_conflict(code: str) -> AppError:
    return AppError(409, code, "That email or display name is already in use.")


def _set_session_cookie(response: Response, settings: Settings, raw_session: str) -> None:
    response.set_cookie(
        settings.cookie_name,
        raw_session,
        max_age=settings.session_hours * 3600,
        httponly=True,
        secure=settings.environment == "production",
        samesite="lax",
        path="/",
    )


async def _create_user_and_session(
    *,
    email: str,
    display_name: str,
    password: str,
    role: Role,
    conflict_code: str,
    request: Request,
    response: Response,
    database: AsyncSession,
    settings: Settings,
    now: datetime,
) -> User:
    email_normalized = str(email).casefold()
    display_name_normalized = display_name.casefold()
    identity_exists = await database.scalar(
        select(User.id).where(
            or_(
                User.email_normalized == email_normalized,
                User.display_name_normalized == display_name_normalized,
            )
        )
    )
    if identity_exists is not None:
        raise _identity_conflict(conflict_code)

    user = User(
        email=email_normalized,
        email_normalized=email_normalized,
        display_name=display_name,
        display_name_normalized=display_name_normalized,
        password_hash=hash_password(password),
        role=role,
        owner_slot=None,
        is_active=True,
        must_change_password=False,
        password_changed_at=now,
    )
    database.add(user)
    try:
        await database.flush()
    except IntegrityError as exc:
        await database.rollback()
        raise _identity_conflict(conflict_code) from exc

    raw_session = new_session_token()
    database.add(
        UserSession(
            user_id=user.id,
            token_hash=hash_token(raw_session, settings.session_pepper),
            expires_at=expires_at(settings.session_hours),
            client_ip=_client_ip(request),
            user_agent=request.headers.get("user-agent", "unknown")[:256],
        )
    )
    _set_session_cookie(response, settings, raw_session)
    return user


@router.post("", response_model=RegistrationOut, status_code=201)
async def register(
    payload: RegistrationRequest,
    request: Request,
    response: Response,
    database: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    now = datetime.now(UTC)
    ip = _client_ip(request)
    rate_ip = f"registration:{ip}"
    attempt_key = identifier_hash(rate_ip, settings.session_pepper)
    cutoff = now - timedelta(minutes=WINDOW_MINUTES)
    attempt_count = await database.scalar(
        select(func.count(LoginAttempt.id)).where(
            LoginAttempt.created_at >= cutoff,
            or_(
                LoginAttempt.client_ip == rate_ip,
                LoginAttempt.identifier_hash == attempt_key,
            ),
        )
    )
    if (attempt_count or 0) >= MAX_ATTEMPTS:
        raise AppError(429, "rate_limited", "Too many attempts. Try again later.")

    attempt = LoginAttempt(
        identifier_hash=attempt_key,
        client_ip=rate_ip,
        succeeded=False,
    )
    database.add(attempt)
    try:
        user = await _create_user_and_session(
            email=str(payload.email),
            display_name=payload.display_name,
            password=payload.password,
            role=Role.MEMBER,
            conflict_code="registration_identity_conflict",
            request=request,
            response=response,
            database=database,
            settings=settings,
            now=now,
        )
    except AppError:
        await database.commit()
        raise
    attempt.succeeded = True
    await database.commit()
    return user
