"""Add private account invitations."""

import sqlalchemy as sa
from alembic import op

revision = "0006_account_invitations"
down_revision = "0005_collection_imports"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "account_invitations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("used_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["users.id"],
            name="fk_account_invitations_creator",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["used_by_user_id"],
            ["users.id"],
            name="fk_account_invitations_used_by",
            ondelete="SET NULL",
        ),
        sa.CheckConstraint(
            "length(token_hash) = 64",
            name="ck_account_invitations_token_hash",
        ),
        sa.CheckConstraint("revision >= 1", name="ck_account_invitations_revision"),
        sa.CheckConstraint(
            "expires_at > created_at",
            name="ck_account_invitations_expiry",
        ),
        sa.CheckConstraint(
            "NOT (revoked_at IS NOT NULL AND used_at IS NOT NULL)",
            name="ck_account_invitations_terminal_state",
        ),
    )
    op.create_index(
        "ix_account_invitations_token_hash",
        "account_invitations",
        ["token_hash"],
        unique=True,
    )
    op.create_index(
        "ix_account_invitations_created_by_user_id",
        "account_invitations",
        ["created_by_user_id"],
    )
    op.create_index(
        "ix_account_invitations_creator_created",
        "account_invitations",
        ["created_by_user_id", "created_at"],
    )
    op.create_index(
        "ix_account_invitations_expires_at",
        "account_invitations",
        ["expires_at"],
    )
    op.create_index(
        "ix_account_invitations_expires_used_revoked",
        "account_invitations",
        ["expires_at", "used_at", "revoked_at"],
    )
    op.create_index(
        "ix_account_invitations_used_by_user_id",
        "account_invitations",
        ["used_by_user_id"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("LOCK TABLE account_invitations IN ACCESS EXCLUSIVE MODE")
    row_count = bind.scalar(sa.text("SELECT count(*) FROM account_invitations"))
    if row_count:
        raise RuntimeError("Cannot downgrade account invitations while invitations exist.")
    op.drop_table("account_invitations")
