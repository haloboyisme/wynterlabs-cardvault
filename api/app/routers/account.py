import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.account_schemas import (
    AccountDeletionCreate,
    AccountDeletionOut,
    AccountEmailUpdate,
    AccountPreferencesOut,
    AccountPreferencesUpdate,
)
from app.config import Settings
from app.database import get_db
from app.dependencies import CurrentAuth, get_settings, require_ready_auth
from app.errors import AppError
from app.identity import lock_user_credentials, revoke_mfa_trust, revoke_user_sessions
from app.models import AccountDeletionRequest, Role, SecurityAuditEvent, UserSession
from app.schemas import SessionOut
from app.security import verify_password

router = APIRouter(prefix="/api/v1/account", tags=["account"])


@router.get("/preferences", response_model=AccountPreferencesOut)
async def preferences(auth: CurrentAuth = Depends(require_ready_auth)) -> AccountPreferencesOut:
    return AccountPreferencesOut(share_activity=auth.user.share_activity)


@router.put("/preferences", response_model=AccountPreferencesOut)
async def update_preferences(
    payload: AccountPreferencesUpdate,
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> AccountPreferencesOut:
    user = await lock_user_credentials(database, auth.user.id)
    if user is None:
        raise AppError(401, "not_authenticated", "Sign in to continue.")
    user.share_activity = payload.share_activity
    database.add(SecurityAuditEvent(
        subject_user_id=user.id, event_type="activity_sharing_changed", actor_type="self",
        details={"enabled": payload.share_activity},
    ))
    await database.commit()
    return AccountPreferencesOut(share_activity=user.share_activity)


@router.put("/email", status_code=204)
async def update_email(
    payload: AccountEmailUpdate,
    response: Response,
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> None:
    user = await lock_user_credentials(database, auth.user.id)
    if user is None:
        raise AppError(401, "not_authenticated", "Sign in to continue.")
    if not verify_password(payload.current_password, user.password_hash):
        raise AppError(400, "current_password_invalid", "Current password is incorrect.")
    email = str(payload.new_email).lower()
    user.email = email
    user.email_normalized = email
    now = datetime.now(UTC)
    await revoke_user_sessions(database, user.id, now)
    await revoke_mfa_trust(database, user.id, now)
    database.add(SecurityAuditEvent(
        subject_user_id=user.id, event_type="email_changed", actor_type="self", details={},
    ))
    try:
        await database.commit()
    except IntegrityError as exc:
        await database.rollback()
        raise AppError(409, "email_conflict", "That email address is already in use.") from exc
    response.delete_cookie(settings.cookie_name, path="/")
    response.delete_cookie("wynterlabs_mfa_trust", path="/api/v1/auth", samesite="strict")


@router.get("/deletion", response_model=AccountDeletionOut | None)
async def deletion_request(
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> AccountDeletionRequest | None:
    return await database.scalar(
        select(AccountDeletionRequest).where(
            AccountDeletionRequest.user_id == auth.user.id,
            AccountDeletionRequest.status == "pending",
        )
    )


@router.post("/deletion", response_model=AccountDeletionOut, status_code=201)
async def request_deletion(
    payload: AccountDeletionCreate,
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> AccountDeletionRequest:
    if auth.user.role is Role.OWNER:
        raise AppError(403, "owner_deletion_protected", "The owner account cannot be deleted here.")
    user = await lock_user_credentials(database, auth.user.id)
    if user is None or not verify_password(payload.current_password, user.password_hash):
        raise AppError(400, "current_password_invalid", "Current password is incorrect.")
    row = await database.scalar(
        select(AccountDeletionRequest)
        .where(AccountDeletionRequest.user_id == user.id)
        .with_for_update()
    )
    now = datetime.now(UTC)
    if row is None:
        row = AccountDeletionRequest(user_id=user.id, status="pending", requested_at=now)
        database.add(row)
    else:
        row.status = "pending"
        row.requested_at = now
        row.decided_at = None
        row.decided_by_user_id = None
        row.revision += 1
    database.add(SecurityAuditEvent(
        subject_user_id=user.id, event_type="deletion_requested", actor_type="self", details={},
    ))
    await database.commit()
    await database.refresh(row)
    return row


@router.delete("/deletion", status_code=204)
async def cancel_deletion(
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> None:
    row = await database.scalar(
        select(AccountDeletionRequest).where(
            AccountDeletionRequest.user_id == auth.user.id,
            AccountDeletionRequest.status == "pending",
        )
    )
    if row is None:
        raise AppError(404, "deletion_request_not_found", "No pending deletion request was found.")
    row.status = "canceled"
    row.decided_at = datetime.now(UTC)
    row.revision += 1
    database.add(SecurityAuditEvent(
        subject_user_id=auth.user.id, event_type="deletion_canceled", actor_type="self", details={},
    ))
    await database.commit()


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
