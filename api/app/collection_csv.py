from __future__ import annotations

import csv
import hashlib
import io
import uuid
from collections.abc import Iterable, Iterator
from dataclasses import dataclass

from app.collection_constants import COLLECTION_CONDITIONS

COLLECTION_CSV_HEADERS = (
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
COLLECTION_CSV_SCHEMA_VERSION = "1"
MAX_COLLECTION_CSV_BYTES = 2 * 1024 * 1024
MAX_COLLECTION_CSV_ROWS = 10_000


class CollectionCsvError(ValueError):
    def __init__(self, code: str, message: str, *, row: int | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.row = row


@dataclass(frozen=True, slots=True)
class ParsedCollectionRow:
    printing_id: uuid.UUID
    card_name: str
    set_code: str
    collector_number: str
    language: str
    finish: str
    condition: str
    quantity: int
    source_row: int


@dataclass(frozen=True, slots=True)
class ParsedCollectionCsv:
    source_sha256: str
    rows: tuple[ParsedCollectionRow, ...]


@dataclass(frozen=True, slots=True)
class CollectionExportRow:
    printing_id: uuid.UUID
    card_name: str
    set_code: str
    collector_number: str
    language: str
    finish: str
    condition: str
    quantity: int


def parse_collection_csv(payload: bytes) -> ParsedCollectionCsv:
    if len(payload) > MAX_COLLECTION_CSV_BYTES:
        raise CollectionCsvError("file_too_large", "CSV exceeds the 2 MiB limit.")

    try:
        text = payload.decode("utf-8-sig", errors="strict")
    except UnicodeDecodeError as exc:
        raise CollectionCsvError("invalid_utf8", "CSV must be valid UTF-8.") from exc

    try:
        reader = csv.reader(io.StringIO(text, newline=""), strict=True)
        headers = next(reader, None)
        if headers != list(COLLECTION_CSV_HEADERS):
            raise CollectionCsvError(
                "invalid_headers",
                "CSV headers do not match the supported schema.",
                row=1,
            )

        rows: list[ParsedCollectionRow] = []
        tuples: set[tuple[uuid.UUID, str, str]] = set()
        for source_row, values in enumerate(reader, start=2):
            if source_row > MAX_COLLECTION_CSV_ROWS + 1:
                raise CollectionCsvError(
                    "too_many_rows",
                    "CSV exceeds the 10,000-row limit.",
                    row=source_row,
                )
            if len(values) != len(COLLECTION_CSV_HEADERS):
                raise CollectionCsvError(
                    "invalid_row",
                    "CSV row has the wrong number of fields.",
                    row=source_row,
                )
            parsed = _parse_row(values, source_row)
            key = (parsed.printing_id, parsed.finish, parsed.condition)
            if key in tuples:
                raise CollectionCsvError(
                    "duplicate_tuple",
                    "CSV contains a duplicate printing, finish, and condition tuple.",
                    row=source_row,
                )
            tuples.add(key)
            rows.append(parsed)
    except csv.Error as exc:
        raise CollectionCsvError("invalid_csv", "CSV syntax is invalid.") from exc

    return ParsedCollectionCsv(
        source_sha256=hashlib.sha256(payload).hexdigest(),
        rows=tuple(rows),
    )


def export_collection_csv(rows: Iterable[CollectionExportRow]) -> Iterator[bytes]:
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\r\n")

    writer.writerow(COLLECTION_CSV_HEADERS)
    yield _take_stream(stream)

    for source_row, row in enumerate(rows, start=2):
        finish = _finish(row.finish, source_row)
        condition = _condition(row.condition, source_row)
        quantity = _quantity(str(row.quantity), source_row)
        try:
            printing_id = uuid.UUID(str(row.printing_id))
        except (ValueError, TypeError, AttributeError) as exc:
            raise CollectionCsvError(
                "invalid_printing_id",
                "Printing ID must be a UUID.",
                row=source_row,
            ) from exc
        writer.writerow(
            (
                COLLECTION_CSV_SCHEMA_VERSION,
                str(printing_id),
                _formula_safe(row.card_name),
                _formula_safe(row.set_code),
                _formula_safe(row.collector_number),
                _formula_safe(row.language),
                finish,
                condition,
                quantity,
            )
        )
        yield _take_stream(stream)


def _parse_row(values: list[str], source_row: int) -> ParsedCollectionRow:
    (
        schema_version,
        printing_id_value,
        card_name,
        set_code,
        collector_number,
        language,
        finish_value,
        condition_value,
        quantity_value,
    ) = values

    if schema_version.strip() != COLLECTION_CSV_SCHEMA_VERSION:
        raise CollectionCsvError(
            "unsupported_schema_version",
            "CSV schema version is not supported.",
            row=source_row,
        )
    try:
        printing_id = uuid.UUID(printing_id_value.strip())
    except (ValueError, AttributeError) as exc:
        raise CollectionCsvError(
            "invalid_printing_id",
            "Printing ID must be a UUID.",
            row=source_row,
        ) from exc

    return ParsedCollectionRow(
        printing_id=printing_id,
        card_name=card_name.strip(),
        set_code=set_code.strip(),
        collector_number=collector_number.strip(),
        language=language.strip(),
        finish=_finish(finish_value, source_row),
        condition=_condition(condition_value, source_row),
        quantity=_quantity(quantity_value, source_row),
        source_row=source_row,
    )


def _finish(value: str, source_row: int) -> str:
    normalized = value.strip().lower()
    if not normalized or len(normalized) > 16:
        raise CollectionCsvError(
            "invalid_finish",
            "Finish must contain 1 to 16 characters.",
            row=source_row,
        )
    return normalized


def _condition(value: str, source_row: int) -> str:
    normalized = value.strip().lower()
    if normalized not in COLLECTION_CONDITIONS:
        raise CollectionCsvError(
            "invalid_condition",
            "Condition is not supported.",
            row=source_row,
        )
    return normalized


def _quantity(value: str, source_row: int) -> int:
    try:
        quantity = int(value.strip())
    except (ValueError, AttributeError) as exc:
        raise CollectionCsvError(
            "invalid_quantity",
            "Quantity must be an integer from 1 through 9,999.",
            row=source_row,
        ) from exc
    if not 1 <= quantity <= 9_999:
        raise CollectionCsvError(
            "invalid_quantity",
            "Quantity must be an integer from 1 through 9,999.",
            row=source_row,
        )
    return quantity


def _formula_safe(value: str) -> str:
    text = str(value)
    if text.startswith(("=", "+", "-", "@")):
        return "'" + text
    return text


def _take_stream(stream: io.StringIO) -> bytes:
    value = stream.getvalue().encode("utf-8")
    stream.seek(0)
    stream.truncate(0)
    return value
