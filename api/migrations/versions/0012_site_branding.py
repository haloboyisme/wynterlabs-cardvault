"""Add the singleton site branding record."""

import sqlalchemy as sa
from alembic import op

revision = "0012_site_branding"
down_revision = "0011_collection_value_history"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "site_branding",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("site_name", sa.String(48), nullable=False),
        sa.Column("product_name", sa.String(48), nullable=False),
        sa.Column("tagline", sa.String(100), nullable=False),
        sa.Column("logo_media_type", sa.String(16), nullable=True),
        sa.Column("logo_bytes", sa.LargeBinary(), nullable=True),
        sa.Column("logo_sha256", sa.String(64), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_site_branding_singleton"),
    )


def downgrade() -> None:
    op.drop_table("site_branding")
