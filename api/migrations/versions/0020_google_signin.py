"""Optional Google sign-in; no credentials or links enabled by default."""

import sqlalchemy as sa
from alembic import op

revision = "0020_google_signin"
down_revision = "0019_account_email"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "google_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("client_id", sa.String(256), nullable=False),
        sa.Column("secret_ciphertext", sa.Text(), nullable=False),
        sa.Column("site_url", sa.String(512), nullable=False),
        sa.Column("revision", sa.String(64), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_google_settings_singleton"),
    )
    op.create_table(
        "google_identities",
        sa.Column("subject", sa.String(255), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "google_flows",
        sa.Column("state_hash", sa.String(64), primary_key=True),
        sa.Column("browser_hash", sa.String(64), nullable=False),
        sa.Column("trust_token_hash", sa.String(64), nullable=True),
        sa.Column("verifier_ciphertext", sa.Text(), nullable=False),
        sa.Column("nonce", sa.String(64), nullable=False),
        sa.Column("revision", sa.String(64), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE")),
        sa.Column("session_id", sa.Uuid(), sa.ForeignKey("sessions.id", ondelete="CASCADE")),
        sa.Column("password_version", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True)),
        sa.Column("client_ip", sa.String(64), nullable=False),
    )
    op.create_index("ix_google_flows_client_ip", "google_flows", ["client_ip"])


def downgrade():
    op.drop_table("google_flows")
    op.drop_table("google_identities")
    op.drop_table("google_settings")
