from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.database import get_db
from app.dependencies import get_settings
from app.errors import AppError
from app.invitation_schemas import InvitationAcceptedOut, InvitationAcceptRequest
from app.invitations import invitation_status, no_store
from app.models import AccountInvitation, LoginAttempt, Role, User, UserSession
from app.security import (
    expires_at,
    hash_invitation_token,
    hash_password,
    hash_token,
    identifier_hash,
    new_session_token,
)

router = APIRouter(prefix="/api/v1/invitations", tags=["invitations"])
MAX_ATTEMPTS = 10
WINDOW_MINUTES = 5


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _invalid() -> AppError:
    return AppError(
        400,
        "invitation_invalid",
        "This invitation link is invalid or no longer available.",
    )


@router.post("/accept", response_model=InvitationAcceptedOut, status_code=201)
async def accept_invitation(
    payload: InvitationAcceptRequest,
    request: Request,
    response: Response,
    database: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    no_store(response)
    now = datetime.now(UTC)
    ip = _client_ip(request)
    rate_ip = f"invitation:{ip}"
    attempt_key = identifier_hash(f"invitation:{ip}", settings.session_pepper)
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

    digest = hash_invitation_token(payload.token, settings.session_pepper)
    invitation = await database.scalar(
        select(AccountInvitation)
        .where(AccountInvitation.token_hash == digest)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    database.add(
        LoginAttempt(
            identifier_hash=attempt_key,
            client_ip=rate_ip,
            succeeded=False,
        )
    )
    if invitation is None or invitation_status(invitation, now) != "active":
        await database.commit()
        raise _invalid()

    email = str(payload.email).casefold()
    display_name_normalized = payload.display_name.casefold()
    identity_exists = await database.scalar(
        select(User.id).where(
            or_(
                User.email_normalized == email,
                User.display_name_normalized == display_name_normalized,
            )
        )
    )
    if identity_exists is not None:
        await database.rollback()
        raise AppError(
            409,
            "invitation_identity_conflict",
            "That email or display name is already in use.",
        )

    user = User(
        email=email,
        email_normalized=email,
        display_name=payload.display_name,
        display_name_normalized=display_name_normalized,
        password_hash=hash_password(payload.password),
        role=Role.MEMBER,
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
        raise AppError(
            409,
            "invitation_identity_conflict",
            "That email or display name is already in use.",
        ) from exc

    raw_session = new_session_token()
    database.add(
        UserSession(
            user_id=user.id,
            token_hash=hash_token(raw_session, settings.session_pepper),
            expires_at=expires_at(settings.session_hours),
            client_ip=ip,
            user_agent=request.headers.get("user-agent", "unknown")[:256],
        )
    )
    invitation.used_at = now
    invitation.used_by_user_id = user.id
    invitation.revision += 1
    await database.commit()
    response.set_cookie(
        settings.cookie_name,
        raw_session,
        max_age=settings.session_hours * 3600,
        httponly=True,
        secure=settings.environment == "production",
        samesite="lax",
        path="/",
    )
    return user
