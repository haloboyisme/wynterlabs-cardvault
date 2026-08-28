from __future__ import annotations

import csv
import io
import uuid

import pytest

from app.collection_csv import (
    COLLECTION_CSV_HEADERS,
    CollectionCsvError,
    CollectionExportRow,
    export_collection_csv,
    parse_collection_csv,
)

PRINTING_ID = uuid.UUID("11111111-1111-4111-8111-111111111111")


def _payload(
    rows: list[list[str]] | None = None,
    *,
    headers: tuple[str, ...] = COLLECTION_CSV_HEADERS,
    line_ending: str = "\n",
) -> bytes:
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator=line_ending)
    writer.writerow(headers)
    writer.writerows(
        rows
        or [
            [
                "1",
                str(PRINTING_ID),
                "Card, Quoted",
                "tst",
                "7",
                "en",
                "nonfoil",
                "near_mint",
                "2",
            ]
        ]
    )
    return stream.getvalue().encode()


def test_parse_accepts_bom_crlf_and_quoted_cells() -> None:
    parsed = parse_collection_csv(b"\xef\xbb\xbf" + _payload(line_ending="\r\n"))

    assert parsed.source_sha256
    assert len(parsed.rows) == 1
    assert parsed.rows[0].printing_id == PRINTING_ID
    assert parsed.rows[0].finish == "nonfoil"
    assert parsed.rows[0].condition == "near_mint"
    assert parsed.rows[0].quantity == 2
    assert parsed.rows[0].source_row == 2
    assert parsed.rows[0].card_name == "Card, Quoted"


@pytest.mark.parametrize(
    ("payload", "code"),
    [
        (b"\xff\xfe", "invalid_utf8"),
        (_payload(headers=COLLECTION_CSV_HEADERS[:-1]), "invalid_headers"),
        (
            _payload(
                [["2", str(PRINTING_ID), "Card", "tst", "7", "en", "nonfoil", "near_mint", "1"]]
            ),
            "unsupported_schema_version",
        ),
        (
            _payload([["1", "not-a-uuid", "Card", "tst", "7", "en", "nonfoil", "near_mint", "1"]]),
            "invalid_printing_id",
        ),
        (
            _payload(
                [["1", str(PRINTING_ID), "Card", "tst", "7", "en", "nonfoil", "near_mint", "0"]]
            ),
            "invalid_quantity",
        ),
        (
            _payload([["1", str(PRINTING_ID), "Card", "tst", "7", "en", "nonfoil", "mint", "1"]]),
            "invalid_condition",
        ),
    ],
)
def test_parse_rejects_invalid_files(payload: bytes, code: str) -> None:
    with pytest.raises(CollectionCsvError) as caught:
        parse_collection_csv(payload)
    assert caught.value.code == code


def test_parse_rejects_duplicate_printing_finish_condition_tuple() -> None:
    row = ["1", str(PRINTING_ID), "Card", "tst", "7", "en", "foil", "near_mint", "1"]
    with pytest.raises(CollectionCsvError) as caught:
        parse_collection_csv(_payload([row, row]))
    assert caught.value.code == "duplicate_tuple"
    assert caught.value.row == 3


def test_parse_enforces_size_and_data_row_bounds() -> None:
    with pytest.raises(CollectionCsvError) as caught:
        parse_collection_csv(b"x" * (2 * 1024 * 1024 + 1))
    assert caught.value.code == "file_too_large"

    rows = [
        [
            "1",
            str(uuid.UUID(int=index + 1)),
            "Card",
            "tst",
            str(index),
            "en",
            "nonfoil",
            "near_mint",
            "1",
        ]
        for index in range(10_001)
    ]
    with pytest.raises(CollectionCsvError) as caught:
        parse_collection_csv(_payload(rows))
    assert caught.value.code == "too_many_rows"


def test_export_is_streaming_round_trips_and_neutralizes_formula_fields() -> None:
    row = CollectionExportRow(
        printing_id=PRINTING_ID,
        card_name='=HYPERLINK("bad")',
        set_code="+cmd",
        collector_number="-7",
        language="@en",
        finish="etched",
        condition="lightly_played",
        quantity=3,
    )
    chunks = list(export_collection_csv([row]))
    assert chunks
    payload = b"".join(chunks)
    text = payload.decode()
    assert "'=HYPERLINK" in text
    assert "'+cmd" in text
    assert "'-7" in text
    assert "'@en" in text

    parsed = parse_collection_csv(payload)
    assert parsed.rows[0].printing_id == PRINTING_ID
    assert parsed.rows[0].quantity == 3
    assert parsed.rows[0].card_name == '\'=HYPERLINK("bad")'


def test_export_rejects_invalid_internal_rows() -> None:
    row = CollectionExportRow(
        printing_id=PRINTING_ID,
        card_name="Card",
        set_code="tst",
        collector_number="7",
        language="en",
        finish="nonfoil",
        condition="near_mint",
        quantity=10_000,
    )
    with pytest.raises(CollectionCsvError) as caught:
        list(export_collection_csv([row]))
    assert caught.value.code == "invalid_quantity"
