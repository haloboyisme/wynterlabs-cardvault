import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.database import get_db
from app.dependencies import CurrentAuth, get_settings, require_ready_auth
from app.errors import AppError
from app.models import UserSession
from app.schemas import SessionOut

router = APIRouter(prefix="/api/v1/account", tags=["account"])


@router.get("/sessions", response_model=list[SessionOut])
async def sessions(
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> list[SessionOut]:
    now = datetime.now(UTC)
    result = await database.scalars(
        select(UserSession)
        .where(
            UserSession.user_id == auth.user.id,
            UserSession.revoked_at.is_(None),
            UserSession.expires_at > now,
        )
        .order_by(UserSession.created_at.desc())
    )
    return [
        SessionOut(
            id=item.id,
            created_at=item.created_at,
            expires_at=item.expires_at,
            last_seen_at=item.last_seen_at,
            client_ip=item.client_ip,
            user_agent=item.user_agent,
            current=item.id == auth.session.id,
        )
        for item in result
    ]


@router.delete("/sessions/{session_id}", status_code=204)
async def revoke_session(
    session_id: uuid.UUID,
    response: Response,
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> None:
    session = await database.scalar(
        select(UserSession).where(
            UserSession.id == session_id,
            UserSession.user_id == auth.user.id,
        )
    )
    if session is None:
        raise AppError(404, "session_not_found", "Session was not found.")
    session.revoked_at = datetime.now(UTC)
    await database.commit()
    if session.id == auth.session.id:
        response.delete_cookie(settings.cookie_name, path="/")
