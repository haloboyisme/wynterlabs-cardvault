import enum
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.collection_constants import COLLECTION_CONDITIONS, DECK_SECTIONS, FORMATS
from app.database import Base


def json_document():
    return JSON().with_variant(JSONB, "postgresql")


def utcnow() -> datetime:
    return datetime.now(UTC)


class Role(str, enum.Enum):
    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320))
    email_normalized: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(64))
    display_name_normalized: Mapped[str] = mapped_column(String(64), unique=True)
    password_hash: Mapped[str] = mapped_column(String(512))
    role: Mapped[Role] = mapped_column(Enum(Role), default=Role.MEMBER)
    owner_slot: Mapped[int | None] = mapped_column(Integer, unique=True, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    password_changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    sessions: Mapped[list["UserSession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    collection_value_snapshots: Mapped[list["CollectionValueSnapshot"]] = relationship(
        cascade="all, delete-orphan"
    )


class UserSession(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    client_ip: Mapped[str] = mapped_column(String(64))
    user_agent: Mapped[str] = mapped_column(String(256))
    user: Mapped[User] = relationship(back_populates="sessions")


class MfaCredential(Base):
    __tablename__ = "mfa_credentials"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    __table_args__ = (
        CheckConstraint(
            "(enabled_at IS NULL AND pending_expires_at IS NOT NULL) OR "
            "(enabled_at IS NOT NULL AND pending_expires_at IS NULL)",
            name="ck_mfa_credentials_pending_state",
        ),
    )
    encrypted_totp_secret: Mapped[str] = mapped_column(Text)
    enabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    pending_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_totp_counter: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class MfaLoginChallenge(Base):
    __tablename__ = "mfa_login_challenges"
    __table_args__ = (
        CheckConstraint("failed_attempts BETWEEN 0 AND 10", name="ck_mfa_challenges_attempts"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    client_ip: Mapped[str] = mapped_column(String(64))
    user_agent: Mapped[str] = mapped_column(String(256))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MfaRecoveryCode(Base):
    __tablename__ = "mfa_recovery_codes"
    __table_args__ = (
        CheckConstraint("generation > 0", name="ck_mfa_recovery_codes_generation"),
        Index("ix_mfa_recovery_codes_user_generation", "user_id", "generation"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    generation: Mapped[int] = mapped_column(Integer)
    code_hash: Mapped[str] = mapped_column(String(512))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SecurityAuditEvent(Base):
    __tablename__ = "security_audit_events"
    __table_args__ = (
        CheckConstraint(
            "event_type IN ('mfa_enrolled', 'mfa_recovery_codes_regenerated', "
            "'mfa_recovery_code_redeemed', 'owner_mfa_break_glass')",
            name="ck_security_audit_event_type",
        ),
        CheckConstraint("actor_type IN ('self', 'console')", name="ck_security_audit_actor_type"),
        Index("ix_security_audit_events_type_created", "event_type", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    subject_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    event_type: Mapped[str] = mapped_column(String(64))
    actor_type: Mapped[str] = mapped_column(String(16))
    details: Mapped[dict[str, object]] = mapped_column(json_document(), default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class LoginAttempt(Base):
    __tablename__ = "login_attempts"
    __table_args__ = (
        Index("ix_login_attempts_ip_created", "client_ip", "created_at"),
        Index("ix_login_attempts_identifier_created", "identifier_hash", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    identifier_hash: Mapped[str] = mapped_column(String(64))
    client_ip: Mapped[str] = mapped_column(String(64))
    succeeded: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CatalogImport(Base):
    __tablename__ = "catalog_imports"
    __table_args__ = (
        Index("ix_catalog_imports_game_active", "game", "active"),
        Index("ix_catalog_imports_source_bulk_id", "source_bulk_id"),
        Index("ix_catalog_imports_source_updated_at", "source_updated_at"),
        Index("ix_catalog_imports_status_started", "status", "started_at"),
        Index(
            "uq_catalog_imports_one_active_per_game",
            "game",
            "active",
            unique=True,
            postgresql_where=text("active"),
            sqlite_where=text("active = 1"),
        ),
        CheckConstraint(
            "status IN ('pending', 'downloading', 'importing', 'validating', 'complete', 'failed')",
            name="ck_catalog_imports_status",
        ),
        CheckConstraint(
            "game IN ('mtg', 'pokemon', 'yugioh')",
            name="ck_catalog_imports_game",
        ),
        CheckConstraint(
            "(NOT active) OR (status = 'complete' AND completed_at IS NOT NULL)",
            name="ck_catalog_imports_active_complete",
        ),
        CheckConstraint(
            "total_records >= 0 AND imported_records >= 0 AND rejected_records >= 0 "
            "AND set_count >= 0 AND oracle_count >= 0 AND printing_count >= 0",
            name="ck_catalog_imports_nonnegative_counts",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    game: Mapped[str] = mapped_column(String(16), default="mtg", server_default="mtg")
    source_bulk_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    source_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    source_uri: Mapped[str] = mapped_column(String(2048))
    checksum: Mapped[str | None] = mapped_column(String(128))
    status: Mapped[str] = mapped_column(String(32))
    active: Mapped[bool] = mapped_column(Boolean, default=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    total_records: Mapped[int] = mapped_column(Integer, default=0)
    imported_records: Mapped[int] = mapped_column(Integer, default=0)
    rejected_records: Mapped[int] = mapped_column(Integer, default=0)
    set_count: Mapped[int] = mapped_column(Integer, default=0)
    oracle_count: Mapped[int] = mapped_column(Integer, default=0)
    printing_count: Mapped[int] = mapped_column(Integer, default=0)
    error_summary: Mapped[str | None] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CardSet(Base):
    __tablename__ = "card_sets"
    __table_args__ = (
        UniqueConstraint("game", "code_normalized", name="uq_card_sets_game_code_normalized"),
        Index("ix_card_sets_active_released", "active", "released_at"),
        Index("ix_card_sets_game_active", "game", "active"),
        Index("ix_card_sets_name", "name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    scryfall_id: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True)
    game: Mapped[str] = mapped_column(String(16), default="mtg", server_default="mtg")
    code: Mapped[str] = mapped_column(String(16))
    code_normalized: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(256))
    set_type: Mapped[str] = mapped_column(String(64), index=True)
    released_at: Mapped[date | None] = mapped_column(Date, index=True)
    card_count: Mapped[int] = mapped_column(Integer, default=0)
    digital: Mapped[bool] = mapped_column(Boolean, default=False)
    icon_svg_uri: Mapped[str | None] = mapped_column(String(2048))
    source_uri: Mapped[str | None] = mapped_column(String(2048))
    source_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    first_seen_import_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("catalog_imports.id", ondelete="RESTRICT"), index=True
    )
    last_seen_import_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("catalog_imports.id", ondelete="RESTRICT"), index=True
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)


class OracleCard(Base):
    __tablename__ = "oracle_cards"
    __table_args__ = (
        Index("ix_oracle_cards_active_name", "active", "name_normalized"),
        Index("ix_oracle_cards_type_line", "type_line"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    scryfall_id: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True)
    game: Mapped[str] = mapped_column(String(16), default="mtg", server_default="mtg")
    name: Mapped[str] = mapped_column(String(512))
    name_normalized: Mapped[str] = mapped_column(String(512), index=True)
    layout: Mapped[str] = mapped_column(String(64))
    mana_cost: Mapped[str | None] = mapped_column(String(256))
    cmc: Mapped[float] = mapped_column(Float, default=0)
    type_line: Mapped[str | None] = mapped_column(String(512))
    oracle_text: Mapped[str | None] = mapped_column(Text)
    colors: Mapped[list[str]] = mapped_column(json_document(), default=list)
    color_identity: Mapped[list[str]] = mapped_column(json_document(), default=list)
    keywords: Mapped[list[str]] = mapped_column(json_document(), default=list)
    legalities: Mapped[dict[str, str]] = mapped_column(json_document(), default=dict)
    first_seen_import_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("catalog_imports.id", ondelete="RESTRICT"), index=True
    )
    last_seen_import_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("catalog_imports.id", ondelete="RESTRICT"), index=True
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)


class CardPrinting(Base):
    __tablename__ = "card_printings"
    __table_args__ = (
        Index("ix_card_printings_active_released", "active", "released_at"),
        Index("ix_card_printings_set_collector", "card_set_id", "collector_number"),
        Index("ix_card_printings_set_language", "card_set_id", "language"),
        Index("ix_card_printings_oracle_active", "oracle_card_id", "active"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    scryfall_id: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True)
    game: Mapped[str] = mapped_column(String(16), default="mtg", server_default="mtg")
    oracle_card_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("oracle_cards.id", ondelete="RESTRICT"), index=True
    )
    card_set_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("card_sets.id", ondelete="RESTRICT"), index=True
    )
    language: Mapped[str] = mapped_column(String(8), index=True)
    collector_number: Mapped[str] = mapped_column(String(64), index=True)
    rarity: Mapped[str] = mapped_column(String(32), index=True)
    released_at: Mapped[date | None] = mapped_column(Date, index=True)
    artist: Mapped[str | None] = mapped_column(String(256))
    illustration_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    digital: Mapped[bool] = mapped_column(Boolean, default=False)
    promo: Mapped[bool] = mapped_column(Boolean, default=False)
    layout: Mapped[str] = mapped_column(String(64))
    frame: Mapped[str | None] = mapped_column(String(32))
    border_color: Mapped[str | None] = mapped_column(String(32))
    image_status: Mapped[str | None] = mapped_column(String(32))
    source_uri: Mapped[str | None] = mapped_column(String(2048))
    source_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    price_snapshot_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    image_uris: Mapped[dict[str, str]] = mapped_column(json_document(), default=dict)
    prices: Mapped[dict[str, str | None]] = mapped_column(json_document(), default=dict)
    finishes: Mapped[list[str]] = mapped_column(json_document(), default=list)
    games: Mapped[list[str]] = mapped_column(json_document(), default=list)
    colors: Mapped[list[str]] = mapped_column(json_document(), default=list)
    color_identity: Mapped[list[str]] = mapped_column(json_document(), default=list)
    legalities: Mapped[dict[str, str]] = mapped_column(json_document(), default=dict)
    first_seen_import_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("catalog_imports.id", ondelete="RESTRICT"), index=True
    )
    last_seen_import_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("catalog_imports.id", ondelete="RESTRICT"), index=True
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)


class CardFace(Base):
    __tablename__ = "card_faces"
    __table_args__ = (
        UniqueConstraint("printing_id", "face_index", name="uq_card_faces_printing_order"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    printing_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("card_printings.id", ondelete="CASCADE")
    )
    face_index: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(512))
    mana_cost: Mapped[str | None] = mapped_column(String(256))
    type_line: Mapped[str | None] = mapped_column(String(512))
    oracle_text: Mapped[str | None] = mapped_column(Text)
    colors: Mapped[list[str]] = mapped_column(json_document(), default=list)
    image_uris: Mapped[dict[str, str]] = mapped_column(json_document(), default=dict)
    artist: Mapped[str | None] = mapped_column(String(256))
    illustration_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)


class AccountInvitation(Base):
    __tablename__ = "account_invitations"
    __table_args__ = (
        CheckConstraint(
            "length(token_hash) = 64",
            name="ck_account_invitations_token_hash",
        ),
        CheckConstraint("revision >= 1", name="ck_account_invitations_revision"),
        CheckConstraint(
            "expires_at > created_at",
            name="ck_account_invitations_expiry",
        ),
        CheckConstraint(
            "NOT (revoked_at IS NOT NULL AND used_at IS NOT NULL)",
            name="ck_account_invitations_terminal_state",
        ),
        Index(
            "ix_account_invitations_creator_created",
            "created_by_user_id",
            "created_at",
        ),
        Index(
            "ix_account_invitations_expires_used_revoked",
            "expires_at",
            "used_at",
            "revoked_at",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    used_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class CollectionImportPreview(Base):
    __tablename__ = "collection_import_previews"
    __table_args__ = (
        CheckConstraint(
            "length(source_sha256) = 64",
            name="ck_collection_import_previews_source_sha256",
        ),
        CheckConstraint(
            "length(collection_digest) = 64",
            name="ck_collection_import_previews_collection_digest",
        ),
        CheckConstraint("revision >= 1", name="ck_collection_import_previews_revision"),
        CheckConstraint(
            "expires_at > created_at",
            name="ck_collection_import_previews_expiry",
        ),
        Index(
            "ix_collection_import_previews_user_expires",
            "user_id",
            "expires_at",
        ),
        Index(
            "uq_collection_import_previews_user_source_open",
            "user_id",
            "source_sha256",
            unique=True,
            postgresql_where=text("confirmed_at IS NULL"),
            sqlite_where=text("confirmed_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    source_sha256: Mapped[str] = mapped_column(String(64))
    rows: Mapped[list[dict[str, object]]] = mapped_column(json_document(), default=list)
    summary: Mapped[dict[str, object]] = mapped_column(json_document(), default=dict)
    collection_digest: Mapped[str] = mapped_column(String(64))
    revision: Mapped[int] = mapped_column(Integer, default=1)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class CollectionItem(Base):
    __tablename__ = "collection_items"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "printing_id",
            "finish",
            "condition",
            name="uq_collection_items_user_printing_finish_condition",
        ),
        CheckConstraint(
            "condition IN (" + ", ".join(f"'{value}'" for value in COLLECTION_CONDITIONS) + ")",
            name="ck_collection_items_condition",
        ),
        CheckConstraint("length(finish) BETWEEN 1 AND 16", name="ck_collection_items_finish"),
        CheckConstraint("quantity >= 1 AND quantity <= 9999", name="ck_collection_items_quantity"),
        CheckConstraint(
            "manual_price_usd IS NULL OR (manual_price_usd >= 0 AND manual_price_usd <= 999999.99)",
            name="ck_collection_items_manual_price_usd",
        ),
        CheckConstraint("revision >= 1", name="ck_collection_items_revision"),
        Index("ix_collection_items_user_updated", "user_id", "updated_at"),
        Index("ix_collection_items_user_printing", "user_id", "printing_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    printing_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("card_printings.id", ondelete="RESTRICT"), index=True
    )
    finish: Mapped[str] = mapped_column(String(16))
    condition: Mapped[str] = mapped_column(String(32))
    quantity: Mapped[int] = mapped_column(Integer)
    manual_price_usd: Mapped[Decimal | None] = mapped_column(Numeric(8, 2), nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class CollectionValueSnapshot(Base):
    __tablename__ = "collection_value_snapshots"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "minute_bucket", name="uq_collection_value_snapshots_user_minute"
        ),
        CheckConstraint(
            "estimated_value_usd >= 0 AND estimated_value_usd <= 999999999999.99",
            name="ck_collection_value_snapshots_value",
        ),
        CheckConstraint(
            "priced_copies >= 0 AND unpriced_copies >= 0 AND total_copies >= 0",
            name="ck_collection_value_snapshots_nonnegative_copies",
        ),
        CheckConstraint(
            "priced_copies + unpriced_copies = total_copies",
            name="ck_collection_value_snapshots_copy_coverage",
        ),
        CheckConstraint(
            "trigger IN ('collection', 'price', 'view')",
            name="ck_collection_value_snapshots_trigger",
        ),
        Index("ix_collection_value_snapshots_user_captured", "user_id", "captured_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"))
    minute_bucket: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    estimated_value_usd: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    priced_copies: Mapped[int] = mapped_column(Integer)
    unpriced_copies: Mapped[int] = mapped_column(Integer)
    total_copies: Mapped[int] = mapped_column(Integer)
    oldest_price_snapshot_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    trigger: Mapped[str] = mapped_column(String(16))


class Deck(Base):
    __tablename__ = "decks"
    __table_args__ = (
        UniqueConstraint("user_id", "name_normalized", name="uq_decks_user_name_normalized"),
        CheckConstraint(
            "name = trim(name) AND length(name) BETWEEN 1 AND 120", name="ck_decks_name"
        ),
        CheckConstraint(
            "format IN (" + ", ".join(f"'{value}'" for value in FORMATS) + ")",
            name="ck_decks_format",
        ),
        CheckConstraint(
            "description IS NULL OR length(description) <= 2000", name="ck_decks_description"
        ),
        CheckConstraint("game IN ('mtg', 'pokemon', 'yugioh')", name="ck_decks_game"),
        CheckConstraint("revision >= 1", name="ck_decks_revision"),
        Index("ix_decks_user_updated", "user_id", "updated_at"),
        Index("ix_decks_user_format", "user_id", "format"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    name_normalized: Mapped[str] = mapped_column(String(120))
    game: Mapped[str] = mapped_column(String(16), default="mtg", server_default="mtg")
    format: Mapped[str] = mapped_column(String(32))
    description: Mapped[str | None] = mapped_column(Text)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    cards: Mapped[list["DeckCard"]] = relationship(
        back_populates="deck", cascade="all, delete-orphan"
    )


class DeckCard(Base):
    __tablename__ = "deck_cards"
    __table_args__ = (
        UniqueConstraint(
            "deck_id", "printing_id", "section", name="uq_deck_cards_deck_printing_section"
        ),
        CheckConstraint(
            "section IN (" + ", ".join(f"'{value}'" for value in DECK_SECTIONS) + ")",
            name="ck_deck_cards_section",
        ),
        CheckConstraint("quantity >= 1 AND quantity <= 9999", name="ck_deck_cards_quantity"),
        CheckConstraint("revision >= 1", name="ck_deck_cards_revision"),
        Index("ix_deck_cards_deck_section", "deck_id", "section"),
        Index("ix_deck_cards_printing", "printing_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    deck_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("decks.id", ondelete="CASCADE"), index=True
    )
    printing_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("card_printings.id", ondelete="RESTRICT"), index=True
    )
    section: Mapped[str] = mapped_column(String(32))
    quantity: Mapped[int] = mapped_column(Integer)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    deck: Mapped[Deck] = relationship(back_populates="cards")


Index(
    "ix_oracle_cards_legalities_gin",
    OracleCard.legalities,
    postgresql_using="gin",
).ddl_if(dialect="postgresql")
Index(
    "ix_card_printings_finishes_gin",
    CardPrinting.finishes,
    postgresql_using="gin",
).ddl_if(dialect="postgresql")
Index(
    "ix_card_printings_games_gin",
    CardPrinting.games,
    postgresql_using="gin",
).ddl_if(dialect="postgresql")
Index(
    "ix_card_printings_colors_gin",
    CardPrinting.colors,
    postgresql_using="gin",
).ddl_if(dialect="postgresql")
Index(
    "ix_card_printings_color_identity_gin",
    CardPrinting.color_identity,
    postgresql_using="gin",
).ddl_if(dialect="postgresql")


class TradingAccount(Base):
    __tablename__ = "trading_accounts"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_trading_accounts_user"),
        CheckConstraint("status IN ('active','suspended')", name="ck_trading_accounts_status"),
        CheckConstraint("active_strikes BETWEEN 0 AND 3", name="ck_trading_accounts_strikes"),
        CheckConstraint("revision >= 1", name="ck_trading_accounts_revision"),
        Index("ix_trading_accounts_status_user", "status", "user_id"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(16), default="active")
    active_strikes: Mapped[int] = mapped_column(Integer, default=0)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    suspended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class TradeListing(Base):
    __tablename__ = "trade_listings"
    __table_args__ = (
        UniqueConstraint("collection_item_id", name="uq_trade_listings_collection_item"),
        CheckConstraint("quantity BETWEEN 1 AND 9999", name="ck_trade_listings_quantity"),
        CheckConstraint("status IN ('active','removed')", name="ck_trade_listings_status"),
        CheckConstraint("revision >= 1", name="ck_trade_listings_revision"),
        Index("ix_trade_listings_user_status", "user_id", "status"),
        Index("ix_trade_listings_oracle_status", "oracle_card_id", "status"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"))
    collection_item_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("collection_items.id", ondelete="CASCADE")
    )
    oracle_card_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("oracle_cards.id", ondelete="RESTRICT")
    )
    quantity: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="active")
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class WantListing(Base):
    __tablename__ = "want_listings"
    __table_args__ = (
        CheckConstraint("quantity BETWEEN 1 AND 9999", name="ck_want_listings_quantity"),
        CheckConstraint("status IN ('active','removed')", name="ck_want_listings_status"),
        CheckConstraint("revision >= 1", name="ck_want_listings_revision"),
        Index("ix_want_listings_user_status", "user_id", "status"),
        Index("ix_want_listings_oracle_status", "oracle_card_id", "status"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"))
    oracle_card_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("oracle_cards.id", ondelete="RESTRICT")
    )
    printing_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("card_printings.id", ondelete="RESTRICT")
    )
    finish: Mapped[str | None] = mapped_column(String(16))
    condition: Mapped[str | None] = mapped_column(String(32))
    quantity: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="active")
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class TradeReport(Base):
    __tablename__ = "trade_reports"
    __table_args__ = (
        UniqueConstraint("incident_reference", name="uq_trade_reports_incident"),
        UniqueConstraint(
            "reporter_user_id",
            "trade_listing_id",
            name="uq_trade_reports_reporter_listing",
        ),
        CheckConstraint(
            "reason IN ('scam','spam','misrepresentation','harassment','other')",
            name="ck_trade_reports_reason",
        ),
        CheckConstraint("status IN ('open','upheld','dismissed')", name="ck_trade_reports_status"),
        CheckConstraint("revision >= 1", name="ck_trade_reports_revision"),
        Index("ix_trade_reports_status_created", "status", "created_at"),
        Index("ix_trade_reports_reported_status", "reported_user_id", "status"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    reporter_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE")
    )
    reported_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE")
    )
    trade_listing_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("trade_listings.id", ondelete="SET NULL")
    )
    reason: Mapped[str] = mapped_column(String(32))
    details: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="open")
    incident_reference: Mapped[str] = mapped_column(String(24), unique=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    moderated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL")
    )
    moderated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class TradeStrike(Base):
    __tablename__ = "trade_strikes"
    __table_args__ = (
        UniqueConstraint("report_id", name="uq_trade_strikes_report"),
        CheckConstraint("status IN ('active','void')", name="ck_trade_strikes_status"),
        CheckConstraint("revision >= 1", name="ck_trade_strikes_revision"),
        Index("ix_trade_strikes_account_status", "trading_account_id", "status"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    trading_account_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("trading_accounts.id", ondelete="CASCADE")
    )
    report_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("trade_reports.id", ondelete="CASCADE")
    )
    status: Mapped[str] = mapped_column(String(16), default="active")
    reason: Mapped[str] = mapped_column(Text)
    issued_by_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT")
    )
    voided_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL")
    )
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class TradeModerationEvent(Base):
    __tablename__ = "trade_moderation_events"
    __table_args__ = (Index("ix_trade_events_target_created", "target_user_id", "created_at"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    target_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE")
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL")
    )
    event_type: Mapped[str] = mapped_column(String(32))
    incident_reference: Mapped[str | None] = mapped_column(String(24))
    details: Mapped[dict[str, object]] = mapped_column(json_document(), default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
