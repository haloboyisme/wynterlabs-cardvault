import asyncio
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.catalog.importer import CatalogImporter
from app.collection_value import capture_collection_price_snapshots
from app.models import CatalogRefreshSchedule


@dataclass(frozen=True)
class CatalogScheduleSpec:
    cadence: str
    interval_hours: int
    weekday: int
    time_24h: str
    timezone: str


def _zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError as exc:
        raise ValueError("Unknown time zone") from exc


def next_catalog_run(spec: CatalogScheduleSpec, now: datetime) -> datetime:
    if now.tzinfo is None:
        raise ValueError("Current time must include a time zone")
    zone = _zone(spec.timezone)
    if spec.cadence == "hours":
        if not 1 <= spec.interval_hours <= 168:
            raise ValueError("Interval must be between 1 and 168 hours")
        return now.astimezone(UTC) + timedelta(hours=spec.interval_hours)
    try:
        hour, minute = (int(part) for part in spec.time_24h.split(":"))
        local_time = time(hour, minute)
    except (TypeError, ValueError) as exc:
        raise ValueError("Time must use 24-hour HH:MM format") from exc
    local_now = now.astimezone(zone)
    if spec.cadence == "daily":
        candidate = datetime.combine(local_now.date(), local_time, zone)
        if candidate <= local_now:
            candidate += timedelta(days=1)
    elif spec.cadence == "weekly":
        if not 0 <= spec.weekday <= 6:
            raise ValueError("Weekday must be between 0 and 6")
        days = (spec.weekday - local_now.weekday()) % 7
        candidate = datetime.combine(local_now.date() + timedelta(days=days), local_time, zone)
        if candidate <= local_now:
            candidate += timedelta(days=7)
    else:
        raise ValueError("Unsupported catalog schedule cadence")
    return candidate.astimezone(UTC)


def schedule_spec(row: CatalogRefreshSchedule) -> CatalogScheduleSpec:
    return CatalogScheduleSpec(
        cadence=row.cadence,
        interval_hours=row.interval_hours,
        weekday=row.weekday,
        time_24h=row.time_of_day.strftime("%H:%M"),
        timezone=row.timezone,
    )


async def run_due_catalog_schedule(
    settings,
    session_factory: async_sessionmaker[AsyncSession],
    *,
    now: datetime | None = None,
) -> bool:
    current = (now or datetime.now(UTC)).astimezone(UTC)
    async with session_factory() as database:
        async with database.begin():
            row = await database.get(CatalogRefreshSchedule, 1, with_for_update=True)
            if row is None or not row.enabled or row.next_run_at is None:
                return False
            due_at = row.next_run_at
            if due_at.tzinfo is None:
                due_at = due_at.replace(tzinfo=UTC)
            if due_at > current:
                return False
            row.last_started_at = current
            row.last_status = "running"
            row.last_error_summary = None
            row.next_run_at = next_catalog_run(schedule_spec(row), current)
            game = row.game
    status = "failed"
    error_summary = None
    try:
        outcome = await CatalogImporter(settings, session_factory).refresh(game=game)
        status = outcome.status
        if outcome.status == "complete":
            with suppress(Exception):
                await capture_collection_price_snapshots(session_factory)
    except Exception:
        error_summary = "Scheduled refresh failed; the previous catalog remains active."
    finished = datetime.now(UTC)
    async with session_factory() as database:
        async with database.begin():
            row = await database.get(CatalogRefreshSchedule, 1, with_for_update=True)
            if row is not None:
                row.last_finished_at = finished
                row.last_status = status
                row.last_error_summary = error_summary
    return True


async def catalog_scheduler_loop(settings, session_factory, poll_seconds: float = 60) -> None:
    while True:
        with suppress(Exception):
            await run_due_catalog_schedule(settings, session_factory)
        await asyncio.sleep(poll_seconds)
