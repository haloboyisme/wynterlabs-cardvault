"""Add private collection manual price fallbacks."""

import sqlalchemy as sa
from alembic import op

revision = "0008_collection_manual_prices"
down_revision = "0007_private_trading"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "collection_items",
        sa.Column("manual_price_usd", sa.Numeric(8, 2), nullable=True),
    )
    op.create_check_constraint(
        "ck_collection_items_manual_price_usd",
        "collection_items",
        "manual_price_usd IS NULL OR (manual_price_usd >= 0 AND manual_price_usd <= 999999.99)",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_collection_items_manual_price_usd",
        "collection_items",
        type_="check",
    )
    op.drop_column("collection_items", "manual_price_usd")
