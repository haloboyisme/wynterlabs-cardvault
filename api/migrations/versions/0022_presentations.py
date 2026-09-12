"""Account-owned streamer settings and revocable pack presentation."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0022_presentations"
down_revision = "0021_custom_cards"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "presentations",
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("document", sa.JSON().with_variant(JSONB, "postgresql"), nullable=False),
        sa.Column("token_hash", sa.String(64), unique=True),
        sa.Column("token_expires", sa.DateTime(timezone=True)),
    )


def downgrade():
    op.drop_table("presentations")
