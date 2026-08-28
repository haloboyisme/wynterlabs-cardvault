"""Add private wants, trades, and moderation records."""

import sqlalchemy as sa
from alembic import op

revision = "0007_private_trading"
down_revision = "0006_account_invitations"
branch_labels = None
depends_on = None


def _timestamps():
    return (
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def upgrade() -> None:
    op.create_table(
        "trading_accounts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("active_strikes", sa.Integer(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("suspended_at", sa.DateTime(timezone=True)),
        *_timestamps(),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", name="uq_trading_accounts_user"),
        sa.CheckConstraint("status IN ('active','suspended')", name="ck_trading_accounts_status"),
        sa.CheckConstraint("active_strikes BETWEEN 0 AND 3", name="ck_trading_accounts_strikes"),
        sa.CheckConstraint("revision >= 1", name="ck_trading_accounts_revision"),
    )
    op.create_index("ix_trading_accounts_status_user", "trading_accounts", ["status", "user_id"])
    op.create_table(
        "trade_listings",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("collection_item_id", sa.Uuid(), nullable=False),
        sa.Column("oracle_card_id", sa.Uuid(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["collection_item_id"], ["collection_items.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["oracle_card_id"], ["oracle_cards.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("collection_item_id", name="uq_trade_listings_collection_item"),
        sa.CheckConstraint("quantity BETWEEN 1 AND 9999", name="ck_trade_listings_quantity"),
        sa.CheckConstraint("status IN ('active','removed')", name="ck_trade_listings_status"),
        sa.CheckConstraint("revision >= 1", name="ck_trade_listings_revision"),
    )
    op.create_index("ix_trade_listings_user_status", "trade_listings", ["user_id", "status"])
    op.create_index(
        "ix_trade_listings_oracle_status", "trade_listings", ["oracle_card_id", "status"]
    )
    op.create_table(
        "want_listings",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("oracle_card_id", sa.Uuid(), nullable=False),
        sa.Column("printing_id", sa.Uuid()),
        sa.Column("finish", sa.String(16)),
        sa.Column("condition", sa.String(32)),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["oracle_card_id"], ["oracle_cards.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["printing_id"], ["card_printings.id"], ondelete="RESTRICT"),
        sa.CheckConstraint("quantity BETWEEN 1 AND 9999", name="ck_want_listings_quantity"),
        sa.CheckConstraint("status IN ('active','removed')", name="ck_want_listings_status"),
        sa.CheckConstraint("revision >= 1", name="ck_want_listings_revision"),
    )
    op.create_index("ix_want_listings_user_status", "want_listings", ["user_id", "status"])
    op.create_index("ix_want_listings_oracle_status", "want_listings", ["oracle_card_id", "status"])
    op.create_table(
        "trade_reports",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("reporter_user_id", sa.Uuid(), nullable=False),
        sa.Column("reported_user_id", sa.Uuid(), nullable=False),
        sa.Column("trade_listing_id", sa.Uuid()),
        sa.Column("reason", sa.String(32), nullable=False),
        sa.Column("details", sa.Text()),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("incident_reference", sa.String(24), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("moderated_by_user_id", sa.Uuid()),
        sa.Column("moderated_at", sa.DateTime(timezone=True)),
        *_timestamps(),
        sa.ForeignKeyConstraint(["reporter_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reported_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["trade_listing_id"], ["trade_listings.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["moderated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("incident_reference", name="uq_trade_reports_incident"),
        sa.UniqueConstraint(
            "reporter_user_id",
            "trade_listing_id",
            name="uq_trade_reports_reporter_listing",
        ),
        sa.CheckConstraint(
            "reason IN ('scam','spam','misrepresentation','harassment','other')",
            name="ck_trade_reports_reason",
        ),
        sa.CheckConstraint(
            "status IN ('open','upheld','dismissed')", name="ck_trade_reports_status"
        ),
        sa.CheckConstraint("revision >= 1", name="ck_trade_reports_revision"),
    )
    op.create_index("ix_trade_reports_status_created", "trade_reports", ["status", "created_at"])
    op.create_index(
        "ix_trade_reports_reported_status", "trade_reports", ["reported_user_id", "status"]
    )
    op.create_table(
        "trade_strikes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("trading_account_id", sa.Uuid(), nullable=False),
        sa.Column("report_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("issued_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("voided_by_user_id", sa.Uuid()),
        sa.Column("voided_at", sa.DateTime(timezone=True)),
        sa.Column("revision", sa.Integer(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["trading_account_id"], ["trading_accounts.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["report_id"], ["trade_reports.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["issued_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["voided_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("report_id", name="uq_trade_strikes_report"),
        sa.CheckConstraint("status IN ('active','void')", name="ck_trade_strikes_status"),
        sa.CheckConstraint("revision >= 1", name="ck_trade_strikes_revision"),
    )
    op.create_index(
        "ix_trade_strikes_account_status", "trade_strikes", ["trading_account_id", "status"]
    )
    op.create_table(
        "trade_moderation_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("target_user_id", sa.Uuid(), nullable=False),
        sa.Column("actor_user_id", sa.Uuid()),
        sa.Column("event_type", sa.String(32), nullable=False),
        sa.Column("incident_reference", sa.String(24)),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["target_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index(
        "ix_trade_events_target_created",
        "trade_moderation_events",
        ["target_user_id", "created_at"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    tables = (
        "trade_moderation_events",
        "trade_strikes",
        "trade_reports",
        "want_listings",
        "trade_listings",
        "trading_accounts",
    )
    if bind.dialect.name == "postgresql":
        op.execute("LOCK TABLE " + ", ".join(tables) + " IN ACCESS EXCLUSIVE MODE")
    total = sum(bind.scalar(sa.text(f"SELECT count(*) FROM {table}")) or 0 for table in tables)
    if total:
        raise RuntimeError("Cannot downgrade private trading while trading records exist.")
    for table in tables:
        op.drop_table(table)
