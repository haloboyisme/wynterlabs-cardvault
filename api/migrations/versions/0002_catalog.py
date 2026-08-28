"""Add versioned Magic card catalog tables and search indexes."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

JSON_DOCUMENT = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")

revision = "0002_catalog"
down_revision = "0001_identity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "catalog_imports",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("source_bulk_id", sa.Uuid(), nullable=False),
        sa.Column("source_updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source_uri", sa.String(2048), nullable=False),
        sa.Column("checksum", sa.String(128), nullable=True),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("total_records", sa.Integer(), nullable=False),
        sa.Column("imported_records", sa.Integer(), nullable=False),
        sa.Column("rejected_records", sa.Integer(), nullable=False),
        sa.Column("set_count", sa.Integer(), nullable=False),
        sa.Column("oracle_count", sa.Integer(), nullable=False),
        sa.Column("printing_count", sa.Integer(), nullable=False),
        sa.Column("error_summary", sa.String(512), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('pending', 'downloading', 'importing', 'validating', 'complete', 'failed')",
            name="ck_catalog_imports_status",
        ),
        sa.CheckConstraint(
            "(NOT active) OR (status = 'complete' AND completed_at IS NOT NULL)",
            name="ck_catalog_imports_active_complete",
        ),
        sa.CheckConstraint(
            "total_records >= 0 AND imported_records >= 0 AND rejected_records >= 0 "
            "AND set_count >= 0 AND oracle_count >= 0 AND printing_count >= 0",
            name="ck_catalog_imports_nonnegative_counts",
        ),
    )
    op.create_index("ix_catalog_imports_active", "catalog_imports", ["active"])
    op.create_index("ix_catalog_imports_source_bulk_id", "catalog_imports", ["source_bulk_id"])
    op.create_index(
        "uq_catalog_imports_one_active",
        "catalog_imports",
        ["active"],
        unique=True,
        postgresql_where=sa.text("active"),
    )
    op.create_index(
        "ix_catalog_imports_source_updated_at", "catalog_imports", ["source_updated_at"]
    )
    op.create_index(
        "ix_catalog_imports_status_started", "catalog_imports", ["status", "started_at"]
    )

    op.create_table(
        "card_sets",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("scryfall_id", sa.Uuid(), nullable=False, unique=True),
        sa.Column("code", sa.String(16), nullable=False),
        sa.Column("code_normalized", sa.String(16), nullable=False, unique=True),
        sa.Column("name", sa.String(256), nullable=False),
        sa.Column("set_type", sa.String(64), nullable=False),
        sa.Column("released_at", sa.Date(), nullable=True),
        sa.Column("card_count", sa.Integer(), nullable=False),
        sa.Column("digital", sa.Boolean(), nullable=False),
        sa.Column("icon_svg_uri", sa.String(2048), nullable=True),
        sa.Column("source_uri", sa.String(2048), nullable=True),
        sa.Column("source_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "first_seen_import_id",
            sa.Uuid(),
            sa.ForeignKey("catalog_imports.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "last_seen_import_id",
            sa.Uuid(),
            sa.ForeignKey("catalog_imports.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("active", sa.Boolean(), nullable=False),
    )
    _indexes(
        "card_sets",
        "set_type",
        "released_at",
        "first_seen_import_id",
        "last_seen_import_id",
        "active",
    )
    op.create_index("ix_card_sets_active_released", "card_sets", ["active", "released_at"])
    op.create_index("ix_card_sets_name", "card_sets", ["name"])

    op.create_table(
        "oracle_cards",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("scryfall_id", sa.Uuid(), nullable=False, unique=True),
        sa.Column("name", sa.String(512), nullable=False),
        sa.Column("name_normalized", sa.String(512), nullable=False),
        sa.Column("layout", sa.String(64), nullable=False),
        sa.Column("mana_cost", sa.String(256), nullable=True),
        sa.Column("cmc", sa.Float(), nullable=False),
        sa.Column("type_line", sa.String(512), nullable=True),
        sa.Column("oracle_text", sa.Text(), nullable=True),
        sa.Column("colors", JSON_DOCUMENT, nullable=False),
        sa.Column("color_identity", JSON_DOCUMENT, nullable=False),
        sa.Column("keywords", JSON_DOCUMENT, nullable=False),
        sa.Column("legalities", JSON_DOCUMENT, nullable=False),
        sa.Column(
            "first_seen_import_id",
            sa.Uuid(),
            sa.ForeignKey("catalog_imports.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "last_seen_import_id",
            sa.Uuid(),
            sa.ForeignKey("catalog_imports.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("active", sa.Boolean(), nullable=False),
    )
    _indexes(
        "oracle_cards",
        "name_normalized",
        "first_seen_import_id",
        "last_seen_import_id",
        "active",
    )
    op.create_index("ix_oracle_cards_active_name", "oracle_cards", ["active", "name_normalized"])
    op.create_index("ix_oracle_cards_type_line", "oracle_cards", ["type_line"])
    op.create_index(
        "ix_oracle_cards_legalities_gin",
        "oracle_cards",
        ["legalities"],
        postgresql_using="gin",
    )

    op.create_table(
        "card_printings",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("scryfall_id", sa.Uuid(), nullable=False, unique=True),
        sa.Column(
            "oracle_card_id",
            sa.Uuid(),
            sa.ForeignKey("oracle_cards.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "card_set_id",
            sa.Uuid(),
            sa.ForeignKey("card_sets.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("language", sa.String(8), nullable=False),
        sa.Column("collector_number", sa.String(64), nullable=False),
        sa.Column("rarity", sa.String(32), nullable=False),
        sa.Column("released_at", sa.Date(), nullable=True),
        sa.Column("artist", sa.String(256), nullable=True),
        sa.Column("illustration_id", sa.Uuid(), nullable=True),
        sa.Column("digital", sa.Boolean(), nullable=False),
        sa.Column("promo", sa.Boolean(), nullable=False),
        sa.Column("layout", sa.String(64), nullable=False),
        sa.Column("frame", sa.String(32), nullable=True),
        sa.Column("border_color", sa.String(32), nullable=True),
        sa.Column("image_status", sa.String(32), nullable=True),
        sa.Column("source_uri", sa.String(2048), nullable=True),
        sa.Column("source_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("price_snapshot_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("image_uris", JSON_DOCUMENT, nullable=False),
        sa.Column("prices", JSON_DOCUMENT, nullable=False),
        sa.Column("finishes", JSON_DOCUMENT, nullable=False),
        sa.Column("games", JSON_DOCUMENT, nullable=False),
        sa.Column("colors", JSON_DOCUMENT, nullable=False),
        sa.Column("color_identity", JSON_DOCUMENT, nullable=False),
        sa.Column("legalities", JSON_DOCUMENT, nullable=False),
        sa.Column(
            "first_seen_import_id",
            sa.Uuid(),
            sa.ForeignKey("catalog_imports.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "last_seen_import_id",
            sa.Uuid(),
            sa.ForeignKey("catalog_imports.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("active", sa.Boolean(), nullable=False),
    )
    _indexes(
        "card_printings",
        "oracle_card_id",
        "card_set_id",
        "language",
        "collector_number",
        "rarity",
        "released_at",
        "first_seen_import_id",
        "last_seen_import_id",
        "active",
    )
    op.create_index(
        "ix_card_printings_active_released", "card_printings", ["active", "released_at"]
    )
    op.create_index(
        "ix_card_printings_set_collector",
        "card_printings",
        ["card_set_id", "collector_number"],
    )
    op.create_index("ix_card_printings_set_language", "card_printings", ["card_set_id", "language"])
    op.create_index(
        "ix_card_printings_oracle_active", "card_printings", ["oracle_card_id", "active"]
    )
    for column in ("finishes", "games", "colors", "color_identity"):
        op.create_index(
            f"ix_card_printings_{column}_gin",
            "card_printings",
            [column],
            postgresql_using="gin",
        )

    op.create_table(
        "card_faces",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "printing_id",
            sa.Uuid(),
            sa.ForeignKey("card_printings.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("face_index", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(512), nullable=False),
        sa.Column("mana_cost", sa.String(256), nullable=True),
        sa.Column("type_line", sa.String(512), nullable=True),
        sa.Column("oracle_text", sa.Text(), nullable=True),
        sa.Column("colors", JSON_DOCUMENT, nullable=False),
        sa.Column("image_uris", JSON_DOCUMENT, nullable=False),
        sa.Column("artist", sa.String(256), nullable=True),
        sa.Column("illustration_id", sa.Uuid(), nullable=True),
        sa.UniqueConstraint("printing_id", "face_index", name="uq_card_faces_printing_order"),
    )

    if op.get_bind().dialect.name == "postgresql":
        op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
        op.execute(
            "CREATE INDEX ix_oracle_cards_name_trgm "
            "ON oracle_cards USING gin (name_normalized gin_trgm_ops)"
        )
        op.execute(
            "CREATE INDEX ix_oracle_cards_type_line_trgm "
            "ON oracle_cards USING gin (lower(type_line) gin_trgm_ops)"
        )
        op.execute(
            "CREATE INDEX ix_card_printings_collector_lower "
            "ON card_printings (lower(collector_number))"
        )
        op.execute(
            "CREATE INDEX ix_oracle_cards_search_document ON oracle_cards USING gin "
            "(to_tsvector('english', coalesce(name, '') || ' ' || "
            "coalesce(type_line, '') || ' ' || coalesce(oracle_text, '')))"
        )


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP INDEX IF EXISTS ix_oracle_cards_search_document")
        op.execute("DROP INDEX IF EXISTS ix_card_printings_collector_lower")
        op.execute("DROP INDEX IF EXISTS ix_oracle_cards_type_line_trgm")
        op.execute("DROP INDEX IF EXISTS ix_oracle_cards_name_trgm")
    op.drop_table("card_faces")
    op.drop_table("card_printings")
    op.drop_table("oracle_cards")
    op.drop_table("card_sets")
    op.drop_table("catalog_imports")


def _indexes(table_name: str, *columns: str) -> None:
    for column in columns:
        op.create_index(f"ix_{table_name}_{column}", table_name, [column])
