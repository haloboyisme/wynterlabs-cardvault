import uuid
from collections import defaultdict
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class DeckWarning:
    code: str
    message: str
    printing_id: uuid.UUID | None = None


@dataclass(frozen=True)
class DeckAnalysis:
    mainboard_count: int
    sideboard_count: int
    warnings: list[DeckWarning]


def analyze_deck(*, deck_format: str, cards: list[dict[str, Any]]) -> DeckAnalysis:
    included = [card for card in cards if card["section"] != "maybeboard"]
    mainboard_count = sum(card["quantity"] for card in included if card["section"] == "mainboard")
    sideboard_count = sum(card["quantity"] for card in included if card["section"] == "sideboard")
    size_sections = {"mainboard"}
    if deck_format in {"commander", "brawl", "standardbrawl", "paupercommander", "duel"}:
        size_sections.add("commander")
    elif deck_format == "oathbreaker":
        size_sections.update(("oathbreaker", "signature_spell"))
    deck_size = sum(card["quantity"] for card in included if card["section"] in size_sections)
    warnings: list[DeckWarning] = []
    minimum = (
        100
        if deck_format in {"commander", "brawl", "standardbrawl", "paupercommander", "duel"}
        else 60
    )
    if deck_size < minimum:
        warnings.append(
            DeckWarning("deck_size_below_minimum", f"Deck has fewer than {minimum} cards.")
        )

    oracle_quantities: dict[str, int] = defaultdict(int)
    oracle_legalities: dict[str, set[str]] = defaultdict(set)
    oracle_printings: dict[str, uuid.UUID | None] = {}
    printing_quantities: dict[uuid.UUID, int] = defaultdict(int)
    owned_quantities: dict[uuid.UUID, int] = {}
    for card in included:
        quantity = int(card["quantity"])
        printing_id = card.get("printing_id")
        if printing_id is not None:
            printing_quantities[printing_id] += quantity
            owned_quantities.setdefault(printing_id, int(card.get("owned_quantity", 0)))
        oracle_id = str(card.get("oracle_id", ""))
        oracle_quantities[oracle_id] += quantity
        oracle_printings.setdefault(oracle_id, printing_id)
        legality = (card.get("legalities") or {}).get(deck_format, "not_legal")
        oracle_legalities[oracle_id].add(legality)
        if legality == "banned":
            warnings.append(DeckWarning("banned", "A card is banned in this format.", printing_id))
        elif legality not in {"legal", "restricted"}:
            warnings.append(
                DeckWarning("not_legal", "A card is not legal in this format.", printing_id)
            )

    for oracle_id, quantity in oracle_quantities.items():
        if not oracle_id:
            continue
        if "restricted" in oracle_legalities[oracle_id] and quantity > 1:
            warnings.append(
                DeckWarning(
                    "restricted_excess",
                    "A restricted card has more than one copy.",
                    oracle_printings[oracle_id],
                )
            )
        elif quantity > 4:
            warnings.append(
                DeckWarning("four_copy_excess", "More than four copies share an oracle identity.")
            )
    for printing_id, quantity in printing_quantities.items():
        if quantity > owned_quantities[printing_id]:
            warnings.append(
                DeckWarning(
                    "ownership_shortage", "The deck uses more copies than are owned.", printing_id
                )
            )
    return DeckAnalysis(mainboard_count, sideboard_count, warnings)
