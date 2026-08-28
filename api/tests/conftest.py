import asyncio
from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import Settings
from app.database import Base
from app.main import create_app


@pytest.fixture
def bootstrap_secret() -> str:
    return "winter-bootstrap-secret-for-tests"


@pytest.fixture
def app(tmp_path, bootstrap_secret: str) -> Iterator[FastAPI]:
    bootstrap_file = tmp_path / "bootstrap_secret"
    bootstrap_file.write_text(bootstrap_secret)
    pepper_file = tmp_path / "session_pepper"
    pepper_file.write_text("p" * 64)
    mfa_key_file = tmp_path / "mfa_key"
    mfa_key_file.write_bytes(bytes(range(32)))
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'cards.db'}"
    settings = Settings(
        database_url=database_url,
        bootstrap_secret_file=str(bootstrap_file),
        session_pepper_file=str(pepper_file),
        mfa_encryption_key_file=str(mfa_key_file),
        environment="development",
    )
    engine = create_async_engine(database_url)
    asyncio.run(_create_schema(engine))
    factory = async_sessionmaker(engine, expire_on_commit=False)
    application = create_app(settings=settings, session_factory=factory)
    yield application
    asyncio.run(engine.dispose())


async def _create_schema(engine) -> None:
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client
