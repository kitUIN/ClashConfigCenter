"""Initial schema. Keep this migration independent of future ORM changes."""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "system_settings",
        sa.Column("key", sa.String(80), primary_key=True),
        sa.Column("value", sa.Text(), nullable=False),
    )
    op.create_table(
        "sources",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("url", sa.Text()),
        sa.Column("refresh_interval_seconds", sa.Integer(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.Float(), nullable=False),
        sa.Column("last_attempt_at", sa.Float()),
        sa.Column("last_success_at", sa.Float()),
        sa.Column("next_refresh_at", sa.Float()),
        sa.Column("last_error", sa.Text()),
    )
    op.create_table(
        "manual_nodes",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column(
            "source_id",
            sa.String(32),
            sa.ForeignKey("sources.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False),
    )
    op.create_index("ix_manual_nodes_source_id", "manual_nodes", ["source_id"])
    op.create_table(
        "source_snapshots",
        sa.Column(
            "source_id",
            sa.String(32),
            sa.ForeignKey("sources.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("nodes", sa.JSON(), nullable=False),
        sa.Column("document", sa.JSON()),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("version", sa.String(32), nullable=False),
        sa.Column("fetched_at", sa.Float(), nullable=False),
    )
    op.create_table(
        "exports",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("mode", sa.String(20), nullable=False),
        sa.Column("template_yaml", sa.Text()),
        sa.Column(
            "base_source_id", sa.String(32), sa.ForeignKey("sources.id", ondelete="RESTRICT")
        ),
        sa.Column("injection", sa.String(20), nullable=False),
        sa.Column("target_groups", sa.JSON(), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("created_at", sa.Float(), nullable=False),
        sa.Column("last_attempt_at", sa.Float()),
        sa.Column("last_error", sa.Text()),
    )
    op.create_table(
        "export_sources",
        sa.Column(
            "export_id",
            sa.String(32),
            sa.ForeignKey("exports.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "source_id",
            sa.String(32),
            sa.ForeignKey("sources.id", ondelete="RESTRICT"),
            primary_key=True,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
    )
    op.create_table(
        "export_snapshots",
        sa.Column(
            "export_id",
            sa.String(32),
            sa.ForeignKey("exports.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("yaml_content", sa.Text(), nullable=False),
        sa.Column("digest", sa.String(64), nullable=False),
        sa.Column("source_versions", sa.JSON(), nullable=False),
        sa.Column("generated_at", sa.Float(), nullable=False),
    )


def downgrade():
    for name in (
        "export_snapshots",
        "export_sources",
        "exports",
        "source_snapshots",
        "manual_nodes",
        "sources",
        "system_settings",
    ):
        op.drop_table(name)
