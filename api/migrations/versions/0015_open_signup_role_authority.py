"""Add super administrator role authority and invitation target roles."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0015_open_signup_role_authority"
down_revision = "0014_more_tcgjson_games"
branch_labels = None
depends_on = None

role_enum = postgresql.ENUM(name="role", create_type=False)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE role ADD VALUE IF NOT EXISTS 'SUPER_ADMIN'")
    op.add_column(
        "account_invitations",
        sa.Column(
            "target_role",
            role_enum,
            nullable=True,
            server_default="MEMBER",
        ),
    )
    op.execute(sa.text("UPDATE account_invitations SET target_role = 'MEMBER'"))
    op.alter_column("account_invitations", "target_role", nullable=False)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("LOCK TABLE users IN ACCESS EXCLUSIVE MODE")
        op.execute("LOCK TABLE account_invitations IN ACCESS EXCLUSIVE MODE")
    blocking_records = bind.scalar(
        sa.text(
            "SELECT (SELECT COUNT(*) FROM users WHERE role = 'SUPER_ADMIN') + "
            "(SELECT COUNT(*) FROM account_invitations WHERE target_role != 'MEMBER')"
        )
    )
    if blocking_records:
        raise RuntimeError(
            "Cannot downgrade role authority while super administrator accounts or "
            "non-member invitations exist."
        )
    op.drop_column("account_invitations", "target_role")
