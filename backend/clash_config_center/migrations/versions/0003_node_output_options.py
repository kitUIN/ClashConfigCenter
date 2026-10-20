"""Keep source exclusions and optional export node prefixes."""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "sources",
        sa.Column("ignored_node_names", sa.JSON(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "exports",
        sa.Column("prefix_source_name", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade():
    with op.batch_alter_table("exports") as batch:
        batch.drop_column("prefix_source_name")
    with op.batch_alter_table("sources") as batch:
        batch.drop_column("ignored_node_names")
