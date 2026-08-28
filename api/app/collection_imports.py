from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.collection_csv import CollectionExportRow, ParsedCollectionCsv
from app.errors import AppError
from app.models import (
    CardPrinting,
    CardSet,
    CollectionImportPreview,
    CollectionItem,
    OracleCard,
)

PREVIEW_LIFETIME = timedelta(hours=1)


def collection_digest(items: list[CollectionItem]) -> str:
    snapshot = [
        {
            "id": str(item.id),
            "printing_id": str(item.printing_id),
            "finish": item.finish,
            "condition": item.condition,
            "quantity": item.quantity,
            "revision": item.revision,
        }
        for item in sorted(items, key=lambda item: str(item.id))
    ]
    encoded = json.dumps(snapshot, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


async def create_preview(
    database: AsyncSession,
    user_id: uuid.UUID,
    parsed: ParsedCollectionCsv,
) -> CollectionImportPreview:
    now = _now()
    await _lock_preview_table(database)
    await database.execute(
        delete(CollectionImportPreview).where(
            CollectionImportPreview.user_id == user_id,
            CollectionImportPreview.confirmed_at.is_(None),
            CollectionImportPreview.expires_at <= now,
        )
    )
    previous = await database.scalar(
        select(CollectionImportPreview)
        .where(
            CollectionImportPreview.user_id == user_id,
            CollectionImportPreview.source_sha256 == parsed.source_sha256,
            CollectionImportPreview.confirmed_at.is_(None),
        )
        .with_for_update()
    )
    if previous is not None:
        await database.delete(previous)
        await database.flush()

    await _lock_collection_table(database)
    items = list(
        (
            await database.scalars(
                select(CollectionItem)
                .where(CollectionItem.user_id == user_id)
                .order_by(CollectionItem.id)
            )
        ).all()
    )
    printing_ids = {row.printing_id for row in parsed.rows}
    catalog_rows = (
        await database.execute(
            select(CardPrinting, OracleCard, CardSet)
            .join(OracleCard, OracleCard.id == CardPrinting.oracle_card_id)
            .join(CardSet, CardSet.id == CardPrinting.card_set_id)
            .where(CardPrinting.id.in_(printing_ids))
        )
    ).all()
    catalog = {
        printing.id: (printing, oracle, card_set) for printing, oracle, card_set in catalog_rows
    }
    existing = {(item.printing_id, item.finish, item.condition): item for item in items}

    rows: list[dict[str, Any]] = []
    additions = increments = errors = 0
    for row in parsed.rows:
        entry: dict[str, Any] = {
            "source_row": row.source_row,
            "printing_id": str(row.printing_id),
            "card_name": row.card_name,
            "finish": row.finish,
            "condition": row.condition,
            "quantity": row.quantity,
            "classification": "error",
            "existing_quantity": 0,
            "resulting_quantity": 0,
            "error_code": None,
            "error_message": None,
            "warnings": [],
        }
        catalog_row = catalog.get(row.printing_id)
        if catalog_row is None:
            _row_error(entry, "printing_not_found", "Card printing was not found.")
            errors += 1
            rows.append(entry)
            continue
        printing, oracle, card_set = catalog_row
        entry["card_name"] = oracle.name
        entry["warnings"] = _human_field_warnings(row, printing, oracle, card_set)
        item = existing.get((row.printing_id, row.finish, row.condition))
        if item is None:
            if not printing.active:
                _row_error(
                    entry,
                    "printing_inactive",
                    "Inactive printings cannot be newly imported.",
                )
                errors += 1
                rows.append(entry)
                continue
            if row.finish not in (printing.finishes or []):
                _row_error(
                    entry,
                    "finish_not_available",
                    "Finish is not available for this printing.",
                )
                errors += 1
                rows.append(entry)
                continue
            entry["classification"] = "addition"
            entry["resulting_quantity"] = row.quantity
            additions += 1
        elif item.quantity + row.quantity > 9999:
            entry["existing_quantity"] = item.quantity
            _row_error(entry, "quantity_limit_exceeded", "Resulting quantity would exceed 9,999.")
            errors += 1
        else:
            entry["classification"] = "increment"
            entry["existing_quantity"] = item.quantity
            entry["resulting_quantity"] = item.quantity + row.quantity
            increments += 1
        rows.append(entry)

    preview = CollectionImportPreview(
        user_id=user_id,
        source_sha256=parsed.source_sha256,
        rows=rows,
        summary={
            "additions": additions,
            "increments": increments,
            "errors": errors,
            "total_rows": len(rows),
        },
        collection_digest=collection_digest(items),
        expires_at=now + PREVIEW_LIFETIME,
    )
    database.add(preview)
    await database.flush()
    return preview


async def get_preview(
    database: AsyncSession,
    user_id: uuid.UUID,
    preview_id: uuid.UUID,
    *,
    lock: bool = False,
) -> CollectionImportPreview:
    statement = select(CollectionImportPreview).where(
        CollectionImportPreview.id == preview_id,
        CollectionImportPreview.user_id == user_id,
    )
    if lock:
        statement = statement.with_for_update()
    preview = await database.scalar(statement)
    if preview is None:
        raise AppError(
            404,
            "collection_import_not_found",
            "Collection import preview was not found.",
        )
    return preview


async def confirm_preview(
    database: AsyncSession,
    user_id: uuid.UUID,
    preview_id: uuid.UUID,
) -> int:
    preview = await get_preview(database, user_id, preview_id, lock=True)
    if preview.confirmed_at is not None:
        raise AppError(
            409,
            "collection_import_already_confirmed",
            "Collection import was already confirmed.",
        )
    if _expired(preview.expires_at):
        raise AppError(410, "collection_import_expired", "Collection import preview has expired.")
    if int(preview.summary.get("errors", 0)):
        raise AppError(
            422,
            "collection_import_has_errors",
            "Resolve every import error before confirmation.",
        )

    await _lock_collection_table(database)
    items = list(
        (
            await database.scalars(
                select(CollectionItem)
                .where(CollectionItem.user_id == user_id)
                .order_by(CollectionItem.id)
                .with_for_update()
            )
        ).all()
    )
    if collection_digest(items) != preview.collection_digest:
        raise AppError(
            409,
            "collection_import_stale",
            "Collection changed after preview. Create a new preview.",
        )

    printing_ids = {uuid.UUID(str(row["printing_id"])) for row in preview.rows}
    printings = {
        printing.id: printing
        for printing in (
            await database.scalars(select(CardPrinting).where(CardPrinting.id.in_(printing_ids)))
        ).all()
    }
    existing = {(item.printing_id, item.finish, item.condition): item for item in items}
    applied = 0
    for row in preview.rows:
        printing_id = uuid.UUID(str(row["printing_id"]))
        printing = printings.get(printing_id)
        if printing is None:
            raise AppError(
                409,
                "collection_import_catalog_changed",
                "A card printing changed after preview. Create a new preview.",
            )
        finish = str(row["finish"])
        condition = str(row["condition"])
        quantity = int(row["quantity"])
        key = (printing_id, finish, condition)
        item = existing.get(key)
        if item is None and (not printing.active or finish not in (printing.finishes or [])):
            raise AppError(
                409,
                "collection_import_catalog_changed",
                "A card printing changed after preview. Create a new preview.",
            )
        if item is None:
            item = CollectionItem(
                user_id=user_id,
                printing_id=printing_id,
                finish=finish,
                condition=condition,
                quantity=quantity,
            )
            database.add(item)
            existing[key] = item
        else:
            if item.quantity + quantity > 9999:
                raise AppError(
                    422,
                    "quantity_limit_exceeded",
                    "Collection quantity cannot exceed 9,999.",
                )
            item.quantity += quantity
            item.revision += 1
        applied += 1

    preview.confirmed_at = _now()
    preview.revision += 1
    await database.flush()
    return applied


async def export_rows(
    database: AsyncSession,
    user_id: uuid.UUID,
) -> list[CollectionExportRow]:
    rows = (
        await database.execute(
            select(CollectionItem, CardPrinting, OracleCard, CardSet)
            .join(CardPrinting, CardPrinting.id == CollectionItem.printing_id)
            .join(OracleCard, OracleCard.id == CardPrinting.oracle_card_id)
            .join(CardSet, CardSet.id == CardPrinting.card_set_id)
            .where(CollectionItem.user_id == user_id)
            .order_by(
                OracleCard.name_normalized,
                CardSet.code_normalized,
                CardPrinting.collector_number,
                CollectionItem.id,
            )
        )
    ).all()
    return [
        CollectionExportRow(
            printing_id=printing.id,
            card_name=oracle.name,
            set_code=card_set.code,
            collector_number=printing.collector_number,
            language=printing.language,
            finish=item.finish,
            condition=item.condition,
            quantity=item.quantity,
        )
        for item, printing, oracle, card_set in rows
    ]


def _row_error(entry: dict[str, Any], code: str, message: str) -> None:
    entry["classification"] = "error"
    entry["error_code"] = code
    entry["error_message"] = message


def _human_field_warnings(row, printing, oracle, card_set) -> list[str]:
    warnings: list[str] = []
    comparisons = (
        ("card_name_mismatch", row.card_name.casefold(), oracle.name.casefold()),
        ("set_code_mismatch", row.set_code.casefold(), card_set.code.casefold()),
        ("collector_number_mismatch", row.collector_number, printing.collector_number),
        ("language_mismatch", row.language.casefold(), printing.language.casefold()),
    )
    for code, supplied, canonical in comparisons:
        if supplied and supplied != canonical:
            warnings.append(code)
    return warnings


async def _lock_collection_table(database: AsyncSession) -> None:
    if database.get_bind().dialect.name == "postgresql":
        await database.execute(text("LOCK TABLE collection_items IN SHARE ROW EXCLUSIVE MODE"))


async def _lock_preview_table(database: AsyncSession) -> None:
    if database.get_bind().dialect.name == "postgresql":
        await database.execute(
            text("LOCK TABLE collection_import_previews IN SHARE ROW EXCLUSIVE MODE")
        )


def _now() -> datetime:
    return datetime.now(UTC)


def _expired(value: datetime) -> bool:
    if value.tzinfo is None:
        return value <= _now().replace(tzinfo=None)
    return value <= _now()
