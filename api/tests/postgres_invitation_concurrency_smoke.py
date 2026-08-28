#!/usr/bin/env python3
import asyncio
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import Settings
from app.main import create_app
from app.models import AccountInvitation, Role, User, UserSession


async def state(factory: async_sessionmaker) -> tuple[int, int, int]:
    async with factory() as database:
        invitation = await database.scalar(select(AccountInvitation))
        assert invitation is not None
        members = await database.scalar(select(func.count(User.id)).where(User.role == Role.MEMBER))
        sessions = await database.scalar(
            select(func.count(UserSession.id))
            .join(User, User.id == UserSession.user_id)
            .where(User.role == Role.MEMBER)
        )
        return int(invitation.used_at is not None), int(members or 0), int(sessions or 0)


def synchronize_locks() -> object:
    original = AsyncSession.scalar
    barrier = threading.Barrier(2)
    local = threading.local()

    async def synchronized(self, statement, *args, **kwargs):
        sql = str(statement)
        if (
            "FROM account_invitations" in sql
            and "FOR UPDATE" in sql
            and not getattr(local, "waited", False)
        ):
            local.waited = True
            await asyncio.to_thread(barrier.wait, 10)
        return await original(self, statement, *args, **kwargs)

    AsyncSession.scalar = synchronized
    return original


def login(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={
            "email": "member-f51577ff6252@example.invalid",
            "password": "test-only-credential-e5f625db6f1a",
        },
    )
    assert response.status_code == 200


def main() -> None:
    database_url = os.environ["CARDS_TEST_DATABASE_URL"]
    with TemporaryDirectory() as temp_dir:
        bootstrap = Path(temp_dir) / "bootstrap"
        pepper = Path(temp_dir) / "pepper"
        mfa_key = Path(temp_dir) / "mfa_key"
        bootstrap.write_text("invitation-concurrency-bootstrap")
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
        with TestClient(app) as setup:
            created = setup.post(
                "/api/v1/setup/owner",
                json={
                    "email": "member-4596568a87b2@example.invalid",
                    "display_name": "Wynter Owner",
                    "password": "test-only-credential-71e7394e9960",
                },
                headers={"X-Bootstrap-Secret": "test-only-credential-764e34835932"},
            )
            assert created.status_code == 201

        with TestClient(app) as owner:
            login(owner)
            invitation = owner.post("/api/v1/admin/invitations").json()

        original = synchronize_locks()
        try:
            with (  # noqa: SIM117
                TestClient(app, raise_server_exceptions=False) as first,
                TestClient(app, raise_server_exceptions=False) as second,
            ):
                with ThreadPoolExecutor(max_workers=2) as executor:  # noqa: SIM117
                    requests = [
                        executor.submit(
                            client.post,
                            "/api/v1/invitations/accept",
                            json={
                                "token": invitation["raw_token"],
                                "email": f"member{index}@example.com",
                                "display_name": f"Member {index}",
                                "password": "test-only-credential-32681165d59b",
                            },
                        )
                        for index, client in enumerate((first, second), start=1)
                    ]
                    responses = [request.result(timeout=20) for request in requests]
        finally:
            AsyncSession.scalar = original
        assert sorted(response.status_code for response in responses) == [201, 400]
        assert asyncio.run(state(factory)) == (1, 1, 1)

        with TestClient(app) as owner:
            login(owner)
            invitation = owner.post("/api/v1/admin/invitations").json()

        original = synchronize_locks()
        try:
            with (  # noqa: SIM117
                TestClient(app, raise_server_exceptions=False) as recipient,
                TestClient(app, raise_server_exceptions=False) as owner,
            ):
                login(owner)
                with ThreadPoolExecutor(max_workers=2) as executor:  # noqa: SIM117
                    accepted = executor.submit(
                        recipient.post,
                        "/api/v1/invitations/accept",
                        json={
                            "token": invitation["raw_token"],
                            "email": "ordered@example.com",
                            "display_name": "Ordered Member",
                            "password": "test-only-credential-883e707d58b8",
                        },
                    )
                    revoked = executor.submit(
                        owner.post,
                        f"/api/v1/admin/invitations/{invitation['id']}/revoke",
                        json={"expected_revision": 1},
                    )
                    ordered = [accepted.result(timeout=20), revoked.result(timeout=20)]
        finally:
            AsyncSession.scalar = original
        assert sum(response.status_code < 300 for response in ordered) == 1
        assert all(response.status_code < 500 for response in ordered)
        asyncio.run(engine.dispose())
    print("postgres-invitation-concurrency-smoke-ok")


if __name__ == "__main__":
    main()
