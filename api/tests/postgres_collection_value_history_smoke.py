#!/usr/bin/env python3
import asyncio
import os
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from sqlalchemy.sql.dml import Insert

from app.collection_value import capture_collection_value
from app.config import Settings
from app.main import create_app
from app.models import CollectionValueSnapshot, User
from tests.test_catalog_api import _seed_catalog


async def snapshot_state(factory: async_sessionmaker, user_id, minute: datetime):
    async with factory() as database:
        result = await database.scalars(
            select(CollectionValueSnapshot).where(
                CollectionValueSnapshot.user_id == user_id,
                CollectionValueSnapshot.minute_bucket == minute,
            )
        )
        return list(result.all())


def main() -> None:
    database_url = os.environ["POSTGRES_TEST_DATABASE_URL"]
    with TemporaryDirectory() as temp_dir:
        bootstrap = Path(temp_dir) / "bootstrap"
        pepper = Path(temp_dir) / "pepper"
        mfa_key = Path(temp_dir) / "mfa_key"
        bootstrap.write_text("collection-value-history-bootstrap")
        pepper.write_text("p" * 64)
        mfa_key.write_bytes(bytes(range(32)))
        settings = Settings(
            database_url=database_url,
            bootstrap_secret_file=str(bootstrap),
            session_pepper_file=str(pepper),
            mfa_encryption_key_file=str(mfa_key),
            environment="development",
        )
        engine = create_async_engine(database_url, poolclass=NullPool)
        factory = async_sessionmaker(engine, expire_on_commit=False)
        app = create_app(settings=settings, session_factory=factory)
        asyncio.run(_seed_catalog(app))
        with TestClient(app) as client:
            setup = client.post(
                "/api/v1/setup/owner",
                json={
                    "email": "member-a4dc8ed0ae0d@example.invalid",
                    "display_name": "Wynter Owner",
                    "password": "test-only-credential-dc83c95f3444",
                },
                headers={"X-Bootstrap-Secret": "test-only-credential-7fcc5330edbb"},
            )
            assert setup.status_code == 201

        async def user_id():
            async with factory() as database:
                return await database.scalar(select(User.id))

        owner_id = asyncio.run(user_id())
        assert owner_id is not None
        first = datetime(2026, 8, 27, 12, 30, 5, tzinfo=UTC)
        latest = datetime(2026, 8, 27, 12, 30, 45, tzinfo=UTC)
        insert_barrier = asyncio.Barrier(2)
        original_execute = AsyncSession.execute

        async def synchronized_execute(self, statement, *args, **kwargs):
            if (
                isinstance(statement, Insert)
                and statement.table.name == "collection_value_snapshots"
            ):
                await insert_barrier.wait()
            return await original_execute(self, statement, *args, **kwargs)

        async def capture_at(when: datetime) -> None:
            async with factory() as database:
                await capture_collection_value(database, owner_id, "view", now=when)
                await database.commit()

        async def capture_concurrently() -> None:
            await asyncio.gather(capture_at(first), capture_at(latest))

        AsyncSession.execute = synchronized_execute
        try:
            asyncio.run(capture_concurrently())
        finally:
            AsyncSession.execute = original_execute
        snapshots = asyncio.run(snapshot_state(factory, owner_id, first.replace(second=0)))
        assert len(snapshots) == 1
        assert snapshots[0].captured_at == latest
        asyncio.run(engine.dispose())


if __name__ == "__main__":
    main()
