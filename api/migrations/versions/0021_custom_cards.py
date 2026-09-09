"""Private user-created cards, using existing collection and deck relations."""

import sqlalchemy as sa
from alembic import op

revision = "0021_custom_cards"
down_revision = "0020_google_signin"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint("ck_decks_game", "decks", type_="check")
    op.create_check_constraint(
        "ck_decks_game",
        "decks",
        "game IN ('mtg', 'pokemon', 'yugioh', 'onepiece', 'digimon', "
        "'starwars', 'unionarena', 'lorcana', 'riftbound', 'custom')",
    )
    for table in ("card_sets", "oracle_cards", "card_printings"):
        op.add_column(table, sa.Column("custom_owner_id", sa.Uuid(), nullable=True))
        op.create_foreign_key(
            f"fk_{table}_custom_owner",
            table,
            "users",
            ["custom_owner_id"],
            ["id"],
            ondelete="RESTRICT",
        )
        op.create_index(f"ix_{table}_custom_owner_id", table, ["custom_owner_id"])


def downgrade():
    raise RuntimeError("Custom cards cannot be downgraded safely; restore a pre-upgrade backup.")
