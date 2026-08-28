import argparse
import asyncio
import json
import sys
from collections.abc import Callable
from contextlib import suppress

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.catalog.games import SUPPORTED_GAME_KEYS
from app.catalog.importer import CatalogImporter
from app.catalog.status import read_catalog_status
from app.collection_value import capture_collection_price_snapshots
from app.config import Settings
from app.database import create_engine, create_session_factory


async def run(
    command: str,
    *,
    game: str = "all",
    settings: Settings | None = None,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
    importer_factory: Callable[..., CatalogImporter] = CatalogImporter,
) -> int:
    settings = settings or Settings()
    engine = None
    if session_factory is None:
        engine = create_engine(settings)
        session_factory = create_session_factory(engine)
    try:
        if command == "refresh":
            try:
                outcome = await importer_factory(settings, session_factory).refresh(game)
            except Exception:
                print(
                    "Catalog refresh failed; the previous active catalog was preserved.",
                    file=sys.stderr,
                )
                return 1
            if outcome.status == "complete":
                with suppress(Exception):
                    await capture_collection_price_snapshots(session_factory)
            payload = {
                "status": outcome.status,
                "import_id": str(outcome.import_id) if outcome.import_id else None,
                "imported_records": outcome.imported_records,
                "rejected_records": outcome.rejected_records,
                "skipped": outcome.skipped,
            }
        else:
            payload = await read_catalog_status(session_factory)
        print(json.dumps(payload, sort_keys=True))
        return 0
    finally:
        if engine is not None:
            await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description="WynterLabs catalog operator")
    parser.add_argument("command", choices=("refresh", "status"))
    parser.add_argument("--game", choices=("all", *SUPPORTED_GAME_KEYS), default="all")
    arguments = parser.parse_args()
    raise SystemExit(asyncio.run(run(arguments.command, game=arguments.game)))


if __name__ == "__main__":
    main()
