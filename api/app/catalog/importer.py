import gzip
import hashlib
import json
import tempfile
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from sqlalchemy import delete, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.catalog.games import SUPPORTED_GAME_KEYS, normalize_game
from app.catalog.scryfall import (
    BulkMetadata,
    ScryfallClient,
    SetMetadata,
    approved_set_icon_url,
)
from app.config import Settings
from app.models import CardFace, CardPrinting, CardSet, CatalogImport, OracleCard


@dataclass(frozen=True)
class NormalizedSet:
    game: str
    scryfall_id: uuid.UUID
    code: str
    name: str
    set_type: str
    released_at: date | None
    card_count: int
    digital: bool
    icon_svg_uri: str | None
    source_updated_at: datetime
    source_uri: str | None


@dataclass(frozen=True)
class NormalizedOracle:
    game: str
    scryfall_id: uuid.UUID
    name: str
    layout: str
    mana_cost: str | None
    cmc: float
    type_line: str | None
    oracle_text: str | None
    colors: list[str]
    color_identity: list[str]
    keywords: list[str]
    legalities: dict[str, str]


@dataclass(frozen=True)
class NormalizedPrinting:
    game: str
    scryfall_id: uuid.UUID
    language: str
    collector_number: str
    rarity: str
    released_at: date | None
    artist: str | None
    illustration_id: uuid.UUID | None
    digital: bool
    promo: bool
    layout: str
    frame: str | None
    border_color: str | None
    image_status: str | None
    source_uri: str | None
    image_uris: dict[str, str]
    prices: dict[str, str | None]
    finishes: list[str]
    games: list[str]
    colors: list[str]
    color_identity: list[str]
    legalities: dict[str, str]


@dataclass(frozen=True)
class NormalizedFace:
    name: str
    mana_cost: str | None
    type_line: str | None
    oracle_text: str | None
    colors: list[str]
    image_uris: dict[str, str]
    artist: str | None
    illustration_id: uuid.UUID | None


@dataclass(frozen=True)
class NormalizedCard:
    card_set: NormalizedSet
    oracle: NormalizedOracle
    printing: NormalizedPrinting
    faces: list[NormalizedFace]


@dataclass(frozen=True)
class ImportOutcome:
    status: str
    import_id: uuid.UUID | None
    imported_records: int
    rejected_records: int
    skipped: bool


class CatalogValidationError(ValueError):
    def __init__(self, message: str, total: int, imported: int, rejected: int):
        super().__init__(message)
        self.total = total
        self.imported = imported
        self.rejected = rejected


def validation_thresholds(settings: Settings, game: str) -> tuple[int, int]:
    """Return the minimum printings and sets required for one provider's activation."""
    if game == "pokemon":
        return settings.catalog_pokemon_min_printings, settings.catalog_pokemon_min_sets
    if game == "yugioh":
        return settings.catalog_yugioh_min_printings, settings.catalog_yugioh_min_sets
    if game == "onepiece":
        return settings.catalog_one_piece_min_printings, settings.catalog_one_piece_min_sets
    if game in {"digimon", "starwars", "unionarena", "lorcana", "riftbound"}:
        return settings.catalog_tcgjson_min_printings, settings.catalog_tcgjson_min_sets
    return settings.catalog_min_printings, settings.catalog_min_sets


def _uuid(value: Any, field: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError, AttributeError) as error:
        raise ValueError(f"invalid {field}") from error


def _optional_uuid(value: Any) -> uuid.UUID | None:
    return None if not value else _uuid(value, "optional UUID")


def _date(value: Any) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value))
    except ValueError as error:
        raise ValueError("invalid release date") from error


def _string_list(value: Any) -> list[str]:
    return [str(item) for item in value] if isinstance(value, list) else []


def _scryfall_source_uri(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = urlparse(value)
        host = (parsed.hostname or "").lower()
        port = parsed.port
    except ValueError:
        return None
    if (
        parsed.scheme != "https"
        or (host != "scryfall.com" and not host.endswith(".scryfall.com"))
        or parsed.username is not None
        or parsed.password is not None
        or port not in (None, 443)
    ):
        return None
    return value


CARD_IMAGE_KEYS = frozenset({"small", "normal", "large", "png", "art_crop", "border_crop"})


def _approved_https_url(value: Any, host: str) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = urlparse(value)
        port = parsed.port
    except ValueError:
        return None
    if (
        parsed.scheme != "https"
        or parsed.hostname != host
        or parsed.username is not None
        or parsed.password is not None
        or port not in (None, 443)
    ):
        return None
    return value


def _image_map(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {
        str(key): approved
        for key, item in value.items()
        if key in CARD_IMAGE_KEYS
        if (approved := _approved_https_url(item, "cards.scryfall.io")) is not None
    }


def _string_map(value: Any) -> dict[str, str]:
    return {str(key): str(item) for key, item in value.items()} if isinstance(value, dict) else {}


def _price_map(value: Any) -> dict[str, str | None]:
    if not isinstance(value, dict):
        return {}
    return {str(key): None if item is None else str(item) for key, item in value.items()}


def _oracle_identity(record: dict[str, Any]) -> uuid.UUID:
    top_level = record.get("oracle_id")
    if top_level:
        return _uuid(top_level, "oracle_id")
    if record.get("layout") != "reversible_card":
        raise ValueError("missing oracle_id")
    faces = record.get("card_faces")
    if not isinstance(faces, list) or not faces:
        raise ValueError("reversible card has no stable oracle identity")
    identities = {face.get("oracle_id") for face in faces if isinstance(face, dict)}
    if None in identities or len(identities) != 1:
        raise ValueError("reversible card has conflicting or missing oracle identity")
    return _uuid(identities.pop(), "reversible oracle identity")


def normalize_card(
    record: dict[str, Any], set_metadata: dict[uuid.UUID, SetMetadata] | None = None
) -> NormalizedCard:
    if not isinstance(record, dict):
        raise ValueError("card record must be an object")
    layout = str(record.get("layout") or "")
    name = str(record.get("name") or "").strip()
    language = str(record.get("lang") or "").strip()
    if not name or not layout or not language:
        raise ValueError("card is missing required identity fields")
    oracle_id = _oracle_identity(record)
    set_id = _uuid(record.get("set_id"), "set_id")
    metadata = (set_metadata or {}).get(set_id)
    card_set = NormalizedSet(
        game="mtg",
        scryfall_id=set_id,
        code=metadata.code if metadata else str(record.get("set") or "").strip(),
        name=metadata.name if metadata else str(record.get("set_name") or "").strip(),
        set_type=metadata.set_type if metadata else str(record.get("set_type") or "unknown"),
        released_at=metadata.released_at if metadata else _date(record.get("released_at")),
        card_count=metadata.card_count if metadata else max(0, int(record.get("card_count") or 0)),
        digital=metadata.digital if metadata else bool(record.get("digital", False)),
        icon_svg_uri=metadata.icon_svg_uri
        if metadata
        else approved_set_icon_url(record.get("set_icon_svg_uri")),
        source_uri=_scryfall_source_uri(metadata.source_uri if metadata else record.get("set_uri")),
        source_updated_at=metadata.source_updated_at if metadata else datetime.now(UTC),
    )
    if not card_set.code or not card_set.name:
        raise ValueError("card is missing set identity")
    oracle_source = record
    if layout == "reversible_card" and not record.get("oracle_id"):
        oracle_source = next(
            face
            for face in record["card_faces"]
            if _uuid(face.get("oracle_id"), "face oracle_id") == oracle_id
        )
    raw_faces = [face for face in record.get("card_faces") or [] if isinstance(face, dict)]
    face_type_line = _join_face_text(raw_faces, "type_line", " // ")
    face_oracle_text = _join_face_text(raw_faces, "oracle_text", "\n//\n")
    face_colors = _merge_face_colors(raw_faces)
    oracle = NormalizedOracle(
        game="mtg",
        scryfall_id=oracle_id,
        name=str(oracle_source.get("name") or name),
        layout=layout,
        mana_cost=oracle_source.get("mana_cost", record.get("mana_cost")),
        cmc=float(oracle_source.get("cmc", record.get("cmc")) or 0),
        type_line=oracle_source.get("type_line") or record.get("type_line") or face_type_line,
        oracle_text=oracle_source.get("oracle_text")
        or record.get("oracle_text")
        or face_oracle_text,
        colors=_string_list(oracle_source.get("colors") or record.get("colors")) or face_colors,
        color_identity=_string_list(record.get("color_identity")),
        keywords=_string_list(record.get("keywords")),
        legalities=_string_map(record.get("legalities")),
    )
    printing = NormalizedPrinting(
        game="mtg",
        scryfall_id=_uuid(record.get("id"), "printing id"),
        language=language,
        collector_number=str(record.get("collector_number") or ""),
        rarity=str(record.get("rarity") or "unknown"),
        released_at=_date(record.get("released_at")),
        artist=record.get("artist"),
        illustration_id=_optional_uuid(record.get("illustration_id")),
        digital=bool(record.get("digital", False)),
        promo=bool(record.get("promo", False)),
        layout=layout,
        frame=record.get("frame"),
        border_color=record.get("border_color"),
        image_status=record.get("image_status"),
        source_uri=_scryfall_source_uri(record.get("scryfall_uri")),
        image_uris=_image_map(record.get("image_uris")),
        prices=_price_map(record.get("prices")),
        finishes=_string_list(record.get("finishes")),
        games=_string_list(record.get("games")),
        colors=_string_list(record.get("colors")) or face_colors,
        color_identity=_string_list(record.get("color_identity")),
        legalities=_string_map(record.get("legalities")),
    )
    if not printing.collector_number:
        raise ValueError("card is missing collector number")
    faces = []
    for face in raw_faces:
        if not isinstance(face, dict) or not str(face.get("name") or "").strip():
            raise ValueError("card face is malformed")
        faces.append(
            NormalizedFace(
                name=str(face["name"]),
                mana_cost=face.get("mana_cost"),
                type_line=face.get("type_line"),
                oracle_text=face.get("oracle_text"),
                colors=_string_list(face.get("colors")),
                image_uris=_image_map(face.get("image_uris")),
                artist=face.get("artist"),
                illustration_id=_optional_uuid(face.get("illustration_id")),
            )
        )
    return NormalizedCard(card_set, oracle, printing, faces)


def _join_face_text(faces: list[dict[str, Any]], field: str, separator: str) -> str | None:
    values = [str(face.get(field) or "").strip() for face in faces]
    values = [value for value in values if value]
    return separator.join(values) or None


def _merge_face_colors(faces: list[dict[str, Any]]) -> list[str]:
    colors = []
    for face in faces:
        for color in _string_list(face.get("colors")):
            if color not in colors:
                colors.append(color)
    return colors


def stream_gzip_jsonl(path: Path) -> Iterator[tuple[int, dict[str, Any] | None]]:
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, start=1):
            try:
                value = json.loads(line)
                yield line_number, value if isinstance(value, dict) else None
            except (json.JSONDecodeError, UnicodeDecodeError):
                yield line_number, None


class CatalogRefreshLock:
    key = 0x574C4341524453

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]):
        self.session_factory = session_factory
        self.session: AsyncSession | None = None
        self.acquired = False

    async def __aenter__(self) -> bool:
        self.session = self.session_factory()
        bind = self.session.get_bind()
        if bind.dialect.name != "postgresql":
            self.acquired = True
            return True
        self.acquired = bool(
            await self.session.scalar(text("SELECT pg_try_advisory_lock(:key)"), {"key": self.key})
        )
        return self.acquired

    async def __aexit__(self, *_args) -> None:
        if self.session is not None:
            try:
                if self.acquired and self.session.get_bind().dialect.name == "postgresql":
                    await self.session.execute(
                        text("SELECT pg_advisory_unlock(:key)"), {"key": self.key}
                    )
            finally:
                await self.session.close()


class CatalogImporter:
    def __init__(
        self,
        settings: Settings,
        session_factory: async_sessionmaker[AsyncSession],
        *,
        source=None,
        providers: dict[str, Any] | None = None,
        lock_factory=None,
    ):
        self.settings = settings
        self.session_factory = session_factory
        self.source = source or ScryfallClient(settings)
        self.providers = providers or {}
        self.lock_factory = lock_factory or (lambda: CatalogRefreshLock(session_factory))

    async def refresh(self, game: str | None = None) -> ImportOutcome:
        requested = normalize_game(game) or "mtg"
        if requested != "all" and requested not in SUPPORTED_GAME_KEYS:
            raise ValueError("unsupported catalog game")
        async with self.lock_factory() as acquired:
            if not acquired:
                return ImportOutcome("busy", None, 0, 0, True)
            if requested == "all":
                outcomes = [await self._refresh_locked(key) for key in SUPPORTED_GAME_KEYS]
                return ImportOutcome(
                    "complete",
                    None,
                    sum(outcome.imported_records for outcome in outcomes),
                    sum(outcome.rejected_records for outcome in outcomes),
                    False,
                )
            return await self._refresh_locked(requested)

    async def _refresh_locked(self, game: str) -> ImportOutcome:
        if game != "mtg":
            return await self._refresh_provider_locked(game)
        metadata = await self.source.fetch_bulk_metadata()
        set_metadata = await self.source.fetch_sets() if hasattr(self.source, "fetch_sets") else {}
        import_id = await self._start_import(metadata, game)
        path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                prefix="wynterlabs-catalog-", suffix=".jsonl.gz", delete=False
            ) as temporary:
                path = Path(temporary.name)
            await self._set_status(import_id, "downloading")
            await self.source.download_bulk(metadata, path)
            await self._set_status(import_id, "importing")
            result = await self._promote(import_id, path, set_metadata, game=game)
            return result
        except Exception as error:
            await self._mark_failed(import_id, error)
            raise RuntimeError("catalog refresh failed; previous catalog remains active") from None
        finally:
            if path:
                path.unlink(missing_ok=True)

    async def _refresh_provider_locked(self, game: str) -> ImportOutcome:
        if game == "pokemon":
            from app.catalog.pokemon import PokemonClient, normalize_pokemon_card

            provider = self.providers.get(game) or PokemonClient(self.settings)
            normalizer = normalize_pokemon_card
        elif game == "yugioh":
            from app.catalog.yugioh import YugiohClient, normalize_yugioh_card

            provider = self.providers.get(game) or YugiohClient(self.settings)
            normalizer = normalize_yugioh_card
        elif game == "onepiece":
            from app.catalog.one_piece import OnePieceClient, normalize_one_piece_card

            provider = self.providers.get(game) or OnePieceClient(self.settings)
            normalizer = normalize_one_piece_card
        else:
            from app.catalog.tcgjson import TcgJsonClient, catalog_url, normalize_tcgjson_card

            provider = self.providers.get(game) or TcgJsonClient(self.settings, game)
            normalizer = lambda record: normalize_tcgjson_card(record, game)
        metadata = BulkMetadata(
            uuid.uuid5(uuid.NAMESPACE_URL, f"wynterlabs:catalog:{game}"),
            datetime.now(UTC),
            (
                "https://api.pokemontcg.io/v2/cards"
                if game == "pokemon"
                else (
                    "https://db.ygoprodeck.com/api/v7/cardinfo.php"
                    if game == "yugioh"
                    else (
                        "https://github.com/HanClinto/tcgjson/releases/latest/download/one-piece.full.json.gz"
                        if game == "onepiece"
                        else catalog_url(game)
                    )
                )
            ),
            0,
        )
        import_id = await self._start_import(metadata, game)
        path: Path | None = None
        try:
            await self._set_status(import_id, "downloading")
            records = await provider.fetch_cards()
            if (
                not isinstance(records, list)
                or len(records) > self.settings.catalog_provider_max_records
            ):
                raise ValueError("provider returned invalid catalog data")
            with tempfile.NamedTemporaryFile(
                prefix=f"wynterlabs-{game}-", suffix=".jsonl.gz", delete=False
            ) as temporary:
                path = Path(temporary.name)
            with gzip.open(path, "wt", encoding="utf-8") as output:
                for record in records:
                    if not isinstance(record, dict):
                        raise ValueError("provider response contained invalid card data")
                    output.write(json.dumps(record, separators=(",", ":")) + "\n")
            await self._set_status(import_id, "importing")
            return await self._promote(import_id, path, {}, game=game, normalizer=normalizer)
        except Exception as error:
            await self._mark_failed(import_id, error)
            raise RuntimeError("catalog refresh failed; previous catalog remains active") from None
        finally:
            if path:
                path.unlink(missing_ok=True)

    async def _start_import(self, metadata: BulkMetadata, game: str) -> uuid.UUID:
        item = CatalogImport(
            id=uuid.uuid4(),
            game=game,
            source_bulk_id=metadata.bulk_id,
            source_updated_at=metadata.updated_at,
            source_uri=metadata.download_uri,
            status="pending",
            active=False,
        )
        async with self.session_factory() as session:
            session.add(item)
            await session.commit()
        return item.id

    async def _set_status(self, import_id: uuid.UUID, status: str) -> None:
        async with self.session_factory() as session:
            item = await session.get(CatalogImport, import_id)
            item.status = status
            await session.commit()

    async def _mark_failed(self, import_id: uuid.UUID, error: Exception) -> None:
        summary = f"Catalog refresh failed ({type(error).__name__}); details omitted"
        async with self.session_factory() as session:
            item = await session.get(CatalogImport, import_id)
            item.status = "failed"
            item.active = False
            item.error_summary = summary[:512]
            item.completed_at = datetime.now(UTC)
            if isinstance(error, CatalogValidationError):
                item.total_records = error.total
                item.imported_records = error.imported
                item.rejected_records = error.rejected
            await session.commit()

    async def _promote(
        self,
        import_id: uuid.UUID,
        path: Path,
        set_metadata: dict[uuid.UUID, SetMetadata],
        *,
        game: str,
        normalizer=normalize_card,
    ) -> ImportOutcome:
        total = rejected = imported = 0
        seen: set[uuid.UUID] = set()
        batch: list[NormalizedCard] = []
        checksum = hashlib.sha256()
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                checksum.update(chunk)
        async with self.session_factory() as session, session.begin():
            item = await session.get(CatalogImport, import_id)
            await session.execute(update(CardSet).where(CardSet.game == game).values(active=False))
            await session.execute(
                update(OracleCard).where(OracleCard.game == game).values(active=False)
            )
            await session.execute(
                update(CardPrinting).where(CardPrinting.game == game).values(active=False)
            )
            for _line, raw in stream_gzip_jsonl(path):
                total += 1
                if raw is None:
                    rejected += 1
                    continue
                try:
                    normalized = (
                        normalizer(raw, set_metadata)
                        if game in {"mtg", "yugioh"}
                        else normalizer(raw)
                    )
                except (ValueError, TypeError, OverflowError):
                    rejected += 1
                    continue
                cards = normalized if isinstance(normalized, list) else [normalized]
                if not cards or any(card.printing.game != game for card in cards):
                    rejected += 1
                    continue
                for card in cards:
                    if card.printing.scryfall_id in seen:
                        rejected += 1
                        continue
                    seen.add(card.printing.scryfall_id)
                    batch.append(card)
                    if len(batch) >= self.settings.catalog_batch_size:
                        await self._upsert_batch(session, item, batch)
                        imported += len(batch)
                        batch.clear()
            if batch:
                await self._upsert_batch(session, item, batch)
                imported += len(batch)
            rejected_ratio = rejected / total if total else 1.0
            if (
                rejected > self.settings.catalog_max_rejected_records
                or rejected_ratio > self.settings.catalog_max_rejected_ratio
            ):
                raise CatalogValidationError(
                    "catalog rejected-record threshold was exceeded",
                    total,
                    imported,
                    rejected,
                )
            set_count = await session.scalar(
                select(func.count())
                .select_from(CardSet)
                .where(CardSet.active, CardSet.game == game)
            )
            oracle_count = await session.scalar(
                select(func.count())
                .select_from(OracleCard)
                .where(OracleCard.active, OracleCard.game == game)
            )
            printing_count = await session.scalar(
                select(func.count())
                .select_from(CardPrinting)
                .where(CardPrinting.active, CardPrinting.game == game)
            )
            min_printings, min_sets = validation_thresholds(self.settings, game)
            if printing_count < min_printings or set_count < min_sets:
                raise CatalogValidationError(
                    "catalog validation thresholds were not met",
                    total,
                    imported,
                    rejected,
                )
            item.status = "validating"
            await session.flush()
            await session.execute(
                update(CatalogImport)
                .where(
                    CatalogImport.active,
                    CatalogImport.game == game,
                    CatalogImport.id != import_id,
                )
                .values(active=False)
            )
            item.status = "complete"
            item.active = True
            item.completed_at = datetime.now(UTC)
            item.total_records = total
            item.imported_records = imported
            item.rejected_records = rejected
            item.set_count = set_count
            item.oracle_count = oracle_count
            item.printing_count = printing_count
            item.checksum = f"sha256:{checksum.hexdigest()}"
        return ImportOutcome("complete", import_id, imported, rejected, False)

    async def _upsert_batch(
        self, session: AsyncSession, item: CatalogImport, cards: list[NormalizedCard]
    ) -> None:
        set_ids = {card.card_set.scryfall_id for card in cards}
        oracle_ids = {card.oracle.scryfall_id for card in cards}
        printing_ids = {card.printing.scryfall_id for card in cards}
        sets = {
            row.scryfall_id: row
            for row in (
                await session.scalars(select(CardSet).where(CardSet.scryfall_id.in_(set_ids)))
            ).all()
        }
        oracles = {
            row.scryfall_id: row
            for row in (
                await session.scalars(
                    select(OracleCard).where(OracleCard.scryfall_id.in_(oracle_ids))
                )
            ).all()
        }
        printings = {
            row.scryfall_id: row
            for row in (
                await session.scalars(
                    select(CardPrinting).where(CardPrinting.scryfall_id.in_(printing_ids))
                )
            ).all()
        }
        affected_printing_ids: list[uuid.UUID] = []
        face_rows: list[CardFace] = []

        for card in cards:
            set_row = sets.get(card.card_set.scryfall_id)
            if set_row is None:
                set_row = CardSet(
                    id=uuid.uuid4(),
                    scryfall_id=card.card_set.scryfall_id,
                    first_seen_import_id=item.id,
                )
                sets[card.card_set.scryfall_id] = set_row
                session.add(set_row)
            self._update_set(set_row, card.card_set, item.id)
            oracle_row = oracles.get(card.oracle.scryfall_id)
            oracle_was_new = oracle_row is None
            if oracle_row is None:
                oracle_row = OracleCard(
                    id=uuid.uuid4(),
                    scryfall_id=card.oracle.scryfall_id,
                    first_seen_import_id=item.id,
                )
                oracles[card.oracle.scryfall_id] = oracle_row
                session.add(oracle_row)
            if oracle_was_new or card.oracle.layout != "reversible_card":
                self._update_oracle(oracle_row, card.oracle, item.id)

        await session.flush()
        for card in cards:
            set_row = sets[card.card_set.scryfall_id]
            oracle_row = oracles[card.oracle.scryfall_id]
            printing_row = printings.get(card.printing.scryfall_id)
            if printing_row is None:
                printing_row = CardPrinting(
                    id=uuid.uuid4(),
                    scryfall_id=card.printing.scryfall_id,
                    first_seen_import_id=item.id,
                )
                printings[card.printing.scryfall_id] = printing_row
                session.add(printing_row)
            self._update_printing(printing_row, card.printing, oracle_row.id, set_row.id, item.id)
            affected_printing_ids.append(printing_row.id)
            for index, face in enumerate(card.faces):
                face_rows.append(
                    CardFace(
                        id=uuid.uuid4(),
                        printing_id=printing_row.id,
                        face_index=index,
                        **face.__dict__,
                    )
                )

        if affected_printing_ids:
            await session.execute(
                delete(CardFace).where(CardFace.printing_id.in_(affected_printing_ids))
            )
        session.add_all(face_rows)

    @staticmethod
    def _update_set(row, value, import_id):
        for field in (
            "game",
            "code",
            "name",
            "set_type",
            "released_at",
            "card_count",
            "digital",
            "icon_svg_uri",
            "source_uri",
        ):
            setattr(row, field, getattr(value, field))
        row.code_normalized = value.code.casefold()
        row.source_updated_at = value.source_updated_at
        row.last_seen_import_id = import_id
        row.active = True

    @staticmethod
    def _update_oracle(row, value, import_id):
        for field in (
            "game",
            "name",
            "layout",
            "mana_cost",
            "cmc",
            "type_line",
            "oracle_text",
            "colors",
            "color_identity",
            "keywords",
            "legalities",
        ):
            setattr(row, field, getattr(value, field))
        row.name_normalized = value.name.casefold()
        row.last_seen_import_id = import_id
        row.active = True

    @staticmethod
    def _update_printing(row, value, oracle_id, set_id, import_id):
        for field in (
            "game",
            "language",
            "collector_number",
            "rarity",
            "released_at",
            "artist",
            "illustration_id",
            "digital",
            "promo",
            "layout",
            "frame",
            "border_color",
            "image_status",
            "source_uri",
            "image_uris",
            "prices",
            "finishes",
            "games",
            "colors",
            "color_identity",
            "legalities",
        ):
            setattr(row, field, getattr(value, field))
        row.oracle_card_id = oracle_id
        row.card_set_id = set_id
        row.source_updated_at = datetime.now(UTC)
        row.price_snapshot_at = datetime.now(UTC)
        row.last_seen_import_id = import_id
        row.active = True
