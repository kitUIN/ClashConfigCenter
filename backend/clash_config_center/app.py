import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import ValidationError

from .config import Settings
from .db import Database
from .errors import DomainError
from .models import Export, ExportSnapshot, SystemSetting
from .parsing import parse_subscription
from .schemas import (
    ExportConfig,
    ExportCreate,
    ExportCreatedView,
    ExportPatch,
    ExportView,
    ImportInput,
    NodeInput,
    NodeOrder,
    NodeView,
    PreviewView,
    SourceCreate,
    SourcePatch,
    SourceView,
    SubscriptionCredentials,
    TokenInput,
)
from .security import verify_token
from .service import Service, parse_node_input

bearer = HTTPBearer(auto_error=False)


def create_app(
    settings: Settings | None = None, *, transport: httpx.AsyncBaseTransport | None = None
) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        database = Database(settings.database_path)
        task = None
        try:
            token = await database.initialize()
            if token is not None:
                print(f"首次初始化管理 Token（仅显示一次，请妥善保存）: {token}", flush=True)
            # HTTPX's INFO request logger includes subscription URL credentials.
            logging.getLogger("httpx").setLevel(logging.WARNING)
            logging.getLogger("httpcore").setLevel(logging.WARNING)
            async with httpx.AsyncClient(
                transport=transport, follow_redirects=True, max_redirects=5
            ) as client:
                service = Service(database, settings, client)
                app.state.service = service
                if settings.scheduler_enabled:
                    task = asyncio.create_task(service.scheduler())
                try:
                    yield
                finally:
                    if task is not None:
                        task.cancel()
                        with suppress(asyncio.CancelledError):
                            await task
        finally:
            await database.close()

    app = FastAPI(
        title="ClashConfigCenter",
        version="0.1.0",
        lifespan=lifespan,
        description="Mihomo 订阅配置中心。管理接口使用 Bearer Token；客户端出口使用独立订阅 Token。",
    )
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
            allow_headers=["Authorization", "Content-Type"],
        )

    @app.exception_handler(DomainError)
    async def domain_error(_request, exc: DomainError):
        headers = {"WWW-Authenticate": "Bearer"} if exc.status_code == 401 else None
        return JSONResponse({"detail": exc.message}, status_code=exc.status_code, headers=headers)

    @app.exception_handler(RequestValidationError)
    @app.exception_handler(ValidationError)
    async def validation_error(_request, exc):
        # Never echo request bodies (which may contain node passwords or tokens).
        return JSONResponse(
            {
                "detail": [
                    {"loc": list(err["loc"]), "type": err["type"], "msg": err["msg"]}
                    for err in exc.errors()
                ]
            },
            status_code=422,
        )

    def service(request: Request) -> Service:
        return request.app.state.service

    async def require_admin(
        request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(bearer)
    ):
        if credentials is None:
            raise DomainError("需要有效的管理 Token", 401)
        async with service(request).db.sessions() as session:
            setting = await session.get(SystemSetting, "admin_token_hash")
            if setting is None or not verify_token(credentials.credentials, setting.value):
                raise DomainError("需要有效的管理 Token", 401)

    router = APIRouter(prefix="/api/v1", dependencies=[Depends(require_admin)])

    @router.get("/auth/check", tags=["认证"])
    async def auth_check() -> dict:
        return {"authenticated": True}

    @router.get("/sources", tags=["内部订阅"], response_model=list[SourceView])
    async def list_sources(request: Request) -> list[dict]:
        return await service(request).list_sources()

    @router.post("/sources", tags=["内部订阅"], status_code=201, response_model=SourceView)
    async def create_source(body: SourceCreate, request: Request) -> dict:
        return await service(request).create_source(body)

    @router.get("/sources/{source_id}", tags=["内部订阅"], response_model=SourceView)
    async def get_source(source_id: str, request: Request) -> dict:
        return await service(request).get_source(source_id)

    @router.patch("/sources/{source_id}", tags=["内部订阅"], response_model=SourceView)
    async def patch_source(source_id: str, body: SourcePatch, request: Request) -> dict:
        return await service(request).patch_source(source_id, body)

    @router.delete("/sources/{source_id}", tags=["内部订阅"], status_code=204)
    async def delete_source(source_id: str, request: Request) -> Response:
        await service(request).delete_source(source_id)
        return Response(status_code=204)

    @router.post("/sources/{source_id}/refresh", tags=["内部订阅"], response_model=SourceView)
    async def refresh_source(source_id: str, request: Request) -> dict:
        """刷新失败仍返回来源状态；以 status、last_error 判断结果。"""
        return await service(request).refresh_source(source_id)

    @router.get("/sources/{source_id}/nodes", tags=["节点"], response_model=list[NodeView])
    async def list_nodes(source_id: str, request: Request) -> list[dict]:
        return await service(request).source_nodes(source_id)

    @router.get("/sources/{source_id}/groups", tags=["内部订阅"], response_model=list[str])
    async def list_source_groups(source_id: str, request: Request) -> list[str]:
        """来源最新快照中的策略组名称，用于继承模式选择目标策略组。"""
        return await service(request).source_groups(source_id)

    @router.post(
        "/sources/{source_id}/nodes", tags=["节点"], status_code=201, response_model=list[NodeView]
    )
    async def add_node(source_id: str, body: NodeInput, request: Request) -> list[dict]:
        """新增后返回该来源完整节点列表。"""
        return await service(request).edit_nodes(source_id, "add", [parse_node_input(body)])

    @router.post(
        "/sources/{source_id}/nodes/import",
        tags=["节点"],
        status_code=201,
        response_model=list[NodeView],
    )
    async def import_nodes(source_id: str, body: ImportInput, request: Request) -> list[dict]:
        """追加导入；整批校验通过后才写入，返回完整节点列表。"""
        parsed = await asyncio.to_thread(parse_subscription, body.content, allow_single_node=True)
        return await service(request).edit_nodes(source_id, "add", parsed.nodes)

    @router.put("/sources/{source_id}/nodes/order", tags=["节点"], response_model=list[NodeView])
    async def order_nodes(source_id: str, body: NodeOrder, request: Request) -> list[dict]:
        return await service(request).edit_nodes(source_id, "order", order=body.node_ids)

    @router.patch(
        "/sources/{source_id}/nodes/{node_id}", tags=["节点"], response_model=list[NodeView]
    )
    async def update_node(
        source_id: str, node_id: str, body: NodeInput, request: Request
    ) -> list[dict]:
        """整体替换该节点配置，返回来源完整节点列表。"""
        return await service(request).edit_nodes(
            source_id, "update", [parse_node_input(body)], node_id=node_id
        )

    @router.delete("/sources/{source_id}/nodes/{node_id}", tags=["节点"], status_code=204)
    async def delete_node(source_id: str, node_id: str, request: Request) -> Response:
        await service(request).edit_nodes(source_id, "delete", node_id=node_id)
        return Response(status_code=204)

    def credentials_response(request: Request, export_id: str, token: str) -> dict:
        origin = (settings.public_base_url or str(request.base_url)).rstrip("/")
        return {
            "token": token,
            "subscription_url": f"{origin}/sub/{export_id}?{urlencode({'token': token})}",
        }

    @router.get("/exports", tags=["订阅出口"], response_model=list[ExportView])
    async def list_exports(request: Request) -> list[dict]:
        return await service(request).list_exports()

    @router.post("/exports", tags=["订阅出口"], status_code=201, response_model=ExportCreatedView)
    async def create_export(body: ExportCreate, request: Request) -> dict:
        result, token = await service(request).create_export(body)
        return {**result, **credentials_response(request, result["id"], token)}

    @router.post("/exports/preview", tags=["订阅出口"], response_model=PreviewView)
    async def preview_export(body: ExportConfig, request: Request) -> dict:
        return await service(request).preview(body)

    @router.get("/exports/{export_id}", tags=["订阅出口"], response_model=ExportView)
    async def get_export(export_id: str, request: Request) -> dict:
        return await service(request).get_export(export_id)

    @router.patch("/exports/{export_id}", tags=["订阅出口"], response_model=ExportView)
    async def patch_export(export_id: str, body: ExportPatch, request: Request) -> dict:
        return await service(request).patch_export(export_id, body)

    @router.delete("/exports/{export_id}", tags=["订阅出口"], status_code=204)
    async def delete_export(export_id: str, request: Request) -> Response:
        await service(request).delete_export(export_id)
        return Response(status_code=204)

    @router.post("/exports/{export_id}/rebuild", tags=["订阅出口"], response_model=ExportView)
    async def rebuild_export(export_id: str, request: Request) -> dict:
        return await service(request).rebuild_export(export_id)

    @router.put(
        "/exports/{export_id}/token", tags=["订阅出口"], response_model=SubscriptionCredentials
    )
    async def rotate_token(export_id: str, body: TokenInput, request: Request) -> dict:
        token = await service(request).rotate_export_token(export_id, body.token)
        return credentials_response(request, export_id, token)

    @router.get(
        "/exports/{export_id}/credentials",
        tags=["订阅出口"],
        response_model=SubscriptionCredentials,
    )
    async def get_credentials(export_id: str, request: Request) -> dict:
        """返回当前订阅 Token 与完整订阅链接，可重复获取。"""
        token = await service(request).export_token(export_id)
        return credentials_response(request, export_id, token)

    app.include_router(router)

    @app.get("/health", tags=["运行状态"])
    async def health() -> dict:
        return {"status": "ok"}

    @app.get(
        "/sub/{export_id}",
        tags=["客户端订阅"],
        response_class=Response,
        responses={
            200: {"content": {"application/yaml": {}}},
            304: {"description": "内容未变化"},
            404: {"description": "订阅不可访问"},
            503: {"description": "尚无有效结果"},
        },
    )
    async def subscription(export_id: str, request: Request, token: str = "") -> Response:
        async with service(request).db.sessions() as session:
            export = await session.get(Export, export_id)
            if export is None or not export.enabled or not verify_token(token, export.token_hash):
                raise DomainError("订阅不可访问", 404)
            snapshot = await session.get(ExportSnapshot, export_id)
            if snapshot is None:
                raise DomainError("尚无有效订阅结果", 503)
            etag = f'"{snapshot.digest}"'
            headers = {"ETag": etag, "Cache-Control": "private, no-cache"}
            candidates = [
                item.strip().removeprefix("W/")
                for item in request.headers.get("if-none-match", "").split(",")
            ]
            if etag in candidates or "*" in candidates:
                return Response(status_code=304, headers=headers)
            return Response(
                snapshot.yaml_content, media_type="application/yaml; charset=utf-8", headers=headers
            )

    return app
