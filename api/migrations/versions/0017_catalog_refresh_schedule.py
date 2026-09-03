"""Add the server-wide catalog refresh schedule."""

import sqlalchemy as sa
from alembic import op

revision = "0017_catalog_refresh_schedule"
down_revision = "0016_trusted_mfa_browser"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "catalog_refresh_schedules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("cadence", sa.String(16), nullable=False, server_default="weekly"),
        sa.Column("interval_hours", sa.Integer(), nullable=False, server_default="24"),
        sa.Column("weekday", sa.Integer(), nullable=False, server_default="6"),
        sa.Column("time_of_day", sa.Time(), nullable=False, server_default="03:00"),
        sa.Column("timezone", sa.String(64), nullable=False, server_default="UTC"),
        sa.Column("game", sa.String(24), nullable=False, server_default="all"),
        sa.Column("next_run_at", sa.DateTime(timezone=True)),
        sa.Column("last_started_at", sa.DateTime(timezone=True)),
        sa.Column("last_finished_at", sa.DateTime(timezone=True)),
        sa.Column("last_status", sa.String(24)),
        sa.Column("last_error_summary", sa.String(240)),
        sa.Column("updated_by_user_id", sa.Uuid()),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("id = 1", name="ck_catalog_refresh_schedule_singleton"),
        sa.CheckConstraint(
            "cadence IN ('hours', 'daily', 'weekly')", name="ck_catalog_refresh_schedule_cadence"
        ),
        sa.CheckConstraint(
            "interval_hours BETWEEN 1 AND 168", name="ck_catalog_refresh_schedule_hours"
        ),
        sa.CheckConstraint("weekday BETWEEN 0 AND 6", name="ck_catalog_refresh_schedule_weekday"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index(
        "ix_catalog_refresh_schedules_next_run_at", "catalog_refresh_schedules", ["next_run_at"]
    )


def downgrade() -> None:
    op.drop_table("catalog_refresh_schedules")
