import asyncio
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import URL, event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from .models import SystemSetting
from .security import new_token, token_digest


def migrate(database_path: Path) -> None:
    database_path.parent.mkdir(parents=True, exist_ok=True)
    config = Config()
    config.set_main_option("script_location", str(Path(__file__).parent / "migrations"))
    url = URL.create("sqlite", database=str(database_path))
    config.set_main_option(
        "sqlalchemy.url", url.render_as_string(hide_password=False).replace("%", "%%")
    )
    command.upgrade(config, "head")


class Database:
    def __init__(self, database_path: Path):
        self.path = database_path
        self.engine = create_async_engine(
            URL.create("sqlite+aiosqlite", database=str(database_path)),
            connect_args={"timeout": 30},
        )

        @event.listens_for(self.engine.sync_engine, "connect")
        def configure_sqlite(connection, _):
            cursor = connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA busy_timeout=30000")
            cursor.close()

        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)

    async def initialize(self) -> str | None:
        await asyncio.to_thread(migrate, self.path)
        async with self.sessions.begin() as session:
            if await session.get(SystemSetting, "admin_token_hash"):
                return None
            token = new_token()
            session.add(SystemSetting(key="admin_token_hash", value=token_digest(token)))
            return token

    async def reset_admin_token(self) -> str:
        token = new_token()
        async with self.sessions.begin() as session:
            setting = await session.get(SystemSetting, "admin_token_hash")
            if setting is None:
                session.add(SystemSetting(key="admin_token_hash", value=token_digest(token)))
            else:
                setting.value = token_digest(token)
        return token

    async def close(self) -> None:
        await self.engine.dispose()
