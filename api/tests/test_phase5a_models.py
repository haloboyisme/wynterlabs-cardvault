import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base
from app.models import CollectionImportPreview, User


def test_collection_import_preview_persists_normalized_rows_and_defaults(tmp_path) -> None:
    asyncio.run(_persist_preview(tmp_path))


async def _persist_preview(tmp_path) -> None:
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'phase5a.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    user = _user()
    preview = CollectionImportPreview(
        user_id=user.id,
        source_sha256="a" * 64,
        rows=[{"row_number": 2, "printing_id": str(uuid.uuid4()), "quantity": 2}],
        summary={"additions": 1, "errors": 0},
        collection_digest="b" * 64,
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    async with factory() as session:
        session.add_all([user, preview])
        await session.commit()
        saved = await session.get(CollectionImportPreview, preview.id)
    assert saved is not None
    assert saved.user_id == user.id
    assert saved.rows[0]["row_number"] == 2
    assert saved.summary == {"additions": 1, "errors": 0}
    assert saved.revision == 1
    assert saved.confirmed_at is None
    assert saved.created_at is not None
    await engine.dispose()


def test_collection_import_preview_rejects_invalid_revision_and_cascades_with_user(
    tmp_path,
) -> None:
    asyncio.run(_constraints_and_cascade(tmp_path))


async def _constraints_and_cascade(tmp_path) -> None:
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'phase5a-constraints.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    user = _user()
    user_id = user.id
    async with factory() as session:
        session.add(user)
        await session.commit()
        session.add(
            CollectionImportPreview(
                user_id=user_id,
                source_sha256="c" * 64,
                rows=[],
                summary={},
                collection_digest="d" * 64,
                revision=0,
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
        )
        with pytest.raises(IntegrityError):
            await session.commit()
        await session.rollback()

    valid = CollectionImportPreview(
        user_id=user_id,
        source_sha256="e" * 64,
        rows=[],
        summary={},
        collection_digest="f" * 64,
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    async with factory() as session:
        session.add(valid)
        await session.commit()
        foreign_key = next(iter(CollectionImportPreview.__table__.foreign_keys))
        assert foreign_key.column.table.name == "users"
        assert foreign_key.ondelete == "CASCADE"
    await engine.dispose()


def _user() -> User:
    marker = uuid.uuid4().hex
    return User(
        id=uuid.uuid4(),
        email=f"{marker}@invalid.local",
        email_normalized=f"{marker}@invalid.local",
        display_name=marker,
        display_name_normalized=marker,
        password_hash="not-a-real-hash",
    )
