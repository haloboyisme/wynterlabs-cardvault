from typing import Any

from sqlalchemy import func, select
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
        active_rows = (
            await session.scalars(select(CatalogImport).where(CatalogImport.active))
        ).all()
        ranked = select(
            CatalogImport.id,
            func.row_number()
            .over(partition_by=CatalogImport.game, order_by=CatalogImport.started_at.desc())
            .label("position"),
        ).subquery()
        latest_rows = (
            await session.scalars(
                select(CatalogImport)
                .join(ranked, CatalogImport.id == ranked.c.id)
                .where(ranked.c.position == 1)
            )
        ).all()
        active = {row.game: row for row in active_rows}
        latest = {row.game: row for row in latest_rows}
        games = {
            game: {
                "active_catalog": catalog_attempt(active.get(game)),
                "latest_attempt": catalog_attempt(latest.get(game)),
            }
            for game in SUPPORTED_GAME_KEYS
        }
    return {
        "active_catalog": catalog_attempt(active.get("mtg")),
        "latest_attempt": catalog_attempt(latest.get("mtg")),
        "games": games,
    }
