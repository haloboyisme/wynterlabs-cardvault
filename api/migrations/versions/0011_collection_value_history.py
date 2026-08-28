"""Track private collection value snapshots."""

import sqlalchemy as sa
from alembic import op

revision = "0011_collection_value_history"
down_revision = "0010_multi_game_catalog"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "collection_value_snapshots",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("minute_bucket", sa.DateTime(timezone=True), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("estimated_value_usd", sa.Numeric(14, 2), nullable=False),
        sa.Column("priced_copies", sa.Integer(), nullable=False),
        sa.Column("unpriced_copies", sa.Integer(), nullable=False),
        sa.Column("total_copies", sa.Integer(), nullable=False),
        sa.Column("oldest_price_snapshot_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("trigger", sa.String(16), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "user_id", "minute_bucket", name="uq_collection_value_snapshots_user_minute"
        ),
        sa.CheckConstraint(
            "estimated_value_usd >= 0 AND estimated_value_usd <= 999999999999.99",
            name="ck_collection_value_snapshots_value",
        ),
        sa.CheckConstraint(
            "priced_copies >= 0 AND unpriced_copies >= 0 AND total_copies >= 0",
            name="ck_collection_value_snapshots_nonnegative_copies",
        ),
        sa.CheckConstraint(
            "priced_copies + unpriced_copies = total_copies",
            name="ck_collection_value_snapshots_copy_coverage",
        ),
        sa.CheckConstraint(
            "trigger IN ('collection', 'price', 'view')",
            name="ck_collection_value_snapshots_trigger",
        ),
    )
    op.create_index(
        "ix_collection_value_snapshots_user_captured",
        "collection_value_snapshots",
        ["user_id", "captured_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_collection_value_snapshots_user_captured",
        table_name="collection_value_snapshots",
    )
    op.drop_table("collection_value_snapshots")
