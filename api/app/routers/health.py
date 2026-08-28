from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db

router = APIRouter(prefix="/api/health", tags=["health"])


@router.get("/live")
async def live() -> dict[str, str]:
    return {"status": "ok", "service": "wynterlabs-cards-api"}


@router.get("/ready")
async def ready(database: AsyncSession = Depends(get_db)) -> dict[str, str]:
    await database.execute(text("SELECT 1"))
    return {"status": "ready", "service": "wynterlabs-cards-api"}
