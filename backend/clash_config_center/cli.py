import argparse
import asyncio
from pathlib import Path

import uvicorn

from .config import Settings
from .db import Database


async def database_command(settings: Settings, reset: bool) -> None:
    db = Database(settings.database_path)
    try:
        token = await db.initialize()
        if reset:
            token = await db.reset_admin_token()
        if token:
            print(f"管理 Token（仅显示一次，请妥善保存）: {token}", flush=True)
        else:
            print("数据库已初始化，管理 Token 保持不变。")
    finally:
        await db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="ClashConfigCenter 后端")
    parser.add_argument("--data-dir", type=Path, help="数据目录；覆盖 CCC_DATA_DIR")
    commands = parser.add_subparsers(dest="command", required=True)
    serve = commands.add_parser("serve", help="启动 HTTP 服务（单 worker）")
    serve.add_argument("--host")
    serve.add_argument("--port", type=int)
    commands.add_parser("init", help="升级数据库并在首次初始化时生成管理 Token")
    admin = commands.add_parser("admin-token", help="管理 Token 操作")
    admin.add_argument("action", choices=["reset"])
    args = parser.parse_args()
    overrides = {"data_dir": args.data_dir} if args.data_dir else {}
    settings = Settings(**overrides)
    if args.command == "serve":
        from .app import create_app

        uvicorn.run(
            create_app(settings),
            host=args.host or settings.host,
            port=args.port or settings.port,
            workers=1,
            access_log=False,
        )
    else:
        asyncio.run(database_command(settings, args.command == "admin-token"))


if __name__ == "__main__":
    main()
