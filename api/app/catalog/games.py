CURRENT_GAME_KEY = "mtg"
SUPPORTED_GAME_KEYS = ("mtg", "pokemon", "yugioh", "onepiece")


def normalize_game(value: str | None) -> str | None:
    normalized = value.strip().lower() if value else None
    return normalized or None


def is_supported_game(value: str | None) -> bool:
    normalized = normalize_game(value)
    return normalized in SUPPORTED_GAME_KEYS


def current_game_matches(value: str | None) -> bool:
    normalized = normalize_game(value)
    return normalized is None or normalized in SUPPORTED_GAME_KEYS
