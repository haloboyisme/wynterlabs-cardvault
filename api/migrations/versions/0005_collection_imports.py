"""Add collection import previews."""

import sqlalchemy as sa
from alembic import op

revision = "0005_collection_imports"
down_revision = "0004_collections_decks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "collection_import_previews",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("source_sha256", sa.String(64), nullable=False),
        sa.Column("rows", sa.JSON(), nullable=False),
        sa.Column("summary", sa.JSON(), nullable=False),
        sa.Column("collection_digest", sa.String(64), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_collection_import_previews_user",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "length(source_sha256) = 64",
            name="ck_collection_import_previews_source_sha256",
        ),
        sa.CheckConstraint(
            "length(collection_digest) = 64",
            name="ck_collection_import_previews_collection_digest",
        ),
        sa.CheckConstraint(
            "revision >= 1",
            name="ck_collection_import_previews_revision",
        ),
        sa.CheckConstraint(
            "expires_at > created_at",
            name="ck_collection_import_previews_expiry",
        ),
    )
    op.create_index(
        "ix_collection_import_previews_user_expires",
        "collection_import_previews",
        ["user_id", "expires_at"],
    )
    op.create_index(
        "uq_collection_import_previews_user_source_open",
        "collection_import_previews",
        ["user_id", "source_sha256"],
        unique=True,
        postgresql_where=sa.text("confirmed_at IS NULL"),
        sqlite_where=sa.text("confirmed_at IS NULL"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("LOCK TABLE collection_import_previews IN ACCESS EXCLUSIVE MODE")
    row_count = bind.scalar(sa.text("SELECT count(*) FROM collection_import_previews"))
    if row_count:
        raise RuntimeError("Cannot downgrade collection imports while previews exist.")
    op.drop_table("collection_import_previews")
