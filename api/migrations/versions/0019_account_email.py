"""Optional email delivery and single-use account links."""

import sqlalchemy as sa
from alembic import op

revision = "0019_account_email"
down_revision = "0018_account_community"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "users",
        sa.Column(
            "email_verification_required", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.create_table(
        "email_delivery_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("host", sa.String(253), nullable=False),
        sa.Column("port", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(320), nullable=False),
        sa.Column("from_address", sa.String(320), nullable=False),
        sa.Column("site_url", sa.String(512), nullable=False),
        sa.Column("password_ciphertext", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_email_delivery_singleton"),
    )
    op.create_table(
        "email_action_tokens",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("purpose", sa.String(16), nullable=False),
        sa.Column("target_email", sa.String(320), nullable=False),
        sa.Column("password_version", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("purpose IN ('verify', 'reset')", name="ck_email_action_purpose"),
    )
    op.create_index("ix_email_action_tokens_user_id", "email_action_tokens", ["user_id"])
    op.create_index("ix_email_action_tokens_expires_at", "email_action_tokens", ["expires_at"])


def downgrade():
    op.drop_table("email_action_tokens")
    op.drop_table("email_delivery_settings")
    op.drop_column("users", "email_verification_required")
