import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base
from app.models import AccountInvitation, Role, User
from app.security import hash_invitation_token, new_invitation_token


def test_invitation_tokens_are_unique_url_safe_and_domain_separated() -> None:
    first = new_invitation_token()
    second = new_invitation_token()
    assert first != second
    assert len(first) >= 40
    assert hash_invitation_token(first, "p" * 64) != hash_invitation_token(first, "q" * 64)
    assert len(hash_invitation_token(first, "p" * 64)) == 64


def test_account_invitation_defaults_constraints_and_no_raw_token_column(tmp_path) -> None:
    asyncio.run(_persist_invitation(tmp_path))


async def _persist_invitation(tmp_path) -> None:
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'invite.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    owner = _owner()
    invitation = AccountInvitation(
        token_hash="a" * 64,
        created_by_user_id=owner.id,
        expires_at=datetime.now(UTC) + timedelta(days=7),
    )
    async with factory() as database:
        database.add_all([owner, invitation])
        await database.commit()
        saved = await database.get(AccountInvitation, invitation.id)
        assert saved is not None
        assert saved.revision == 1
        assert saved.revoked_at is None
        assert saved.used_at is None
        assert saved.used_by_user_id is None
        assert saved.created_at is not None
    assert "raw_token" not in AccountInvitation.__table__.columns
    creator_fk = next(
        key
        for key in AccountInvitation.__table__.foreign_keys
        if key.parent.name == "created_by_user_id"
    )
    assert creator_fk.ondelete == "CASCADE"
    await engine.dispose()


def test_account_invitation_rejects_invalid_revision_and_used_revoked_state(
    tmp_path,
) -> None:
    asyncio.run(_invalid_states(tmp_path))


async def _invalid_states(tmp_path) -> None:
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'invite-invalid.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    owner = _owner()
    owner_id = owner.id
    async with factory() as database:
        database.add(owner)
        await database.commit()
        database.add(
            AccountInvitation(
                token_hash="b" * 64,
                created_by_user_id=owner_id,
                revision=0,
                expires_at=datetime.now(UTC) + timedelta(days=7),
            )
        )
        with pytest.raises(IntegrityError):
            await database.commit()
        await database.rollback()

        now = datetime.now(UTC)
        database.add(
            AccountInvitation(
                token_hash="c" * 64,
                created_by_user_id=owner_id,
                expires_at=now + timedelta(days=7),
                revoked_at=now,
                used_at=now,
            )
        )
        with pytest.raises(IntegrityError):
            await database.commit()
    await engine.dispose()


def _owner() -> User:
    marker = uuid.uuid4().hex
    return User(
        id=uuid.uuid4(),
        email=f"{marker}@invalid.local",
        email_normalized=f"{marker}@invalid.local",
        display_name=marker,
        display_name_normalized=marker,
        password_hash="not-a-real-hash",
        role=Role.OWNER,
        owner_slot=1,
    )
