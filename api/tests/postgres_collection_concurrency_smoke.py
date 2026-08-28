#!/usr/bin/env python3
import asyncio
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import Settings
from app.main import create_app
from app.models import CollectionItem
from app.routers import collection as collection_router
from tests.test_catalog_api import BOLT_PRINTING_ID, _seed_catalog


async def collection_state(factory: async_sessionmaker) -> tuple[int, int, int, uuid.UUID]:
    async with factory() as database:
        items = list((await database.scalars(select(CollectionItem))).all())
        assert len(items) == 1
        item = items[0]
        return len(items), item.quantity, item.revision, item.id


async def target_state(
    factory: async_sessionmaker, printing_id: uuid.UUID, finish: str, condition: str
) -> list[tuple[int, int]]:
    async with factory() as database:
        items = list(
            (
                await database.scalars(
                    select(CollectionItem)
                    .where(
                        CollectionItem.printing_id == printing_id,
                        CollectionItem.finish == finish,
                        CollectionItem.condition == condition,
                    )
                    .order_by(CollectionItem.id)
                )
            ).all()
        )
        return [(item.quantity, item.revision) for item in items]


async def items_state(
    factory: async_sessionmaker, item_ids: set[uuid.UUID]
) -> list[tuple[uuid.UUID, str, str, int, int]]:
    async with factory() as database:
        items = list(
            (
                await database.scalars(
                    select(CollectionItem)
                    .where(CollectionItem.id.in_(item_ids))
                    .order_by(CollectionItem.id)
                )
            ).all()
        )
        return [
            (item.id, item.finish, item.condition, item.quantity, item.revision) for item in items
        ]


def main() -> None:
    database_url = os.environ["CARDS_TEST_DATABASE_URL"]
    with TemporaryDirectory() as temp_dir:
        bootstrap = Path(temp_dir) / "bootstrap"
        pepper = Path(temp_dir) / "pepper"
        mfa_key = Path(temp_dir) / "mfa_key"
        bootstrap.write_text("collection-concurrency-bootstrap")
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

        with TestClient(app) as setup_client:
            setup = setup_client.post(
                "/api/v1/setup/owner",
                json={
                    "email": "member-4ad8abf305fe@example.invalid",
                    "display_name": "Wynter Owner",
                    "password": "test-only-credential-09ff7527ec49",
                },
                headers={"X-Bootstrap-Secret": "test-only-credential-3f03f3746835"},
            )
            assert setup.status_code == 201

        original_active_printing = collection_router._active_printing
        gate = threading.Barrier(2)

        async def synchronized_active_printing(database, printing_id):
            printing = await original_active_printing(database, printing_id)
            await asyncio.to_thread(gate.wait, 10)
            return printing

        collection_router._active_printing = synchronized_active_printing
        try:
            with TestClient(app) as first, TestClient(app) as second:
                for client in (first, second):
                    login = client.post(
                        "/api/v1/auth/login",
                        json={
                            "email": "member-dbc5ae25b40e@example.invalid",
                            "password": "test-only-credential-f90315da6383",
                        },
                    )
                    assert login.status_code == 200
                payload = {
                    "printing_id": str(BOLT_PRINTING_ID),
                    "finish": "nonfoil",
                    "condition": "near_mint",
                    "quantity": 2,
                }
                with ThreadPoolExecutor(max_workers=2) as executor:
                    first_result = executor.submit(
                        first.post, "/api/v1/collection/items", json=payload
                    )
                    second_payload = {**payload, "quantity": 3}
                    second_result = executor.submit(
                        second.post, "/api/v1/collection/items", json=second_payload
                    )
                    responses = [first_result.result(timeout=20), second_result.result(timeout=20)]
                assert sorted(response.status_code for response in responses) == [200, 201]
                count, quantity, revision, item_id = asyncio.run(collection_state(factory))
                assert (count, quantity, revision) == (1, 5, 2)
                stale = first.put(
                    f"/api/v1/collection/items/{item_id}",
                    json={"quantity": 6, "expected_revision": 1},
                )
                assert stale.status_code == 409
                assert stale.json()["error"]["code"] == "collection_item_stale"
                assert asyncio.run(collection_state(factory))[:3] == (1, 5, 2)
                collection_router._active_printing = original_active_printing
                first_source = first.post(
                    "/api/v1/collection/items",
                    json={
                        "printing_id": str(BOLT_PRINTING_ID),
                        "finish": "nonfoil",
                        "condition": "lightly_played",
                        "quantity": 1,
                    },
                )
                second_source = first.post(
                    "/api/v1/collection/items",
                    json={
                        "printing_id": str(BOLT_PRINTING_ID),
                        "finish": "foil",
                        "condition": "near_mint",
                        "quantity": 1,
                    },
                )
                assert first_source.status_code == second_source.status_code == 201

                with (
                    TestClient(app, raise_server_exceptions=False) as update_first,
                    TestClient(app, raise_server_exceptions=False) as update_second,
                ):
                    for client in (update_first, update_second):
                        login = client.post(
                            "/api/v1/auth/login",
                            json={
                                "email": "member-e36d86966a89@example.invalid",
                                "password": "test-only-credential-ee0a8cfaa5fa",
                            },
                        )
                        assert login.status_code == 200
                    update_payload = {
                        "finish": "foil",
                        "condition": "damaged",
                        "expected_revision": 1,
                    }
                    with ThreadPoolExecutor(max_workers=2) as executor:
                        first_update = executor.submit(
                            update_first.put,
                            "/api/v1/collection/items/" + first_source.json()["id"],
                            json=update_payload,
                        )
                        second_update = executor.submit(
                            update_second.put,
                            "/api/v1/collection/items/" + second_source.json()["id"],
                            json=update_payload,
                        )
                        updates = [
                            first_update.result(timeout=20),
                            second_update.result(timeout=20),
                        ]
                assert sorted(response.status_code for response in updates) == [200, 409], [
                    response.status_code for response in updates
                ]
                assert asyncio.run(target_state(factory, BOLT_PRINTING_ID, "foil", "damaged")) == [
                    (1, 2)
                ]

                swap_first = first.post(
                    "/api/v1/collection/items",
                    json={
                        "printing_id": str(BOLT_PRINTING_ID),
                        "finish": "nonfoil",
                        "condition": "moderately_played",
                        "quantity": 2,
                    },
                )
                swap_second = first.post(
                    "/api/v1/collection/items",
                    json={
                        "printing_id": str(BOLT_PRINTING_ID),
                        "finish": "foil",
                        "condition": "heavily_played",
                        "quantity": 3,
                    },
                )
                assert swap_first.status_code == swap_second.status_code == 201
                swap_ids = {
                    uuid.UUID(swap_first.json()["id"]),
                    uuid.UUID(swap_second.json()["id"]),
                }
                before_swap = asyncio.run(items_state(factory, swap_ids))

                original_scalar = AsyncSession.scalar
                original_scalars = AsyncSession.scalars
                swap_gate = threading.Barrier(2)
                thread_state = threading.local()

                async def synchronized_source_lock(self, *args, **kwargs):
                    result = await original_scalar(self, *args, **kwargs)
                    if (
                        isinstance(result, CollectionItem)
                        and result.id in swap_ids
                        and not getattr(thread_state, "source_locked", False)
                    ):
                        thread_state.source_locked = True
                        await asyncio.to_thread(swap_gate.wait, 10)
                    return result

                async def synchronized_scope_lock(self, *args, **kwargs):
                    statement = str(args[0]) if args else ""
                    if (
                        "FROM collection_items" in statement
                        and "ORDER BY collection_items.id" in statement
                        and "FOR UPDATE" in statement
                        and not getattr(thread_state, "scope_waited", False)
                    ):
                        thread_state.scope_waited = True
                        await asyncio.to_thread(swap_gate.wait, 10)
                    return await original_scalars(self, *args, **kwargs)

                AsyncSession.scalar = synchronized_source_lock
                AsyncSession.scalars = synchronized_scope_lock
                try:
                    with (
                        TestClient(app, raise_server_exceptions=False) as swap_client_one,
                        TestClient(app, raise_server_exceptions=False) as swap_client_two,
                    ):
                        for client in (swap_client_one, swap_client_two):
                            login = client.post(
                                "/api/v1/auth/login",
                                json={
                                    "email": "member-10f921d9c090@example.invalid",
                                    "password": "test-only-credential-a44baeb5ac3e",
                                },
                            )
                            assert login.status_code == 200
                        with ThreadPoolExecutor(max_workers=2) as executor:
                            first_swap = executor.submit(
                                swap_client_one.put,
                                "/api/v1/collection/items/" + swap_first.json()["id"],
                                json={
                                    "finish": "foil",
                                    "condition": "heavily_played",
                                    "expected_revision": 1,
                                },
                            )
                            second_swap = executor.submit(
                                swap_client_two.put,
                                "/api/v1/collection/items/" + swap_second.json()["id"],
                                json={
                                    "finish": "nonfoil",
                                    "condition": "moderately_played",
                                    "expected_revision": 1,
                                },
                            )
                            swap_responses = [
                                first_swap.result(timeout=20),
                                second_swap.result(timeout=20),
                            ]
                    assert [response.status_code for response in swap_responses] == [409, 409], [
                        (response.status_code, response.text) for response in swap_responses
                    ]
                    assert all(
                        response.json()["error"]["code"] == "collection_tuple_conflict"
                        for response in swap_responses
                    )
                    assert asyncio.run(items_state(factory, swap_ids)) == before_swap
                finally:
                    AsyncSession.scalar = original_scalar
                    AsyncSession.scalars = original_scalars

        finally:
            collection_router._active_printing = original_active_printing
            asyncio.run(engine.dispose())
    print("postgres-collection-concurrency-smoke-ok")


if __name__ == "__main__":
    main()
