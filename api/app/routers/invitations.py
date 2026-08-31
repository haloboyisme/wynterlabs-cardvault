from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.database import get_db
from app.dependencies import get_settings
from app.errors import AppError
from app.invitation_schemas import InvitationAcceptedOut, InvitationAcceptRequest
from app.invitations import invitation_status, no_store
from app.models import AccountInvitation, LoginAttempt, User
from app.registration import _create_user_and_session
from app.security import hash_invitation_token, identifier_hash

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

    try:
        user = await _create_user_and_session(
            email=str(payload.email),
            display_name=payload.display_name,
            password=payload.password,
            role=invitation.target_role,
            conflict_code="invitation_identity_conflict",
            request=request,
            response=response,
            database=database,
            settings=settings,
            now=now,
        )
    except AppError:
        await database.rollback()
        raise
    invitation.used_at = now
    invitation.used_by_user_id = user.id
    invitation.revision += 1
    await database.commit()
    return user
