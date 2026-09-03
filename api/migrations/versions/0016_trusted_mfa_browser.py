"""Add privileged MFA onboarding and five-hour trusted browsers."""

import sqlalchemy as sa
from alembic import op

revision = "0016_trusted_mfa_browser"
down_revision = "0015_open_signup_role_authority"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("must_setup_mfa", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute(
        sa.text(
            "UPDATE users SET must_setup_mfa = true "
            # 0015 can add SUPER_ADMIN in this same migration transaction.
            # Compare text so PostgreSQL need not use the uncommitted enum value.
            "WHERE CAST(role AS TEXT) IN ('OWNER', 'SUPER_ADMIN', 'ADMIN') "
            "AND NOT EXISTS (SELECT 1 FROM mfa_credentials "
            "WHERE mfa_credentials.user_id = users.id "
            "AND mfa_credentials.enabled_at IS NOT NULL)"
        )
    )
    op.create_table(
        "mfa_trusted_browsers",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("user_agent", sa.String(256), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("ix_mfa_trusted_browsers_user_id", "mfa_trusted_browsers", ["user_id"])
    op.create_index("ix_mfa_trusted_browsers_token_hash", "mfa_trusted_browsers", ["token_hash"])
    op.create_index("ix_mfa_trusted_browsers_expires_at", "mfa_trusted_browsers", ["expires_at"])


def downgrade() -> None:
    op.drop_table("mfa_trusted_browsers")
    op.drop_column("users", "must_setup_mfa")
