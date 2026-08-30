"""Allow One Piece cards and decks."""

from alembic import op

revision = "0013_one_piece_catalog"
down_revision = "0012_site_branding"
branch_labels = None
depends_on = None

OLD_GAME_CHECK = "game IN ('mtg', 'pokemon', 'yugioh')"
NEW_GAME_CHECK = "game IN ('mtg', 'pokemon', 'yugioh', 'onepiece')"


def _replace(table: str, expression: str) -> None:
    name = "ck_catalog_imports_game" if table == "catalog_imports" else "ck_decks_game"
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table(table) as batch:
            batch.drop_constraint(name, type_="check")
            batch.create_check_constraint(name, expression)
    else:
        op.drop_constraint(name, table, type_="check")
        op.create_check_constraint(name, table, expression)


def upgrade() -> None:
    _replace("catalog_imports", NEW_GAME_CHECK)
    _replace("decks", NEW_GAME_CHECK)


def downgrade() -> None:
    _replace("decks", OLD_GAME_CHECK)
    _replace("catalog_imports", OLD_GAME_CHECK)
