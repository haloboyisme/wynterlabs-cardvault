"""Backward-compatible One Piece wrappers around the shared tcgjson adapter."""

from typing import Any

import httpx

from app.catalog.importer import NormalizedCard
from app.catalog.tcgjson import TcgJsonClient, normalize_tcgjson_card
from app.config import Settings

ONE_PIECE_CATALOG_URL = (
    "https://github.com/HanClinto/tcgjson/releases/latest/download/one-piece.full.json.gz"
)
ONE_PIECE_IMAGE_HOST = "tcgplayer-cdn.tcgplayer.com"


def normalize_one_piece_card(record: dict[str, Any]) -> NormalizedCard:
    return normalize_tcgjson_card(record, "onepiece")


class OnePieceClient(TcgJsonClient):
    def __init__(
        self,
        settings: Settings,
        *,
        http_client: httpx.AsyncClient | None = None,
    ):
        super().__init__(settings, "onepiece", http_client=http_client)
