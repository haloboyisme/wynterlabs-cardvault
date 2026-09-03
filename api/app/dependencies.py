from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.database import get_db
from app.errors import AppError
from app.models import Role, User, UserSession
from app.security import hash_token


@dataclass
class CurrentAuth:
    user: User
    session: UserSession


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


async def require_auth(
    request: Request,
    database: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> CurrentAuth:
    raw = request.cookies.get(settings.cookie_name)
    if not raw:
        raise AppError(401, "not_authenticated", "Sign in to continue.")
    digest = hash_token(raw, settings.session_pepper)
    result = await database.execute(
        select(UserSession, User)
        .join(User, User.id == UserSession.user_id)
        .where(UserSession.token_hash == digest)
    )
    row = result.one_or_none()
    if row is None:
        raise AppError(401, "not_authenticated", "Sign in to continue.")
    session, user = row
    now = datetime.now(UTC)
    expires = session.expires_at
    changed = user.password_changed_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=UTC)
    if changed.tzinfo is None:
        changed = changed.replace(tzinfo=UTC)
    if (
        session.revoked_at is not None
        or expires <= now
        or not user.is_active
        or user.email_verification_required
        or session.created_at.replace(tzinfo=UTC) < changed
    ):
        raise AppError(401, "not_authenticated", "Sign in to continue.")
    session.last_seen_at = now
    await database.commit()
    return CurrentAuth(user=user, session=session)


async def require_ready_auth(
    auth: CurrentAuth = Depends(require_auth),
) -> CurrentAuth:
    if auth.user.must_change_password:
        raise AppError(
            403,
            "password_change_required",
            "Change your temporary password to continue.",
        )
    if auth.user.must_setup_mfa:
        raise AppError(
            403,
            "mfa_setup_required",
            "Set up two-step verification to continue.",
        )
    return auth


async def require_password_ready_auth(
    auth: CurrentAuth = Depends(require_auth),
) -> CurrentAuth:
    if auth.user.must_change_password:
        raise AppError(
            403,
            "password_change_required",
            "Change your temporary password to continue.",
        )
    return auth


async def require_owner(
    auth: CurrentAuth = Depends(require_ready_auth),
) -> CurrentAuth:
    if auth.user.role is not Role.OWNER:
        raise AppError(403, "owner_required", "Owner access is required.")
    return auth


async def require_role_manager(
    auth: CurrentAuth = Depends(require_ready_auth),
) -> CurrentAuth:
    if auth.user.role not in (Role.OWNER, Role.SUPER_ADMIN):
        raise AppError(
            403,
            "role_manager_required",
            "Owner or super administrator access is required.",
        )
    return auth


async def require_catalog_operator(
    auth: CurrentAuth = Depends(require_ready_auth),
) -> CurrentAuth:
    if auth.user.role not in (Role.OWNER, Role.SUPER_ADMIN, Role.ADMIN):
        raise AppError(403, "admin_required", "Administrator access is required.")
    return auth
