"""Add canonical game identity to catalog records and decks."""

import sqlalchemy as sa
from alembic import op

revision = "0010_multi_game_catalog"
down_revision = "0009_privileged_mfa"
branch_labels = None
depends_on = None

GAME_DEFAULT = sa.text("'mtg'")
GAME_CHECK = "game IN ('mtg', 'pokemon', 'yugioh')"
FORMAT_CHECK = (
    "format IN ('standard', 'future', 'historic', 'timeless', 'gladiator', 'pioneer', "
    "'explorer', 'modern', 'legacy', 'pauper', 'vintage', 'penny', 'commander', "
    "'oathbreaker', 'standardbrawl', 'brawl', 'alchemy', 'paupercommander', 'duel', "
    "'oldschool', 'premodern', 'predh', 'expanded', 'unlimited', 'advanced', 'traditional')"
)
LEGACY_FORMAT_CHECK = (
    "format IN ('standard', 'future', 'historic', 'timeless', 'gladiator', 'pioneer', "
    "'explorer', 'modern', 'legacy', 'pauper', 'vintage', 'penny', 'commander', "
    "'oathbreaker', 'standardbrawl', 'brawl', 'alchemy', 'paupercommander', 'duel', "
    "'oldschool', 'premodern', 'predh')"
)


def upgrade() -> None:
    bind = op.get_bind()
    # Production has not run this revision yet, so catalog imports can be
    # migrated with the same canonical Magic default as catalog records.
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("catalog_imports") as batch:
            batch.add_column(
                sa.Column("game", sa.String(length=16), nullable=False, server_default=GAME_DEFAULT)
            )
            batch.create_check_constraint("ck_catalog_imports_game", GAME_CHECK)
            batch.drop_index("ix_catalog_imports_active")
            batch.drop_index("uq_catalog_imports_one_active")
            batch.create_index("ix_catalog_imports_game_active", ["game", "active"])
            batch.create_index(
                "uq_catalog_imports_one_active_per_game",
                ["game", "active"],
                unique=True,
                sqlite_where=sa.text("active = 1"),
            )
    else:
        op.add_column(
            "catalog_imports",
            sa.Column("game", sa.String(length=16), nullable=False, server_default=GAME_DEFAULT),
        )
        op.create_check_constraint("ck_catalog_imports_game", "catalog_imports", GAME_CHECK)
        op.drop_index("ix_catalog_imports_active", table_name="catalog_imports")
        op.drop_index("uq_catalog_imports_one_active", table_name="catalog_imports")
        op.create_index("ix_catalog_imports_game_active", "catalog_imports", ["game", "active"])
        op.create_index(
            "uq_catalog_imports_one_active_per_game",
            "catalog_imports",
            ["game", "active"],
            unique=True,
            postgresql_where=sa.text("active"),
        )
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table(
            "card_sets", naming_convention={"uq": "uq_%(table_name)s_%(column_0_name)s"}
        ) as batch:
            batch.add_column(
                sa.Column("game", sa.String(length=16), nullable=False, server_default=GAME_DEFAULT)
            )
            batch.drop_constraint("uq_card_sets_code_normalized", type_="unique")
            batch.create_unique_constraint(
                "uq_card_sets_game_code_normalized", ["game", "code_normalized"]
            )
    else:
        op.add_column(
            "card_sets",
            sa.Column("game", sa.String(length=16), nullable=False, server_default=GAME_DEFAULT),
        )
        op.drop_constraint("card_sets_code_normalized_key", "card_sets", type_="unique")
        op.create_unique_constraint(
            "uq_card_sets_game_code_normalized", "card_sets", ["game", "code_normalized"]
        )
    op.create_index("ix_card_sets_game_active", "card_sets", ["game", "active"])

    for table_name in ("oracle_cards", "card_printings"):
        op.add_column(
            table_name,
            sa.Column("game", sa.String(length=16), nullable=False, server_default=GAME_DEFAULT),
        )
        op.create_index(f"ix_{table_name}_game", table_name, ["game"])

    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("decks") as batch:
            batch.add_column(
                sa.Column("game", sa.String(length=16), nullable=False, server_default=GAME_DEFAULT)
            )
            batch.drop_constraint("ck_decks_format", type_="check")
            batch.create_check_constraint("ck_decks_format", FORMAT_CHECK)
            batch.create_check_constraint("ck_decks_game", GAME_CHECK)
    else:
        op.add_column(
            "decks",
            sa.Column("game", sa.String(length=16), nullable=False, server_default=GAME_DEFAULT),
        )
        op.drop_constraint("ck_decks_format", "decks", type_="check")
        op.create_check_constraint("ck_decks_format", "decks", FORMAT_CHECK)
        op.create_check_constraint("ck_decks_game", "decks", GAME_CHECK)


def downgrade() -> None:
    bind = op.get_bind()
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("decks") as batch:
            batch.drop_constraint("ck_decks_game", type_="check")
            batch.drop_constraint("ck_decks_format", type_="check")
            batch.create_check_constraint("ck_decks_format", LEGACY_FORMAT_CHECK)
            batch.drop_column("game")
    else:
        op.drop_constraint("ck_decks_game", "decks", type_="check")
        op.drop_constraint("ck_decks_format", "decks", type_="check")
        op.create_check_constraint("ck_decks_format", "decks", LEGACY_FORMAT_CHECK)
        op.drop_column("decks", "game")

    for table_name in ("card_printings", "oracle_cards"):
        op.drop_index(f"ix_{table_name}_game", table_name=table_name)
        op.drop_column(table_name, "game")

    op.drop_index("ix_card_sets_game_active", table_name="card_sets")
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("card_sets") as batch:
            batch.drop_constraint("uq_card_sets_game_code_normalized", type_="unique")
            batch.drop_column("game")
            batch.create_unique_constraint("uq_card_sets_code_normalized", ["code_normalized"])
    else:
        op.drop_constraint("uq_card_sets_game_code_normalized", "card_sets", type_="unique")
        op.drop_column("card_sets", "game")
        op.create_unique_constraint(
            "card_sets_code_normalized_key", "card_sets", ["code_normalized"]
        )

    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("catalog_imports") as batch:
            batch.drop_index("uq_catalog_imports_one_active_per_game")
            batch.drop_index("ix_catalog_imports_game_active")
            batch.drop_constraint("ck_catalog_imports_game", type_="check")
            batch.drop_column("game")
            batch.create_index("ix_catalog_imports_active", ["active"])
            batch.create_index(
                "uq_catalog_imports_one_active",
                ["active"],
                unique=True,
                sqlite_where=sa.text("active = 1"),
            )
    else:
        op.drop_index("uq_catalog_imports_one_active_per_game", table_name="catalog_imports")
        op.drop_index("ix_catalog_imports_game_active", table_name="catalog_imports")
        op.drop_constraint("ck_catalog_imports_game", "catalog_imports", type_="check")
        op.drop_column("catalog_imports", "game")
        op.create_index("ix_catalog_imports_active", "catalog_imports", ["active"])
        op.create_index(
            "uq_catalog_imports_one_active",
            "catalog_imports",
            ["active"],
            unique=True,
            postgresql_where=sa.text("active"),
        )
