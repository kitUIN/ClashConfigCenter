import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .compiler import Compiled, SourceContent, compile_export
from .config import Settings
from .db import Database
from .errors import DomainError
from .models import (
    Export,
    ExportSnapshot,
    ExportSource,
    ManualNode,
    Source,
    SourceSnapshot,
    identifier,
)
from .parsing import ParsedSubscription, load_yaml, parse_subscription, parse_uri, validate_node
from .schemas import ExportConfig, ExportCreate, ExportPatch, NodeInput, SourceCreate, SourcePatch
from .security import new_token, token_digest

logger = logging.getLogger(__name__)


def timestamp(value: float | None) -> str | None:
    return datetime.fromtimestamp(value, timezone.utc).isoformat() if value is not None else None


def parse_node_input(body: NodeInput) -> dict[str, Any]:
    if body.config is not None:
        return validate_node(body.config)
    if body.uri is not None:
        return parse_uri(body.uri)
    return validate_node(load_yaml(body.yaml or ""))


class Service:
    def __init__(self, database: Database, settings: Settings, client: httpx.AsyncClient):
        self.db = database
        self.settings = settings
        self.client = client
        self.mutation_lock = asyncio.Lock()
        self.refresh_locks: dict[str, asyncio.Lock] = {}
        self.fetch_slots = asyncio.Semaphore(4)

    async def require_source(self, session: AsyncSession, source_id: str) -> Source:
        source = await session.get(Source, source_id)
        if source is None:
            raise DomainError("来源不存在", 404)
        return source

    async def require_export(self, session: AsyncSession, export_id: str) -> Export:
        export = await session.get(Export, export_id)
        if export is None:
            raise DomainError("出口不存在", 404)
        return export

    async def source_view(self, session: AsyncSession, source: Source) -> dict:
        snapshot = await session.get(SourceSnapshot, source.id)
        ignored = set(source.ignored_node_names)
        stale = bool(snapshot and (source.last_error or snapshot.revision != source.revision))
        return {
            "id": source.id,
            "name": source.name,
            "kind": source.kind,
            "url": source.url,
            "refresh_interval_seconds": source.refresh_interval_seconds,
            "ignored_node_names": source.ignored_node_names,
            "created_at": timestamp(source.created_at),
            "last_attempt_at": timestamp(source.last_attempt_at),
            "last_success_at": timestamp(source.last_success_at),
            "next_refresh_at": timestamp(source.next_refresh_at),
            "last_error": source.last_error,
            "using_stale_snapshot": stale,
            "status": "error" if source.last_error else ("ready" if snapshot else "pending"),
            "node_count": len(snapshot.nodes) if snapshot else 0,
            "ignored_node_count": (
                sum(node["name"] in ignored for node in snapshot.nodes) if snapshot else 0
            ),
            "has_snapshot": snapshot is not None,
        }

    async def list_sources(self) -> list[dict]:
        async with self.db.sessions() as session:
            sources = (
                await session.scalars(select(Source).order_by(Source.created_at, Source.id))
            ).all()
            return [await self.source_view(session, source) for source in sources]

    async def get_source(self, source_id: str) -> dict:
        async with self.db.sessions() as session:
            return await self.source_view(session, await self.require_source(session, source_id))

    async def create_source(self, body: SourceCreate) -> dict:
        async with self.mutation_lock, self.db.sessions.begin() as session:
            source = Source(
                **body.model_dump(), next_refresh_at=time.time() if body.kind == "url" else None
            )
            session.add(source)
            await session.flush()
            if source.kind == "manual":
                await self.save_source_snapshot(session, source, ParsedSubscription([]))
            return await self.source_view(session, source)

    async def patch_source(self, source_id: str, body: SourcePatch) -> dict:
        async with self.mutation_lock, self.db.sessions.begin() as session:
            source = await self.require_source(session, source_id)
            values = {key: getattr(source, key) for key in SourceCreate.model_fields}
            values.update(body.model_dump(exclude_unset=True))
            validated = SourceCreate.model_validate(values)
            url_changed = source.url != validated.url
            for key, value in validated.model_dump().items():
                setattr(source, key, value)
            if url_changed:
                source.revision += 1
                source.last_error = "来源 URL 已变更，等待成功刷新；仍保留最近成功快照"
                source.next_refresh_at = time.time()
            elif source.kind == "url":
                source.next_refresh_at = (
                    source.last_attempt_at or time.time()
                ) + source.refresh_interval_seconds
            await session.flush()
            await self.rebuild_affected(session, source.id)
            return await self.source_view(session, source)

    async def delete_source(self, source_id: str) -> None:
        async with self.mutation_lock, self.db.sessions.begin() as session:
            source = await self.require_source(session, source_id)
            bound = await session.scalar(
                select(ExportSource.export_id).where(ExportSource.source_id == source.id).limit(1)
            )
            if bound is not None:
                raise DomainError("来源正被出口引用，请先解除引用", 409)
            await session.delete(source)

    async def source_nodes(self, source_id: str) -> list[dict]:
        async with self.db.sessions() as session:
            source = await self.require_source(session, source_id)
            if source.kind == "manual":
                nodes = (
                    await session.scalars(
                        select(ManualNode)
                        .where(ManualNode.source_id == source_id)
                        .order_by(ManualNode.position, ManualNode.id)
                    )
                ).all()
                return [
                    {"id": node.id, "position": node.position, "config": node.config}
                    for node in nodes
                ]
            snapshot = await session.get(SourceSnapshot, source_id)
            return [
                {"id": None, "position": index, "config": node}
                for index, node in enumerate(snapshot.nodes if snapshot else [])
            ]

    async def source_groups(self, source_id: str) -> list[str]:
        """来源快照中的策略组名称（仅 URL 来源的完整配置才有）。"""
        async with self.db.sessions() as session:
            await self.require_source(session, source_id)
            snapshot = await session.get(SourceSnapshot, source_id)
            groups = (snapshot.document or {}).get("proxy-groups") if snapshot else None
            if not isinstance(groups, list):
                return []
            names = [g.get("name") for g in groups if isinstance(g, dict)]
            return list(dict.fromkeys(n for n in names if isinstance(n, str) and n))

    async def edit_nodes(
        self,
        source_id: str,
        operation: str,
        configs: list[dict] | None = None,
        node_id: str | None = None,
        order: list[str] | None = None,
    ) -> list[dict]:
        async with self.mutation_lock, self.db.sessions.begin() as session:
            source = await self.require_source(session, source_id)
            if source.kind != "manual":
                raise DomainError("URL 来源节点不能直接编辑", 409)
            nodes = list(
                (
                    await session.scalars(
                        select(ManualNode)
                        .where(ManualNode.source_id == source_id)
                        .order_by(ManualNode.position, ManualNode.id)
                    )
                ).all()
            )
            by_id = {node.id: node for node in nodes}
            if operation == "add":
                for config in configs or []:
                    node = ManualNode(source_id=source_id, position=len(nodes), config=config)
                    nodes.append(node)
                    session.add(node)
            elif operation in ("update", "delete"):
                if node_id not in by_id:
                    raise DomainError("节点不存在", 404)
                node = by_id[node_id]
                if operation == "update":
                    node.config = (configs or [])[0]
                else:
                    nodes.remove(node)
                    await session.delete(node)
            elif operation == "order":
                if order is None or len(order) != len(nodes) or set(order) != set(by_id):
                    raise DomainError("排序必须包含当前全部节点且不能重复")
                nodes = [by_id[node_id] for node_id in order]
            else:
                raise ValueError("Unknown internal node operation")
            for position, node in enumerate(nodes):
                node.position = position
            source.revision += 1
            await self.save_source_snapshot(
                session, source, ParsedSubscription([node.config for node in nodes])
            )
            await session.flush()
            await self.rebuild_affected(session, source.id)
            return [
                {"id": node.id, "position": node.position, "config": node.config} for node in nodes
            ]

    async def save_source_snapshot(
        self, session: AsyncSession, source: Source, parsed: ParsedSubscription
    ) -> None:
        now = time.time()
        snapshot = await session.get(SourceSnapshot, source.id)
        if snapshot is None:
            snapshot = SourceSnapshot(source_id=source.id)
            session.add(snapshot)
        snapshot.nodes = parsed.nodes
        snapshot.document = parsed.document
        snapshot.revision = source.revision
        snapshot.version = identifier()
        snapshot.fetched_at = now
        source.last_success_at = now
        source.last_error = None
        await session.flush()

    async def fetch_subscription(self, url: str) -> ParsedSubscription:
        try:
            async with (
                self.fetch_slots,
                self.client.stream(
                    "GET",
                    url,
                    headers={"User-Agent": "ClashConfigCenter/0.1 (mihomo)"},
                    timeout=self.settings.fetch_timeout_seconds,
                ) as response,
            ):
                response.raise_for_status()
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > self.settings.fetch_max_bytes:
                        raise DomainError("上游响应超过大小限制")
            return await asyncio.to_thread(parse_subscription, data.decode("utf-8-sig"))
        except httpx.HTTPStatusError as exc:
            raise DomainError(f"上游返回 HTTP {exc.response.status_code}") from exc
        except (httpx.HTTPError, httpx.InvalidURL) as exc:
            raise DomainError(f"上游请求失败（{type(exc).__name__}）") from exc
        except UnicodeDecodeError as exc:
            raise DomainError("上游响应不是有效的 UTF-8 文本") from exc

    async def refresh_source(self, source_id: str) -> dict:
        lock = self.refresh_locks.setdefault(source_id, asyncio.Lock())
        async with lock:
            async with self.db.sessions() as session:
                source = await self.require_source(session, source_id)
                if source.kind != "url":
                    raise DomainError("自定义来源不需要远程刷新", 409)
                revision, url = source.revision, source.url
            error, parsed = None, None
            try:
                parsed = await self.fetch_subscription(url or "")
            except DomainError as exc:
                error = exc.message
            async with self.mutation_lock, self.db.sessions.begin() as session:
                source = await self.require_source(session, source_id)
                if source.revision != revision or source.url != url:
                    # A slow response from an old URL must never replace the new source.
                    return await self.source_view(session, source)
                source.last_attempt_at = time.time()
                source.next_refresh_at = source.last_attempt_at + source.refresh_interval_seconds
                if error is not None:
                    source.last_error = error
                else:
                    assert parsed is not None
                    await self.save_source_snapshot(session, source, parsed)
                    await self.rebuild_affected(session, source.id)
                return await self.source_view(session, source)

    async def export_config(self, session: AsyncSession, export: Export) -> ExportConfig:
        source_ids = list(
            (
                await session.scalars(
                    select(ExportSource.source_id)
                    .where(ExportSource.export_id == export.id)
                    .order_by(ExportSource.position)
                )
            ).all()
        )
        values = {
            key: getattr(export, key) for key in ExportConfig.model_fields if key != "source_ids"
        }
        return ExportConfig(**values, source_ids=source_ids)

    async def compile(self, session: AsyncSession, config: ExportConfig) -> Compiled:
        sources = []
        for source_id in config.source_ids:
            source = await self.require_source(session, source_id)
            snapshot = await session.get(SourceSnapshot, source_id)
            if snapshot is None:
                raise DomainError("所选来源尚无成功快照，请先刷新或添加节点")
            sources.append(
                SourceContent(
                    source.id,
                    source.name,
                    source.kind,
                    snapshot.nodes,
                    snapshot.document,
                    snapshot.version,
                    ignored_node_names=source.ignored_node_names,
                )
            )
        return await asyncio.to_thread(compile_export, config, sources)

    async def publish(self, session: AsyncSession, export: Export, compiled: Compiled) -> None:
        snapshot = await session.get(ExportSnapshot, export.id)
        if snapshot is None:
            snapshot = ExportSnapshot(export_id=export.id)
            session.add(snapshot)
        snapshot.yaml_content = compiled.yaml_content
        snapshot.digest = compiled.digest
        snapshot.source_versions = compiled.source_versions
        snapshot.generated_at = time.time()
        export.last_attempt_at = snapshot.generated_at
        export.last_error = None
        await session.flush()

    async def rebuild_one(self, session: AsyncSession, export: Export) -> None:
        export.last_attempt_at = time.time()
        try:
            compiled = await self.compile(session, await self.export_config(session, export))
        except DomainError as exc:
            export.last_error = exc.message
        else:
            await self.publish(session, export, compiled)

    async def rebuild_affected(self, session: AsyncSession, source_id: str) -> None:
        exports = (
            await session.scalars(
                select(Export).join(ExportSource).where(ExportSource.source_id == source_id)
            )
        ).all()
        for export in exports:
            await self.rebuild_one(session, export)

    async def export_view(self, session: AsyncSession, export: Export) -> dict:
        config = await self.export_config(session, export)
        snapshot = await session.get(ExportSnapshot, export.id)
        stale = bool(snapshot and export.last_error)
        source_errors = []
        for source_id in config.source_ids:
            source = await self.require_source(session, source_id)
            current = await session.get(SourceSnapshot, source_id)
            if source.last_error:
                source_errors.append({"source_id": source_id, "message": source.last_error})
            if snapshot and (
                source.last_error
                or current is None
                or snapshot.source_versions.get(source_id) != current.version
            ):
                stale = True
        return {
            "id": export.id,
            **config.model_dump(),
            "created_at": timestamp(export.created_at),
            "last_attempt_at": timestamp(export.last_attempt_at),
            "last_success_at": timestamp(snapshot.generated_at) if snapshot else None,
            "last_error": export.last_error,
            "source_errors": source_errors,
            "using_stale_snapshot": stale,
            "has_snapshot": snapshot is not None,
            "status": "disabled"
            if not export.enabled
            else (
                "error"
                if export.last_error
                else ("stale" if stale else ("ready" if snapshot else "pending"))
            ),
        }

    async def list_exports(self) -> list[dict]:
        async with self.db.sessions() as session:
            exports = (
                await session.scalars(select(Export).order_by(Export.created_at, Export.id))
            ).all()
            return [await self.export_view(session, export) for export in exports]

    async def get_export(self, export_id: str) -> dict:
        async with self.db.sessions() as session:
            return await self.export_view(session, await self.require_export(session, export_id))

    async def preview(self, config: ExportConfig) -> dict:
        async with self.db.sessions() as session:
            compiled = await self.compile(session, config)
            return {
                "yaml": compiled.yaml_content,
                "digest": compiled.digest,
                "node_count": compiled.node_count,
                "group_count": compiled.group_count,
            }

    async def replace_bindings(
        self, session: AsyncSession, export: Export, source_ids: list[str]
    ) -> None:
        await session.execute(delete(ExportSource).where(ExportSource.export_id == export.id))
        session.add_all(
            [
                ExportSource(export_id=export.id, source_id=source_id, position=index)
                for index, source_id in enumerate(source_ids)
            ]
        )
        await session.flush()

    async def create_export(self, body: ExportCreate) -> tuple[dict, str]:
        config = ExportConfig.model_validate(body.model_dump(exclude={"token"}))
        token = body.token if body.token is not None else new_token()
        async with self.mutation_lock, self.db.sessions.begin() as session:
            compiled = await self.compile(session, config)
            export = Export(
                **config.model_dump(exclude={"source_ids"}),
                token_hash=token_digest(token),
                token=token,
            )
            session.add(export)
            await session.flush()
            await self.replace_bindings(session, export, config.source_ids)
            await self.publish(session, export, compiled)
            return await self.export_view(session, export), token

    async def patch_export(self, export_id: str, body: ExportPatch) -> dict:
        async with self.mutation_lock, self.db.sessions.begin() as session:
            export = await self.require_export(session, export_id)
            changes = body.model_dump(exclude_unset=True)
            config_data = (await self.export_config(session, export)).model_dump()
            if changes.get("mode") == "inherit" and export.mode != "inherit":
                config_data["template_yaml"] = None
            elif changes.get("mode") == "template" and export.mode != "template":
                config_data["base_source_id"] = None
            config = ExportConfig.model_validate({**config_data, **changes})
            # Disabling a broken export must always be possible.
            compiled = None if set(changes) <= {"enabled"} else await self.compile(session, config)
            for key, value in config.model_dump(exclude={"source_ids"}).items():
                setattr(export, key, value)
            await self.replace_bindings(session, export, config.source_ids)
            if compiled is not None:
                await self.publish(session, export, compiled)
            return await self.export_view(session, export)

    async def rebuild_export(self, export_id: str) -> dict:
        async with self.mutation_lock, self.db.sessions.begin() as session:
            export = await self.require_export(session, export_id)
            await self.rebuild_one(session, export)
            return await self.export_view(session, export)

    async def delete_export(self, export_id: str) -> None:
        async with self.mutation_lock, self.db.sessions.begin() as session:
            await session.delete(await self.require_export(session, export_id))

    async def rotate_export_token(self, export_id: str, value: str | None) -> str:
        token = value if value is not None else new_token()
        async with self.mutation_lock, self.db.sessions.begin() as session:
            export = await self.require_export(session, export_id)
            export.token_hash = token_digest(token)
            export.token = token
        return token

    async def export_token(self, export_id: str) -> str:
        async with self.db.sessions() as session:
            export = await self.require_export(session, export_id)
            if not export.token:
                raise DomainError(
                    "该出口的 Token 未保存（旧版本创建），请更换一次 Token 后即可随时复制", 409
                )
            return export.token

    async def refresh_due(self) -> None:
        async with self.db.sessions() as session:
            ids = list(
                (
                    await session.scalars(
                        select(Source.id).where(
                            Source.kind == "url", Source.next_refresh_at <= time.time()
                        )
                    )
                ).all()
            )
        results = await asyncio.gather(
            *(self.refresh_source(source_id) for source_id in ids), return_exceptions=True
        )
        for result in results:
            if isinstance(result, Exception) and not isinstance(result, DomainError):
                logger.error("Scheduled refresh failed (%s)", type(result).__name__)

    async def scheduler(self) -> None:
        while True:
            try:
                await self.refresh_due()
            except Exception as exc:
                logger.error("Scheduler iteration failed (%s)", type(exc).__name__)
            await asyncio.sleep(self.settings.scheduler_interval_seconds)
