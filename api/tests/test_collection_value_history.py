import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select
from test_admin_api import _authenticated_client
from test_catalog_api import BOLT_PRINTING_ID, STRIKE_PRINTING_ID, _seed_catalog

from app.collection_value import capture_collection_value, read_collection_value_history
from app.models import CardPrinting, CollectionItem, CollectionValueSnapshot, Role, User
from app.routers import collection as collection_router

OWNER_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
MEMBER_ID = uuid.UUID("44444444-4444-4444-4444-444444444444")


def _create(client: TestClient, **overrides):
    payload = {
        "printing_id": str(BOLT_PRINTING_ID),
        "finish": "nonfoil",
        "condition": "near_mint",
        "quantity": 2,
    }
    payload.update(overrides)
    return client.post("/api/v1/collection/items", json=payload)


async def _capture(app: FastAPI, user_id: uuid.UUID, now: datetime):
    async with app.state.session_factory() as database:
        snapshot = await capture_collection_value(database, user_id, "view", now=now)
        await database.commit()
        return snapshot


async def _snapshots(app: FastAPI, user_id: uuid.UUID) -> list[CollectionValueSnapshot]:
    async with app.state.session_factory() as database:
        result = await database.scalars(
            select(CollectionValueSnapshot)
            .where(CollectionValueSnapshot.user_id == user_id)
            .order_by(CollectionValueSnapshot.captured_at)
        )
        return list(result.all())


async def _set_value_fixtures(app: FastAPI) -> None:
    async with app.state.session_factory() as database:
        bolt = await database.scalar(
            select(CardPrinting).where(CardPrinting.id == BOLT_PRINTING_ID)
        )
        strike = await database.scalar(
            select(CardPrinting).where(CardPrinting.id == STRIKE_PRINTING_ID)
        )
        assert bolt is not None and strike is not None
        bolt.finishes = ["nonfoil", "etched"]
        bolt.prices = {"usd": "1.25", "usd_foil": None, "usd_etched": "3.00"}
        bolt.price_snapshot_at = datetime(2026, 8, 20, tzinfo=UTC)
        strike.prices = {"usd": None, "usd_foil": None, "usd_etched": None}
        await database.commit()


async def _set_quantity(app: FastAPI, item_id: str, quantity: int) -> None:
    async with app.state.session_factory() as database:
        item = await database.get(CollectionItem, uuid.UUID(item_id))
        assert item is not None
        item.quantity = quantity
        await database.commit()


async def _add_snapshot(
    app: FastAPI,
    user_id: uuid.UUID,
    when: datetime,
    value: str,
) -> None:
    async with app.state.session_factory() as database:
        database.add(
            CollectionValueSnapshot(
                user_id=user_id,
                minute_bucket=when.replace(second=0, microsecond=0),
                captured_at=when,
                estimated_value_usd=Decimal(value),
                priced_copies=1,
                unpriced_copies=0,
                total_copies=1,
                oldest_price_snapshot_at=None,
                trigger="view",
            )
        )
        await database.commit()


def test_capture_is_private_and_uses_existing_finish_and_manual_price_math(
    app: FastAPI,
) -> None:
    with (
        _authenticated_client(
            app,
            user_id=OWNER_ID,
            role=Role.OWNER,
            email="member-1de099bb3044@example.invalid",
            display_name="Wynter Owner",
        ) as owner_client,
        _authenticated_client(
            app,
            user_id=MEMBER_ID,
            role=Role.MEMBER,
            email="member-a38168649cfc@example.invalid",
            display_name="Wynter Member",
        ) as member_client,
    ):
        asyncio.run(_seed_catalog(app))
        asyncio.run(_set_value_fixtures(app))
        assert _create(owner_client, quantity=2).status_code == 201
        assert _create(owner_client, finish="etched", quantity=1).status_code == 201
        missing = _create(
            owner_client,
            printing_id=str(STRIKE_PRINTING_ID),
            quantity=4,
        )
        assert missing.status_code == 201
        assert (
            owner_client.put(
                f"/api/v1/collection/pricing/items/{missing.json()['id']}",
                json={"manual_price_usd": "4.25", "expected_revision": 1},
            ).status_code
            == 200
        )
        assert _create(member_client, quantity=9).status_code == 201

        now = datetime(2026, 8, 27, 12, 30, 5, tzinfo=UTC)
        owner = asyncio.run(_capture(app, OWNER_ID, now))
        member = asyncio.run(_capture(app, MEMBER_ID, now))

    assert owner.estimated_value_usd == Decimal("22.50")
    assert owner.priced_copies == 7
    assert owner.unpriced_copies == 0
    assert owner.total_copies == 7
    assert owner.oldest_price_snapshot_at.replace(
        tzinfo=owner.oldest_price_snapshot_at.tzinfo or UTC
    ) == datetime(2026, 8, 20, tzinfo=UTC)
    assert member.estimated_value_usd == Decimal("11.25")
    assert len(asyncio.run(_snapshots(app, OWNER_ID))) >= 1
    assert len(asyncio.run(_snapshots(app, MEMBER_ID))) >= 1


def test_capture_updates_the_same_minute_point(app: FastAPI) -> None:
    with _authenticated_client(
        app,
        user_id=OWNER_ID,
        role=Role.OWNER,
        email="member-42e7f0c2c36a@example.invalid",
        display_name="Wynter Owner",
    ) as client:
        asyncio.run(_seed_catalog(app))
        asyncio.run(_set_value_fixtures(app))
        created = _create(client, quantity=2)
        assert created.status_code == 201
        first = asyncio.run(_capture(app, OWNER_ID, datetime(2026, 8, 27, 12, 30, 5, tzinfo=UTC)))
        asyncio.run(_set_quantity(app, created.json()["id"], 3))
        second = asyncio.run(_capture(app, OWNER_ID, datetime(2026, 8, 27, 12, 30, 45, tzinfo=UTC)))

    points = [
        point
        for point in asyncio.run(_snapshots(app, OWNER_ID))
        if point.minute_bucket.replace(tzinfo=point.minute_bucket.tzinfo or UTC)
        == datetime(2026, 8, 27, 12, 30, tzinfo=UTC)
    ]
    assert first.id == second.id
    assert len(points) == 1
    assert points[0].captured_at.replace(tzinfo=points[0].captured_at.tzinfo or UTC) == datetime(
        2026, 8, 27, 12, 30, 45, tzinfo=UTC
    )
    assert points[0].estimated_value_usd == Decimal("3.75")


def test_same_minute_capture_upsert_keeps_the_newest_concurrent_timestamp(app: FastAPI) -> None:
    with _authenticated_client(
        app,
        user_id=OWNER_ID,
        role=Role.OWNER,
        email="member-13df8afdcf94@example.invalid",
        display_name="Wynter Owner",
    ) as client:
        asyncio.run(_seed_catalog(app))
        assert _create(client, quantity=2).status_code == 201

        async def capture_at(when: datetime) -> None:
            async with app.state.session_factory() as database:
                await capture_collection_value(database, OWNER_ID, "view", now=when)
                await database.commit()

        async def capture_concurrently() -> None:
            await asyncio.gather(
                capture_at(datetime(2026, 8, 27, 12, 30, 5, tzinfo=UTC)),
                capture_at(datetime(2026, 8, 27, 12, 30, 45, tzinfo=UTC)),
            )

        asyncio.run(capture_concurrently())

    points = [
        point
        for point in asyncio.run(_snapshots(app, OWNER_ID))
        if point.minute_bucket.replace(tzinfo=point.minute_bucket.tzinfo or UTC)
        == datetime(2026, 8, 27, 12, 30, tzinfo=UTC)
    ]
    assert len(points) == 1
    assert points[0].captured_at.replace(tzinfo=points[0].captured_at.tzinfo or UTC) == datetime(
        2026, 8, 27, 12, 30, 45, tzinfo=UTC
    )


def test_failed_best_effort_capture_cannot_turn_a_committed_collection_write_into_a_500(
    app: FastAPI,
    monkeypatch,
) -> None:
    async def fail_capture(*_args, **_kwargs):
        raise RuntimeError("snapshot storage unavailable")

    monkeypatch.setattr(collection_router, "capture_collection_value_best_effort", fail_capture)
    with _authenticated_client(
        app,
        user_id=OWNER_ID,
        role=Role.OWNER,
        email="member-27917773c811@example.invalid",
        display_name="Wynter Owner",
    ) as client:
        asyncio.run(_seed_catalog(app))
        created = _create(client, quantity=2)
        priced = client.put(
            f"/api/v1/collection/pricing/items/{created.json()['id']}",
            json={"manual_price_usd": "3.50", "expected_revision": 1},
        )

    assert created.status_code == 201
    assert created.json()["quantity"] == 2
    assert priced.status_code == 200
    assert priced.json()["manual_price_usd"] == "3.50"

    async def item_count() -> int:
        async with app.state.session_factory() as database:
            return int(await database.scalar(select(func.count()).select_from(CollectionItem)) or 0)

    assert asyncio.run(item_count()) == 1


def test_value_history_is_private_and_handles_zero_and_single_point_states(
    app: FastAPI,
) -> None:
    with (
        _authenticated_client(
            app,
            user_id=OWNER_ID,
            role=Role.OWNER,
            email="member-98ec22b289a1@example.invalid",
            display_name="Wynter Owner",
        ) as owner_client,
        _authenticated_client(
            app,
            user_id=MEMBER_ID,
            role=Role.MEMBER,
            email="member-6d2488d4cbee@example.invalid",
            display_name="Wynter Member",
        ) as member_client,
    ):
        asyncio.run(_seed_catalog(app))
        asyncio.run(_set_value_fixtures(app))
        assert _create(owner_client, quantity=2).status_code == 201
        owner = owner_client.get("/api/v1/collection/value-history", params={"range": "day"})
        member = member_client.get("/api/v1/collection/value-history", params={"range": "day"})

    assert owner.status_code == member.status_code == 200
    owner_body = owner.json()
    member_body = member.json()
    assert owner_body["current_value_usd"] == "2.50"
    assert owner_body["priced_copies"] == 2
    assert owner_body["unpriced_copies"] == 0
    assert owner_body["change_usd"] == "0.00"
    assert owner_body["change_percent"] == "0.00"
    assert len(owner_body["points"]) == 1
    assert member_body["current_value_usd"] == "0.00"
    assert member_body["total_copies"] == 0
    assert member_body["change_usd"] == "0.00"
    assert member_body["change_percent"] is None
    assert len(member_body["points"]) == 1


def test_history_ranges_apply_cutoffs_last_point_buckets_and_a_500_point_cap(app: FastAPI) -> None:
    with _authenticated_client(
        app,
        user_id=OWNER_ID,
        role=Role.OWNER,
        email="member-9db2bd256848@example.invalid",
        display_name="Wynter Owner",
    ):
        asyncio.run(_seed_catalog(app))
        now = datetime(2026, 8, 27, 12, 0, tzinfo=UTC)
        asyncio.run(_add_snapshot(app, OWNER_ID, now - timedelta(days=8), "1.00"))
        asyncio.run(_add_snapshot(app, OWNER_ID, now - timedelta(days=6, minutes=50), "2.00"))
        asyncio.run(_add_snapshot(app, OWNER_ID, now - timedelta(days=6, minutes=5), "3.00"))
        asyncio.run(_add_snapshot(app, OWNER_ID, now - timedelta(days=5), "4.00"))

        async def read_week():
            async with app.state.session_factory() as database:
                return await read_collection_value_history(database, OWNER_ID, "week", now=now)

        week = asyncio.run(read_week())
        assert [point.estimated_value_usd for point in week.points] == [
            Decimal("3.00"),
            Decimal("4.00"),
        ]

        async def add_many_months() -> None:
            async with app.state.session_factory() as database:
                for offset in range(501):
                    when = datetime(1980 + offset // 12, offset % 12 + 1, 1, tzinfo=UTC)
                    database.add(
                        CollectionValueSnapshot(
                            user_id=OWNER_ID,
                            minute_bucket=when,
                            captured_at=when,
                            estimated_value_usd=Decimal("1.00"),
                            priced_copies=1,
                            unpriced_copies=0,
                            total_copies=1,
                            oldest_price_snapshot_at=None,
                            trigger="view",
                        )
                    )
                await database.commit()

        asyncio.run(add_many_months())

        async def read_all():
            async with app.state.session_factory() as database:
                return await read_collection_value_history(database, OWNER_ID, "all", now=now)

        all_time = asyncio.run(read_all())

    assert len(all_time.points) == 500
    assert all_time.points == sorted(all_time.points, key=lambda point: point.captured_at)


def test_day_history_preserves_full_24_hours_when_more_than_500_snapshots(
    app: FastAPI,
    monkeypatch,
) -> None:
    with _authenticated_client(
        app,
        user_id=OWNER_ID,
        role=Role.OWNER,
        email="member-93b4104e025f@example.invalid",
        display_name="Wynter Owner",
    ) as client:
        asyncio.run(_seed_catalog(app))
        now = datetime(2026, 8, 27, 12, 0, tzinfo=UTC)

        async def add_minute_snapshots() -> None:
            async with app.state.session_factory() as database:
                start = now - timedelta(days=1)
                database.add_all(
                    [
                        CollectionValueSnapshot(
                            user_id=OWNER_ID,
                            minute_bucket=when,
                            captured_at=when,
                            estimated_value_usd=Decimal(index + 1),
                            priced_copies=1,
                            unpriced_copies=0,
                            total_copies=1,
                            oldest_price_snapshot_at=None,
                            trigger="view",
                        )
                        for index in range(24 * 60 + 1)
                        for when in [start + timedelta(minutes=index)]
                    ]
                )
                await database.commit()

        asyncio.run(add_minute_snapshots())

        async def skip_live_capture(*_args, **_kwargs) -> None:
            return None

        real_read_history = collection_router.read_collection_value_history

        async def read_history_at_fixed_time(database, user_id, range_name, **_kwargs):
            return await real_read_history(database, user_id, range_name, now=now)

        monkeypatch.setattr(collection_router, "_capture_current_value", skip_live_capture)
        monkeypatch.setattr(
            collection_router,
            "read_collection_value_history",
            read_history_at_fixed_time,
        )
        response = client.get(
            "/api/v1/collection/value-history",
            params={"range": "day"},
        )

    assert response.status_code == 200
    body = response.json()
    assert len(body["points"]) <= 500
    assert body["points"][0]["timestamp"] == "2026-08-26T12:00:00Z"
    assert body["points"][-1]["timestamp"] == "2026-08-27T12:00:00Z"
    assert body["points"][0]["estimated_value_usd"] == "1.00"
    assert body["points"][-1]["estimated_value_usd"] == "1441.00"
    assert body["change_usd"] == "1440.00"
    assert body["change_percent"] == "144000.00"


def test_every_history_range_enforces_its_cutoff_and_keeps_its_latest_bucket_point(
    app: FastAPI,
) -> None:
    with _authenticated_client(
        app,
        user_id=OWNER_ID,
        role=Role.OWNER,
        email="member-a97dc04a6b80@example.invalid",
        display_name="Wynter Owner",
    ):
        asyncio.run(_seed_catalog(app))
        now = datetime(2026, 8, 27, 12, 0, tzinfo=UTC)
        ranges = {
            "hour": timedelta(hours=1),
            "day": timedelta(days=1),
            "week": timedelta(days=7),
            "month": timedelta(days=31),
            "quarter": timedelta(days=92),
            "year": timedelta(days=366),
        }

        async def clear_snapshots() -> None:
            async with app.state.session_factory() as database:
                await database.execute(delete(CollectionValueSnapshot))
                await database.commit()

        for range_name, cutoff in ranges.items():
            asyncio.run(clear_snapshots())
            asyncio.run(_add_snapshot(app, OWNER_ID, now - cutoff - timedelta(minutes=1), "1.00"))
            asyncio.run(_add_snapshot(app, OWNER_ID, now - cutoff + timedelta(minutes=1), "2.00"))
            asyncio.run(_add_snapshot(app, OWNER_ID, now - timedelta(minutes=1), "3.00"))

            async def read_range(range_name=range_name):
                async with app.state.session_factory() as database:
                    return await read_collection_value_history(
                        database,
                        OWNER_ID,
                        range_name,
                        now=now,
                    )

            history = asyncio.run(read_range())
            assert [point.estimated_value_usd for point in history.points] == [
                Decimal("2.00"),
                Decimal("3.00"),
            ]


def test_bucketed_ranges_keep_the_latest_point_inside_each_bucket(app: FastAPI) -> None:
    with _authenticated_client(
        app,
        user_id=OWNER_ID,
        role=Role.OWNER,
        email="member-22afc8cb7161@example.invalid",
        display_name="Wynter Owner",
    ):
        asyncio.run(_seed_catalog(app))
        now = datetime(2026, 8, 27, 12, 0, tzinfo=UTC)

        async def clear_snapshots() -> None:
            async with app.state.session_factory() as database:
                await database.execute(delete(CollectionValueSnapshot))
                await database.commit()

        cases = {
            "month": (
                datetime(2026, 8, 27, 10, 5, tzinfo=UTC),
                datetime(2026, 8, 27, 10, 55, tzinfo=UTC),
            ),
            "quarter": (
                datetime(2026, 8, 1, 10, 5, tzinfo=UTC),
                datetime(2026, 8, 1, 10, 55, tzinfo=UTC),
            ),
            "year": (
                datetime(2026, 8, 1, 0, 5, tzinfo=UTC),
                datetime(2026, 8, 1, 23, 55, tzinfo=UTC),
            ),
            "all": (
                datetime(2026, 8, 1, 0, 5, tzinfo=UTC),
                datetime(2026, 8, 27, 23, 55, tzinfo=UTC),
            ),
        }
        for range_name, (first, latest) in cases.items():
            asyncio.run(clear_snapshots())
            asyncio.run(_add_snapshot(app, OWNER_ID, first, "1.00"))
            asyncio.run(_add_snapshot(app, OWNER_ID, latest, "2.00"))

            async def read_range(range_name=range_name):
                async with app.state.session_factory() as database:
                    return await read_collection_value_history(
                        database,
                        OWNER_ID,
                        range_name,
                        now=now,
                    )

            history = asyncio.run(read_range())
            assert [point.estimated_value_usd for point in history.points] == [Decimal("2.00")]


def test_value_history_migration_declares_the_model_schema_contract() -> None:
    migration = (
        Path(__file__).parents[1] / "migrations" / "versions" / "0011_collection_value_history.py"
    ).read_text()
    assert 'revision = "0011_collection_value_history"' in migration
    assert 'sa.Column("minute_bucket", sa.DateTime(timezone=True), nullable=False)' in migration
    assert (
        '"user_id", "minute_bucket", name="uq_collection_value_snapshots_user_minute"' in migration
    )
    assert 'sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE")' in migration


def test_history_rejects_invalid_range_and_snapshots_cascade_with_user_deletion(
    app: FastAPI,
) -> None:
    with _authenticated_client(
        app,
        user_id=OWNER_ID,
        role=Role.OWNER,
        email="member-4e58cd171b76@example.invalid",
        display_name="Wynter Owner",
    ) as client:
        asyncio.run(_seed_catalog(app))
        assert (
            client.get("/api/v1/collection/value-history", params={"range": "invalid"}).status_code
            == 422
        )
        asyncio.run(_capture(app, OWNER_ID, datetime(2026, 8, 27, 12, 30, tzinfo=UTC)))

    async def delete_user_and_count_snapshots() -> int:
        async with app.state.session_factory() as database:
            user = await database.get(User, OWNER_ID)
            assert user is not None
            await database.delete(user)
            await database.commit()
            return int(
                await database.scalar(
                    select(func.count())
                    .select_from(CollectionValueSnapshot)
                    .where(CollectionValueSnapshot.user_id == OWNER_ID)
                )
                or 0
            )

    assert asyncio.run(delete_user_and_count_snapshots()) == 0
