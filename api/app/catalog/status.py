from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.catalog.games import SUPPORTED_GAME_KEYS
from app.models import CatalogImport


def catalog_attempt(item: CatalogImport | None) -> dict[str, Any] | None:
    if item is None:
        return None
    return {
        "import_id": str(item.id),
        "status": item.status,
        "source_updated_at": item.source_updated_at.isoformat(),
        "completed_at": item.completed_at.isoformat() if item.completed_at else None,
        "total_records": item.total_records,
        "imported_records": item.imported_records,
        "rejected_records": item.rejected_records,
        "set_count": item.set_count,
        "oracle_count": item.oracle_count,
        "printing_count": item.printing_count,
        "error_summary": item.error_summary,
    }


async def read_catalog_status(
    session_factory: async_sessionmaker[AsyncSession],
) -> dict[str, Any]:
    async with session_factory() as session:
        active = await session.scalar(
            select(CatalogImport).where(CatalogImport.active, CatalogImport.game == "mtg")
        )
        latest = await session.scalar(
            select(CatalogImport)
            .where(CatalogImport.game == "mtg")
            .order_by(CatalogImport.started_at.desc())
            .limit(1)
        )
        games = {}
        for game in SUPPORTED_GAME_KEYS:
            games[game] = {
                "active_catalog": catalog_attempt(
                    await session.scalar(
                        select(CatalogImport).where(
                            CatalogImport.active, CatalogImport.game == game
                        )
                    )
                ),
                "latest_attempt": catalog_attempt(
                    await session.scalar(
                        select(CatalogImport)
                        .where(CatalogImport.game == game)
                        .order_by(CatalogImport.started_at.desc())
                        .limit(1)
                    )
                ),
            }
    return {
        "active_catalog": catalog_attempt(active),
        "latest_attempt": catalog_attempt(latest),
        "games": games,
    }
