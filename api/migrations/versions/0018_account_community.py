"""Add account lifecycle controls and private community sharing."""

import sqlalchemy as sa
from alembic import op

revision = "0018_account_community"
down_revision = "0017_catalog_refresh_schedule"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("share_activity", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "account_deletion_requests",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "requested_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("decided_at", sa.DateTime(timezone=True)),
        sa.Column("decided_by_user_id", sa.Uuid()),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'rejected', 'canceled')",
            name="ck_account_deletion_requests_status",
        ),
        sa.CheckConstraint("revision >= 1", name="ck_account_deletion_requests_revision"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["decided_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index(
        "ix_account_deletion_requests_user_id",
        "account_deletion_requests",
        ["user_id"],
    )
    op.drop_constraint("ck_security_audit_event_type", "security_audit_events", type_="check")
    op.drop_constraint("ck_security_audit_actor_type", "security_audit_events", type_="check")
    op.create_check_constraint(
        "ck_security_audit_event_type", "security_audit_events",
        "event_type IN ('mfa_enrolled', 'mfa_recovery_codes_regenerated', "
        "'mfa_recovery_code_redeemed', 'owner_mfa_break_glass', 'email_changed', "
        "'deletion_requested', 'deletion_canceled', 'deletion_rejected', "
        "'account_deleted', 'mfa_admin_reset', 'activity_sharing_changed')",
    )
    op.create_check_constraint(
        "ck_security_audit_actor_type", "security_audit_events",
        "actor_type IN ('self', 'owner', 'super_admin', 'console')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_security_audit_event_type", "security_audit_events", type_="check")
    op.drop_constraint("ck_security_audit_actor_type", "security_audit_events", type_="check")
    op.create_check_constraint(
        "ck_security_audit_event_type", "security_audit_events",
        "event_type IN ('mfa_enrolled', 'mfa_recovery_codes_regenerated', "
        "'mfa_recovery_code_redeemed', 'owner_mfa_break_glass')",
    )
    op.create_check_constraint(
        "ck_security_audit_actor_type", "security_audit_events",
        "actor_type IN ('self', 'console')",
    )
    op.drop_table("account_deletion_requests")
    op.drop_column("users", "share_activity")
