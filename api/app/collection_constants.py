COLLECTION_CONDITIONS = (
    "near_mint",
    "lightly_played",
    "moderately_played",
    "heavily_played",
    "damaged",
)

DECK_SECTIONS = (
    "mainboard",
    "sideboard",
    "companion",
    "maybeboard",
    "commander",
    "oathbreaker",
    "signature_spell",
)

FORMATS = (
    "standard",
    "future",
    "historic",
    "timeless",
    "gladiator",
    "pioneer",
    "explorer",
    "modern",
    "legacy",
    "pauper",
    "vintage",
    "penny",
    "commander",
    "oathbreaker",
    "standardbrawl",
    "brawl",
    "alchemy",
    "paupercommander",
    "duel",
    "oldschool",
    "premodern",
    "predh",
    "expanded",
    "unlimited",
    "advanced",
    "traditional",
)

_NORMAL_SECTIONS = ("mainboard", "sideboard", "companion", "maybeboard")
_COMMANDER_SECTIONS = ("commander", *_NORMAL_SECTIONS)
_OATHBREAKER_SECTIONS = ("oathbreaker", "signature_spell", *_NORMAL_SECTIONS)


def allowed_deck_sections(format_name: str) -> tuple[str, ...]:
    if format_name in {"commander", "brawl", "standardbrawl", "paupercommander", "duel"}:
        return _COMMANDER_SECTIONS
    if format_name == "oathbreaker":
        return _OATHBREAKER_SECTIONS
    return _NORMAL_SECTIONS
