import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models import MfaTrustedBrowser, User, UserSession
from app.security import hash_token, new_mfa_trust_token

MFA_TRUST_HOURS = 5


async def lock_user_credentials(
    database: AsyncSession,
    user_id: uuid.UUID,
) -> User | None:
    return await database.scalar(
        select(User)
        .where(User.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


async def revoke_user_sessions(
    database: AsyncSession,
    user_id: uuid.UUID,
    revoked_at: datetime,
) -> int:
    result = await database.execute(
        update(UserSession)
        .where(
            UserSession.user_id == user_id,
            UserSession.revoked_at.is_(None),
        )
        .values(revoked_at=revoked_at)
    )
    return int(result.rowcount or 0)


def create_mfa_trust(
    user: User, settings: Settings, now: datetime, user_agent: str
) -> tuple[MfaTrustedBrowser, str]:
    raw = new_mfa_trust_token()
    return MfaTrustedBrowser(
        user_id=user.id,
        token_hash=hash_token(raw, settings.session_pepper),
        created_at=now,
        expires_at=now + timedelta(hours=MFA_TRUST_HOURS),
        user_agent=user_agent[:256],
    ), raw


async def trusted_mfa_user(
    database: AsyncSession,
    raw: str | None,
    user_id: uuid.UUID,
    settings: Settings,
    now: datetime,
) -> bool:
    if not raw:
        return False
    record = await database.scalar(
        select(MfaTrustedBrowser).where(
            MfaTrustedBrowser.token_hash == hash_token(raw, settings.session_pepper),
            MfaTrustedBrowser.user_id == user_id,
        )
    )
    if record is None or record.revoked_at is not None:
        return False
    expires = record.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=UTC)
    return expires > now


async def revoke_mfa_trust(database: AsyncSession, user_id: uuid.UUID, revoked_at: datetime) -> int:
    result = await database.execute(
        update(MfaTrustedBrowser)
        .where(
            MfaTrustedBrowser.user_id == user_id,
            MfaTrustedBrowser.revoked_at.is_(None),
        )
        .values(revoked_at=revoked_at)
    )
    return int(result.rowcount or 0)
