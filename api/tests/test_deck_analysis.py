import uuid

import pytest

from app.collection_constants import allowed_deck_sections
from app.deck_analysis import analyze_deck

PRINTING_A = uuid.UUID("00000000-0000-0000-0000-000000000030")
PRINTING_B = uuid.UUID("00000000-0000-0000-0000-000000000031")


def _card(
    *,
    printing_id: uuid.UUID = PRINTING_A,
    oracle_id: str = "oracle-a",
    section: str = "mainboard",
    quantity: int = 1,
    legality: str = "legal",
    owned_quantity: int = 9999,
) -> dict:
    return {
        "printing_id": printing_id,
        "oracle_id": oracle_id,
        "section": section,
        "quantity": quantity,
        "legalities": {"modern": legality, "commander": legality, "oathbreaker": legality},
        "owned_quantity": owned_quantity,
    }


def _codes(result) -> list[str]:
    return [warning.code for warning in result.warnings]


def _legal_mainboard() -> list[dict]:
    return [
        _card(
            printing_id=uuid.UUID(int=index + 100),
            oracle_id=f"legal-{index}",
            quantity=4,
            owned_quantity=4,
        )
        for index in range(15)
    ]


def test_legal_deck_has_no_legality_size_copy_or_ownership_warnings() -> None:
    result = analyze_deck(deck_format="modern", cards=_legal_mainboard())

    assert result.mainboard_count == 60
    assert result.sideboard_count == 0
    assert result.warnings == []


@pytest.mark.parametrize(
    ("legality", "expected_code"),
    [("not_legal", "not_legal"), ("banned", "banned")],
)
def test_illegal_and_banned_cards_warn_without_blocking(legality: str, expected_code: str) -> None:
    result = analyze_deck(
        deck_format="modern",
        cards=[
            _card(quantity=60),
            _card(printing_id=PRINTING_B, oracle_id="oracle-b", legality=legality),
        ],
    )

    assert expected_code in _codes(result)
    warning = next(warning for warning in result.warnings if warning.code == expected_code)
    assert warning.printing_id == PRINTING_B


def test_restricted_and_four_copy_limits_aggregate_by_oracle_identity() -> None:
    restricted = analyze_deck(
        deck_format="modern",
        cards=[
            _card(printing_id=PRINTING_A, oracle_id="same", quantity=1, legality="restricted"),
            _card(printing_id=PRINTING_B, oracle_id="same", quantity=1, legality="restricted"),
        ],
    )
    excess = analyze_deck(
        deck_format="modern",
        cards=[
            _card(printing_id=PRINTING_A, oracle_id="same", quantity=3),
            _card(printing_id=PRINTING_B, oracle_id="same", quantity=2),
        ],
    )

    assert _codes(restricted).count("restricted_excess") == 1
    assert _codes(excess).count("four_copy_excess") == 1


def test_shortage_aggregates_exact_printing_across_included_sections() -> None:
    result = analyze_deck(
        deck_format="modern",
        cards=[
            _card(printing_id=PRINTING_A, quantity=59, owned_quantity=60),
            _card(printing_id=PRINTING_A, section="sideboard", quantity=2, owned_quantity=60),
        ],
    )

    shortage = next(warning for warning in result.warnings if warning.code == "ownership_shortage")
    assert shortage.printing_id == PRINTING_A


def test_maybeboard_is_excluded_from_totals_and_all_warnings() -> None:
    result = analyze_deck(
        deck_format="modern",
        cards=[
            *_legal_mainboard(),
            _card(
                printing_id=PRINTING_B,
                oracle_id="maybe",
                section="maybeboard",
                quantity=9999,
                legality="banned",
                owned_quantity=0,
            ),
        ],
    )

    assert result.mainboard_count == 60
    assert result.sideboard_count == 0
    assert result.warnings == []


def test_format_sections_are_explicit_and_format_aware() -> None:
    assert allowed_deck_sections("modern") == (
        "mainboard",
        "sideboard",
        "companion",
        "maybeboard",
    )
    assert allowed_deck_sections("commander")[0] == "commander"
    assert allowed_deck_sections("oathbreaker")[:2] == ("oathbreaker", "signature_spell")


@pytest.mark.parametrize(
    ("deck_format", "cards"),
    [
        ("modern", [_card(quantity=59)]),
        (
            "commander",
            [
                _card(section="commander", quantity=1),
                _card(printing_id=PRINTING_B, oracle_id="filler", quantity=98),
            ],
        ),
        (
            "oathbreaker",
            [
                _card(section="oathbreaker", quantity=1),
                _card(
                    printing_id=PRINTING_B, oracle_id="spell", section="signature_spell", quantity=1
                ),
                _card(oracle_id="filler", quantity=57),
            ],
        ),
    ],
)
def test_size_guidance_warns_below_common_format_minimum(
    deck_format: str, cards: list[dict]
) -> None:
    result = analyze_deck(deck_format=deck_format, cards=cards)
    assert "deck_size_below_minimum" in _codes(result)


@pytest.mark.parametrize(
    ("deck_format", "cards"),
    [
        ("modern", [_card(quantity=60)]),
        (
            "commander",
            [
                _card(section="commander", quantity=1),
                _card(printing_id=PRINTING_B, oracle_id="filler", quantity=99),
            ],
        ),
        (
            "oathbreaker",
            [
                _card(section="oathbreaker", quantity=1),
                _card(
                    printing_id=PRINTING_B, oracle_id="spell", section="signature_spell", quantity=1
                ),
                _card(oracle_id="filler", quantity=58),
            ],
        ),
    ],
)
def test_size_guidance_counts_required_special_sections(
    deck_format: str, cards: list[dict]
) -> None:
    result = analyze_deck(deck_format=deck_format, cards=cards)
    assert "deck_size_below_minimum" not in _codes(result)
