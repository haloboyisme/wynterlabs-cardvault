import uuid
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User, UserSession


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
