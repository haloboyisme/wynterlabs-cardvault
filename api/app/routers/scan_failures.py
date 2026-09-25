import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import CurrentAuth, require_ready_auth
from app.errors import AppError
from app.models import ScanFailure

router = APIRouter(prefix="/api/v1/scanner/failures", tags=["scanner"])
Tag = Literal["blur", "glare", "too_dark", "sideways_or_layout", "no_text", "no_catalog_match", "ambiguous_printing", "wrong_match", "timeout", "service_error", "unknown"]

class FailureIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["single", "multiple", "diy"]
    revision: int = Field(ge=1, le=10000)
    attempts: int = Field(ge=1, le=1000)
    outcome: Literal["unresolved", "recovered_by_retry", "corrected_manually", "skipped"]
    reasons: list[Tag] = Field(default_factory=list, max_length=11)
    suspected: list[Tag] = Field(default_factory=list, max_length=11)
    reported: list[Tag] = Field(default_factory=list, max_length=11)

@router.put("/{scan_id}")
async def record_failure(scan_id: uuid.UUID, body: FailureIn, response: Response,
                         auth: CurrentAuth = Depends(require_ready_auth),
                         database: AsyncSession = Depends(get_db)):
    if not (body.reasons or body.reported):
        raise AppError(422, "missing_reason", "Record a failure reason or a user-reported issue.")
    from sqlalchemy.dialects.postgresql import insert as postgres_insert
    from sqlalchemy.dialects.sqlite import insert as sqlite_insert
    now = datetime.now(UTC)
    values = body.model_dump()
    for key in ("reasons", "suspected", "reported"):
        values[key] = sorted(set(values[key]))
    insert = postgres_insert if database.bind.dialect.name == "postgresql" else sqlite_insert
    statement = insert(ScanFailure).values(**values, user_id=auth.user.id, scan_id=scan_id, created_at=now, updated_at=now)
    statement = statement.on_conflict_do_update(index_elements=["user_id", "scan_id"],
        set_={**values, "updated_at": now}, where=ScanFailure.revision < body.revision)
    await database.execute(statement)
    # Bound storage per account; old diagnostic records are not collection history.
    await database.execute(delete(ScanFailure).where(ScanFailure.user_id == auth.user.id,
        ScanFailure.created_at < now - timedelta(days=90)))
    overflow = select(ScanFailure.scan_id).where(ScanFailure.user_id == auth.user.id).order_by(
        ScanFailure.created_at.desc(), ScanFailure.scan_id).offset(1000)
    await database.execute(delete(ScanFailure).where(ScanFailure.user_id == auth.user.id,
        ScanFailure.scan_id.in_(overflow)))
    await database.commit()
    response.headers["Cache-Control"] = "no-store"
    return {"saved": True}

@router.get("")
async def list_failures(response: Response, all_accounts: bool = False,
                        auth: CurrentAuth = Depends(require_ready_auth),
                        database: AsyncSession = Depends(get_db)):
    if all_accounts and auth.user.role not in ("owner", "super_admin", "admin"):
        raise AppError(403, "forbidden", "Admin access is required.")
    statement = select(ScanFailure).where(ScanFailure.created_at >= datetime.now(UTC) - timedelta(days=90))
    if not all_accounts:
        statement = statement.where(ScanFailure.user_id == auth.user.id)
    rows = (await database.execute(statement.order_by(ScanFailure.created_at.desc()).limit(100))).scalars().all()
    response.headers["Cache-Control"] = "no-store"
    return {"items": [{"scan_id": str(row.scan_id), "mode": row.mode, "attempts": row.attempts,
        "outcome": row.outcome, "reasons": row.reasons, "suspected": row.suspected, "reported": row.reported,
        "created_at": row.created_at, "updated_at": row.updated_at} for row in rows]}


async def cleanup_failure_logs(factory):
    """Prune inactive accounts too; retention does not depend on future scans."""
    import asyncio
    import logging
    while True:
        try:
            async with factory() as database:
                await database.execute(delete(ScanFailure).where(
                    ScanFailure.created_at < datetime.now(UTC) - timedelta(days=90)))
                await database.commit()
        except Exception:
            logging.getLogger(__name__).warning("Scan log cleanup will retry later")
        await asyncio.sleep(3600)
