"""Add administrator accounts and forced password replacement."""

import sqlalchemy as sa
from alembic import op

revision = "0003_admin_controls"
down_revision = "0002_catalog"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TYPE role ADD VALUE IF NOT EXISTS 'ADMIN'")
    op.add_column(
        "users",
        sa.Column(
            "must_change_password",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("LOCK TABLE users IN ACCESS EXCLUSIVE MODE")
    blocking_users = bind.scalar(
        sa.text("SELECT COUNT(*) FROM users WHERE role = 'ADMIN' OR must_change_password = TRUE")
    )
    if blocking_users:
        raise RuntimeError(
            "Cannot downgrade admin controls while administrator accounts or "
            "forced-password users exist."
        )
    op.drop_column("users", "must_change_password")
