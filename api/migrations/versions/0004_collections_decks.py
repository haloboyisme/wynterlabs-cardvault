"""Add private collections and decks."""

import sqlalchemy as sa
from alembic import op

revision = "0004_collections_decks"
down_revision = "0003_admin_controls"
branch_labels = None
depends_on = None

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


def _allowed(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


def upgrade() -> None:
    op.create_table(
        "collection_items",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("printing_id", sa.Uuid(), nullable=False),
        sa.Column("finish", sa.String(16), nullable=False),
        sa.Column("condition", sa.String(32), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_collection_items_user", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["printing_id"],
            ["card_printings.id"],
            name="fk_collection_items_printing",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint(
            "user_id",
            "printing_id",
            "finish",
            "condition",
            name="uq_collection_items_user_printing_finish_condition",
        ),
        sa.CheckConstraint(
            f"condition IN ({_allowed(COLLECTION_CONDITIONS)})",
            name="ck_collection_items_condition",
        ),
        sa.CheckConstraint("length(finish) BETWEEN 1 AND 16", name="ck_collection_items_finish"),
        sa.CheckConstraint("quantity BETWEEN 1 AND 9999", name="ck_collection_items_quantity"),
        sa.CheckConstraint("revision >= 1", name="ck_collection_items_revision"),
    )
    _create_indexes("collection_items", "user_id", "printing_id")
    op.create_index(
        "ix_collection_items_user_updated", "collection_items", ["user_id", "updated_at"]
    )
    op.create_index(
        "ix_collection_items_user_printing", "collection_items", ["user_id", "printing_id"]
    )

    op.create_table(
        "decks",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("name_normalized", sa.String(120), nullable=False),
        sa.Column("format", sa.String(32), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_decks_user", ondelete="CASCADE"
        ),
        sa.UniqueConstraint("user_id", "name_normalized", name="uq_decks_user_name_normalized"),
        sa.CheckConstraint(
            "name = trim(name) AND length(name) BETWEEN 1 AND 120", name="ck_decks_name"
        ),
        sa.CheckConstraint(f"format IN ({_allowed(FORMATS)})", name="ck_decks_format"),
        sa.CheckConstraint(
            "description IS NULL OR length(description) <= 2000", name="ck_decks_description"
        ),
        sa.CheckConstraint("revision >= 1", name="ck_decks_revision"),
    )
    _create_indexes("decks", "user_id")
    op.create_index("ix_decks_user_updated", "decks", ["user_id", "updated_at"])
    op.create_index("ix_decks_user_format", "decks", ["user_id", "format"])

    op.create_table(
        "deck_cards",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("deck_id", sa.Uuid(), nullable=False),
        sa.Column("printing_id", sa.Uuid(), nullable=False),
        sa.Column("section", sa.String(32), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["deck_id"], ["decks.id"], name="fk_deck_cards_deck", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["printing_id"],
            ["card_printings.id"],
            name="fk_deck_cards_printing",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint(
            "deck_id", "printing_id", "section", name="uq_deck_cards_deck_printing_section"
        ),
        sa.CheckConstraint(f"section IN ({_allowed(DECK_SECTIONS)})", name="ck_deck_cards_section"),
        sa.CheckConstraint("quantity BETWEEN 1 AND 9999", name="ck_deck_cards_quantity"),
        sa.CheckConstraint("revision >= 1", name="ck_deck_cards_revision"),
    )
    _create_indexes("deck_cards", "deck_id", "printing_id")
    op.create_index("ix_deck_cards_deck_section", "deck_cards", ["deck_id", "section"])
    op.create_index("ix_deck_cards_printing", "deck_cards", ["printing_id"])


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("LOCK TABLE collection_items, decks, deck_cards IN ACCESS EXCLUSIVE MODE")
    row_count = bind.scalar(
        sa.text(
            "SELECT (SELECT count(*) FROM collection_items) + "
            "(SELECT count(*) FROM decks) + "
            "(SELECT count(*) FROM deck_cards)"
        )
    )
    if row_count:
        raise RuntimeError("Cannot downgrade collections and decks while Phase 4 data exists.")
    op.drop_table("deck_cards")
    op.drop_table("collection_items")
    op.drop_table("decks")


def _create_indexes(table_name: str, *columns: str) -> None:
    for column in columns:
        op.create_index(f"ix_{table_name}_{column}", table_name, [column])
