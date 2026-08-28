#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import csv
import io
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import Settings
from app.main import create_app
from app.models import CollectionItem
from app.routers import collection as collection_router
from tests.test_catalog_api import BOLT_PRINTING_ID, _seed_catalog


def csv_payload(quantity: int) -> bytes:
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\r\n")
    writer.writerow(
        (
            "schema_version",
            "scryfall_printing_id",
            "card_name",
            "set_code",
            "collector_number",
            "language",
            "finish",
            "condition",
            "quantity",
        )
    )
    writer.writerow(
        (
            "1",
            str(BOLT_PRINTING_ID),
            "Lightning Bolt",
            "m10",
            "146",
            "en",
            "nonfoil",
            "near_mint",
            quantity,
        )
    )
    return stream.getvalue().encode()


def login(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={
            "email": "member-100567f0c241@example.invalid",
            "password": "test-only-credential-09b42765cf0d",
        },
    )
    assert response.status_code == 200


async def item_state(factory: async_sessionmaker) -> tuple[int, int, int]:
    async with factory() as database:
        items = list((await database.scalars(select(CollectionItem))).all())
        assert len(items) == 1
        return len(items), items[0].quantity, items[0].revision


def main() -> None:
    database_url = os.environ["CARDS_TEST_DATABASE_URL"]
    with TemporaryDirectory() as temp_dir:
        bootstrap = Path(temp_dir) / "bootstrap"
        pepper = Path(temp_dir) / "pepper"
        mfa_key = Path(temp_dir) / "mfa_key"
        bootstrap.write_text("collection-import-bootstrap")
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

        with TestClient(app) as setup:
            response = setup.post(
                "/api/v1/setup/owner",
                json={
                    "email": "member-52232a79b8ce@example.invalid",
                    "display_name": "Wynter Owner",
                    "password": "test-only-credential-ad9936ecb1c3",
                },
                headers={"X-Bootstrap-Secret": "test-only-credential-2a1660521963"},
            )
            assert response.status_code == 201

        with TestClient(app) as first, TestClient(app) as second:
            login(first)
            login(second)
            preview = first.post(
                "/api/v1/collection/imports/preview",
                content=csv_payload(2),
                headers={"content-type": "text/csv"},
            )
            assert preview.status_code == 201
            preview_id = preview.json()["id"]

            original_confirm = collection_router.confirm_preview
            gate = threading.Barrier(2)

            async def synchronized_confirm(database, user_id, requested_preview_id):
                await asyncio.to_thread(gate.wait, 10)
                return await original_confirm(database, user_id, requested_preview_id)

            collection_router.confirm_preview = synchronized_confirm
            try:
                with ThreadPoolExecutor(max_workers=2) as executor:
                    one = executor.submit(
                        first.post,
                        f"/api/v1/collection/imports/{preview_id}/confirm",
                    )
                    two = executor.submit(
                        second.post,
                        f"/api/v1/collection/imports/{preview_id}/confirm",
                    )
                    responses = [one.result(timeout=20), two.result(timeout=20)]
            finally:
                collection_router.confirm_preview = original_confirm

            assert sorted(response.status_code for response in responses) == [200, 409], [
                (response.status_code, response.text) for response in responses
            ]
            assert asyncio.run(item_state(factory)) == (1, 2, 1)

            stale_preview = first.post(
                "/api/v1/collection/imports/preview",
                content=csv_payload(1),
                headers={"content-type": "text/csv"},
            )
            assert stale_preview.status_code == 201
            stale_id = stale_preview.json()["id"]

            mutation_started = threading.Event()
            release_mutation = threading.Event()

            async def hold_mutation() -> None:
                async with factory() as database, database.begin():
                    item = await database.scalar(select(CollectionItem).with_for_update())
                    assert item is not None
                    item.quantity = 4
                    item.revision += 1
                    await database.flush()
                    mutation_started.set()
                    await asyncio.to_thread(release_mutation.wait, 10)

            with ThreadPoolExecutor(max_workers=2) as executor:
                mutation = executor.submit(asyncio.run, hold_mutation())
                assert mutation_started.wait(10)
                confirmation = executor.submit(
                    second.post,
                    f"/api/v1/collection/imports/{stale_id}/confirm",
                )
                time.sleep(0.25)
                assert not confirmation.done()
                release_mutation.set()
                mutation.result(timeout=20)
                stale_response = confirmation.result(timeout=20)

            assert stale_response.status_code == 409, stale_response.text
            assert stale_response.json()["error"]["code"] == "collection_import_stale"
            assert asyncio.run(item_state(factory)) == (1, 4, 2)

        asyncio.run(engine.dispose())
    print("postgres-collection-import-smoke-ok")


if __name__ == "__main__":
    main()
