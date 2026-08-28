#!/usr/bin/env python3
import asyncio
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import Settings
from app.main import create_app
from app.models import CollectionItem, TradeListing
from tests.test_catalog_api import BOLT_PRINTING_ID, _seed_catalog


async def state(factory: async_sessionmaker) -> tuple[int, int, int, int]:
    async with factory() as database:
        item = await database.scalar(select(CollectionItem))
        listing = await database.scalar(select(TradeListing))
        assert item is not None and listing is not None
        return item.quantity, item.revision, listing.quantity, listing.revision


def main() -> None:
    database_url = os.environ["CARDS_TEST_DATABASE_URL"]
    with TemporaryDirectory() as temp_dir:
        bootstrap = Path(temp_dir) / "bootstrap"
        pepper = Path(temp_dir) / "pepper"
        mfa_key = Path(temp_dir) / "mfa_key"
        bootstrap.write_text("trade-concurrency-bootstrap")
        pepper.write_text("p" * 64)
        mfa_key.write_bytes(bytes(range(32)))
        settings = Settings(
            database_url=database_url,
            bootstrap_secret_file=str(bootstrap),
            session_pepper_file=str(pepper),
            mfa_encryption_key_file=str(mfa_key),
            environment="development",
            trading_enabled=True,
        )
        engine = create_async_engine(database_url, poolclass=NullPool)
        factory = async_sessionmaker(engine, expire_on_commit=False)
        app = create_app(settings=settings, session_factory=factory)
        asyncio.run(_seed_catalog(app))

        with TestClient(app) as setup:
            owner = setup.post(
                "/api/v1/setup/owner",
                json={
                    "email": "member-3f0cdbeb5c63@example.invalid",
                    "display_name": "Wynter Owner",
                    "password": "test-only-credential-70c0ff09e322",
                },
                headers={"X-Bootstrap-Secret": "test-only-credential-f0b2d6509ce7"},
            )
            assert owner.status_code == 201
            login = setup.post(
                "/api/v1/auth/login",
                json={
                    "email": "member-d6ccc4242ce4@example.invalid",
                    "password": "test-only-credential-5a11d8a4d5fd",
                },
            )
            assert login.status_code == 200
            created_item = setup.post(
                "/api/v1/collection/items",
                json={
                    "printing_id": str(BOLT_PRINTING_ID),
                    "finish": "nonfoil",
                    "condition": "near_mint",
                    "quantity": 10,
                },
            )
            assert created_item.status_code == 201
            item_id = created_item.json()["id"]
            created_listing = setup.post(
                "/api/v1/trades",
                json={"collection_item_id": item_id, "quantity": 10},
            )
            assert created_listing.status_code == 201
            listing_id = created_listing.json()["id"]

        with (
            TestClient(app, raise_server_exceptions=False) as collection_client,
            TestClient(app, raise_server_exceptions=False) as trade_client,
        ):
            for client in (collection_client, trade_client):
                login = client.post(
                    "/api/v1/auth/login",
                    json={
                        "email": "member-abf003dcf024@example.invalid",
                        "password": "test-only-credential-5f95fc586189",
                    },
                )
                assert login.status_code == 200

            for _ in range(8):
                item_quantity, item_revision, listing_quantity, listing_revision = asyncio.run(
                    state(factory)
                )
                if item_quantity != 10:
                    restored = collection_client.put(
                        f"/api/v1/collection/items/{item_id}",
                        json={"quantity": 10, "expected_revision": item_revision},
                    )
                    assert restored.status_code == 200
                    _, _, listing_quantity, listing_revision = asyncio.run(state(factory))
                if listing_quantity != 10:
                    restored_listing = trade_client.put(
                        f"/api/v1/trades/{listing_id}",
                        json={
                            "quantity": 10,
                            "status": "active",
                            "expected_revision": listing_revision,
                        },
                    )
                    assert restored_listing.status_code == 200

                _, item_revision, _, listing_revision = asyncio.run(state(factory))
                with ThreadPoolExecutor(max_workers=2) as executor:
                    collection_result = executor.submit(
                        collection_client.put,
                        f"/api/v1/collection/items/{item_id}",
                        json={"quantity": 1, "expected_revision": item_revision},
                    )
                    trade_result = executor.submit(
                        trade_client.put,
                        f"/api/v1/trades/{listing_id}",
                        json={
                            "quantity": 10,
                            "status": "active",
                            "expected_revision": listing_revision,
                        },
                    )
                    responses = [
                        collection_result.result(timeout=20),
                        trade_result.result(timeout=20),
                    ]
                assert all(response.status_code != 500 for response in responses)
                assert responses[0].status_code == 200
                assert responses[1].status_code in {200, 409}
                item_quantity, _, listing_quantity, _ = asyncio.run(state(factory))
                assert listing_quantity <= item_quantity == 1

        asyncio.run(engine.dispose())


if __name__ == "__main__":
    main()
