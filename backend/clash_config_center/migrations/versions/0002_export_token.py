"""Store the subscription token so the admin UI can copy it again."""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("exports") as batch:
        batch.add_column(sa.Column("token", sa.Text()))


def downgrade():
    with op.batch_alter_table("exports") as batch:
        batch.drop_column("token")
