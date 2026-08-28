"""Add privileged-account MFA records."""

import sqlalchemy as sa
from alembic import op

revision = "0009_privileged_mfa"
down_revision = "0008_collection_manual_prices"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mfa_credentials",
        sa.Column("user_id", sa.Uuid(), primary_key=True),
        sa.Column("encrypted_totp_secret", sa.Text(), nullable=False),
        sa.Column("enabled_at", sa.DateTime(timezone=True)),
        sa.Column("pending_expires_at", sa.DateTime(timezone=True)),
        sa.Column("last_totp_counter", sa.BigInteger()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.CheckConstraint(
            "(enabled_at IS NULL AND pending_expires_at IS NOT NULL) OR "
            "(enabled_at IS NOT NULL AND pending_expires_at IS NULL)",
            name="ck_mfa_credentials_pending_state",
        ),
    )
    op.create_table(
        "mfa_login_challenges",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True)),
        sa.Column("failed_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("client_ip", sa.String(64), nullable=False),
        sa.Column("user_agent", sa.String(256), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("token_hash"),
        sa.CheckConstraint("failed_attempts BETWEEN 0 AND 10", name="ck_mfa_challenges_attempts"),
    )
    op.create_index("ix_mfa_login_challenges_user_id", "mfa_login_challenges", ["user_id"])
    op.create_index("ix_mfa_login_challenges_token_hash", "mfa_login_challenges", ["token_hash"])
    op.create_index("ix_mfa_login_challenges_expires_at", "mfa_login_challenges", ["expires_at"])
    op.create_table(
        "mfa_recovery_codes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("generation", sa.Integer(), nullable=False),
        sa.Column("code_hash", sa.String(512), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.CheckConstraint("generation > 0", name="ck_mfa_recovery_codes_generation"),
    )
    op.create_index("ix_mfa_recovery_codes_user_id", "mfa_recovery_codes", ["user_id"])
    op.create_index(
        "ix_mfa_recovery_codes_user_generation",
        "mfa_recovery_codes",
        ["user_id", "generation"],
    )
    op.create_table(
        "security_audit_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("subject_user_id", sa.Uuid()),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("actor_type", sa.String(16), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["subject_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.CheckConstraint(
            "actor_type IN ('self', 'console')",
            name="ck_security_audit_actor_type",
        ),
        sa.CheckConstraint(
            "event_type IN ('mfa_enrolled', 'mfa_recovery_codes_regenerated', "
            "'mfa_recovery_code_redeemed', 'owner_mfa_break_glass')",
            name="ck_security_audit_event_type",
        ),
    )
    op.create_index(
        "ix_security_audit_events_subject_user_id",
        "security_audit_events",
        ["subject_user_id"],
    )
    op.create_index(
        "ix_security_audit_events_type_created",
        "security_audit_events",
        ["event_type", "created_at"],
    )


def downgrade() -> None:
    op.drop_table("security_audit_events")
    op.drop_table("mfa_recovery_codes")
    op.drop_table("mfa_login_challenges")
    op.drop_table("mfa_credentials")
