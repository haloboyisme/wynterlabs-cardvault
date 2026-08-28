import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from time import perf_counter

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.models import LoginAttempt, UserSession

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class IdentityCleanupResult:
    login_attempts_deleted: int
    sessions_deleted: int


async def cleanup_identity_history(
    session_factory: async_sessionmaker[AsyncSession],
    settings: Settings,
    now: datetime,
) -> IdentityCleanupResult:
    started_at = perf_counter()
    login_cutoff = now - timedelta(days=settings.identity_login_attempt_retention_days)
    session_cutoff = now - timedelta(days=settings.identity_session_retention_days)
    batch_size = settings.identity_cleanup_batch_size

    async with session_factory() as database:
        attempt_ids = list(
            (
                await database.scalars(
                    select(LoginAttempt.id)
                    .where(LoginAttempt.created_at < login_cutoff)
                    .order_by(LoginAttempt.created_at, LoginAttempt.id)
                    .limit(batch_size)
                )
            ).all()
        )
        if attempt_ids:
            await database.execute(delete(LoginAttempt).where(LoginAttempt.id.in_(attempt_ids)))

        remaining = batch_size - len(attempt_ids)
        session_ids = []
        if remaining > 0:
            session_ids = list(
                (
                    await database.scalars(
                        select(UserSession.id)
                        .where(
                            or_(
                                UserSession.expires_at < session_cutoff,
                                UserSession.revoked_at < session_cutoff,
                            )
                        )
                        .order_by(UserSession.created_at, UserSession.id)
                        .limit(remaining)
                    )
                ).all()
            )
            if session_ids:
                await database.execute(delete(UserSession).where(UserSession.id.in_(session_ids)))

        await database.commit()

    result = IdentityCleanupResult(
        login_attempts_deleted=len(attempt_ids),
        sessions_deleted=len(session_ids),
    )
    if result.login_attempts_deleted or result.sessions_deleted:
        logger.info(
            "Identity retention cleanup deleted login_attempts=%d sessions=%d duration_ms=%d",
            result.login_attempts_deleted,
            result.sessions_deleted,
            round((perf_counter() - started_at) * 1000),
        )
    return result
