"""Shared site design controls."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0023_brand_design"
down_revision = "0022_presentations"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "site_branding",
        sa.Column("design", sa.JSON().with_variant(JSONB, "postgresql"), nullable=True),
    )


def downgrade():
    op.drop_column("site_branding", "design")
