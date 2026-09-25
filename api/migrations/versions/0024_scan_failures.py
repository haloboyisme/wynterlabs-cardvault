"""Account-scoped failed scan diagnostics, without photos or OCR text."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB
revision = "0024_scan_failures"
down_revision = "0023_brand_design"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("scan_failures",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("scan_id", sa.Uuid(), primary_key=True),
        sa.Column("mode", sa.String(16), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("outcome", sa.String(24), nullable=False),
        *[sa.Column(key, sa.JSON().with_variant(JSONB, "postgresql"), nullable=False) for key in ("reasons", "suspected", "reported")],
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_scan_failures_owner_created", "scan_failures", ["user_id", "created_at"])

def downgrade():
    op.drop_table("scan_failures")
