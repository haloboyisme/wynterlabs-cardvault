import asyncio
from datetime import UTC, datetime, time, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.catalog import scheduler
from app.catalog.scheduler import CatalogScheduleSpec, next_catalog_run
from app.models import CatalogRefreshSchedule


def test_hourly_schedule_advances_from_current_time() -> None:
    now = datetime(2026, 8, 31, 14, 22, tzinfo=UTC)
    spec = CatalogScheduleSpec(cadence="hours", interval_hours=6, weekday=0, time_24h="03:00", timezone="UTC")
    assert next_catalog_run(spec, now) == datetime(2026, 8, 31, 20, 22, tzinfo=UTC)


def test_weekly_schedule_uses_local_day_and_24_hour_time() -> None:
    now = datetime(2026, 8, 31, 14, 22, tzinfo=UTC)  # Monday
    spec = CatalogScheduleSpec(cadence="weekly", interval_hours=24, weekday=2, time_24h="21:30", timezone="America/Indiana/Indianapolis")
    assert next_catalog_run(spec, now) == datetime(2026, 9, 3, 1, 30, tzinfo=UTC)


def test_schedule_rejects_unknown_timezone() -> None:
    spec = CatalogScheduleSpec(cadence="daily", interval_hours=24, weekday=0, time_24h="03:00", timezone="Not/AZone")
    with pytest.raises(ValueError, match="time zone"):
        next_catalog_run(spec, datetime(2026, 8, 31, tzinfo=UTC))


def test_application_starts_and_stops_catalog_scheduler(app: FastAPI) -> None:
    with TestClient(app):
        task = app.state.catalog_scheduler_task
        assert not task.done()
    assert task.done()


def test_due_schedule_runs_existing_importer_once(app: FastAPI, monkeypatch) -> None:
    calls: list[str] = []

    class FakeImporter:
        def __init__(self, settings, session_factory) -> None:
            pass

        async def refresh(self, game: str):
            calls.append(game)
            return SimpleNamespace(status="unchanged")

    monkeypatch.setattr(scheduler, "CatalogImporter", FakeImporter)
    now = datetime(2026, 8, 31, 14, 0, tzinfo=UTC)

    async def exercise() -> bool:
        async with app.state.session_factory() as database:
            database.add(CatalogRefreshSchedule(
                id=1, enabled=True, cadence="hours", interval_hours=6,
                weekday=0, time_of_day=time(3), timezone="UTC", game="pokemon",
                next_run_at=now - timedelta(minutes=1),
            ))
            await database.commit()
        return await scheduler.run_due_catalog_schedule(
            app.state.settings, app.state.session_factory, now=now
        )

    assert asyncio.run(exercise()) is True
    assert calls == ["pokemon"]
