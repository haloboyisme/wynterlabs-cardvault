"""Store suggested and accepted card/finish snapshots for scan diagnostics."""
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from alembic import op
revision = "0025_scan_diagnostics"
down_revision = "0024_scan_failures"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("scan_failures", sa.Column("diagnostics",sa.JSON().with_variant(JSONB,"postgresql"),nullable=False,server_default=sa.text("'{}'")))

def downgrade():
    op.drop_column("scan_failures","diagnostics")
