import sqlite3
from pathlib import Path

from alembic import command
from alembic.config import Config

from clash_config_center.db import migrate


def test_existing_database_gets_compatible_node_output_defaults(tmp_path):
    path = tmp_path / "existing.sqlite3"
    config = Config()
    config.set_main_option(
        "script_location", str(Path(__file__).parents[1] / "clash_config_center" / "migrations")
    )
    config.set_main_option("sqlalchemy.url", f"sqlite:///{path.as_posix()}")
    command.upgrade(config, "0002")
    with sqlite3.connect(path) as connection:
        connection.execute(
            "INSERT INTO sources (id, name, kind, refresh_interval_seconds, revision, created_at) "
            "VALUES ('s', 'existing', 'manual', 3600, 1, 1)"
        )
        connection.execute(
            "INSERT INTO exports (id, name, enabled, mode, injection, target_groups, token_hash, "
            "token, created_at) VALUES ('e', 'existing', 1, 'template', 'grouped', '[]', 'hash', "
            "'existing-token', 1)"
        )
        connection.execute("INSERT INTO export_sources VALUES ('e', 's', 0)")
        connection.execute("INSERT INTO source_snapshots VALUES ('s', '[]', NULL, 1, 'version', 1)")
        connection.execute(
            "INSERT INTO export_snapshots VALUES ('e', 'existing-yaml', 'digest', '{}', 1)"
        )
    migrate(path)
    migrate(path)  # Startup migrations must be idempotent.
    with sqlite3.connect(path) as connection:
        assert connection.execute("SELECT ignored_node_names FROM sources").fetchone() == ("[]",)
        assert connection.execute("SELECT prefix_source_name, token FROM exports").fetchone() == (
            1,
            "existing-token",
        )
        assert connection.execute("SELECT * FROM export_sources").fetchall() == [("e", "s", 0)]
        assert connection.execute("SELECT yaml_content FROM export_snapshots").fetchone() == (
            "existing-yaml",
        )
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
