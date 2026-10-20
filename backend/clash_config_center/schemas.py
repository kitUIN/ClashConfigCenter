from typing import Any, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, model_validator

DEFAULT_TEMPLATE = """mixed-port: 7890
allow-lan: false
mode: rule
log-level: info
proxy-groups:
  - name: 代理选择
    type: select
    proxies: [DIRECT]
rules:
  - MATCH,代理选择
"""


class InputModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SourceCreate(InputModel):
    name: str = Field(min_length=1, max_length=200)
    kind: Literal["url", "manual"]
    url: str | None = Field(default=None, max_length=8192)
    refresh_interval_seconds: int = Field(default=3600, ge=60, le=604800)

    @model_validator(mode="after")
    def validate_source(self):
        if not self.name.strip() or any(char in self.name for char in (",", "\r", "\n")):
            raise ValueError("来源名称不能为空，也不能包含逗号或换行")
        if self.kind == "url":
            try:
                parsed = urlsplit(self.url or "")
                if parsed.scheme not in ("http", "https") or not parsed.hostname:
                    raise ValueError()
                parsed.port
            except ValueError as exc:
                raise ValueError("URL 来源必须提供有效的 HTTP/HTTPS 地址") from exc
        elif self.url is not None:
            raise ValueError("自定义来源不接受 URL")
        return self


class SourcePatch(InputModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    url: str | None = Field(default=None, max_length=8192)
    refresh_interval_seconds: int | None = Field(default=None, ge=60, le=604800)


class NodeInput(InputModel):
    config: dict[str, Any] | None = Field(
        default=None, description="Mihomo 节点对象，SS/VLESS 可直接按字段录入"
    )
    yaml: str | None = Field(default=None, max_length=10 * 1024 * 1024)
    uri: str | None = Field(default=None, max_length=65536)

    @model_validator(mode="after")
    def one_input(self):
        if sum(item is not None for item in (self.config, self.yaml, self.uri)) != 1:
            raise ValueError("config、yaml、uri 必须且只能提供一项")
        return self


class ImportInput(InputModel):
    content: str = Field(min_length=1, max_length=10 * 1024 * 1024)


class NodeOrder(InputModel):
    node_ids: list[str]


class ExportConfig(InputModel):
    name: str = Field(min_length=1, max_length=200)
    enabled: bool = True
    source_ids: list[str] = Field(min_length=1)
    mode: Literal["template", "inherit"] = "template"
    template_yaml: str | None = Field(default=None, max_length=10 * 1024 * 1024)
    base_source_id: str | None = None
    injection: Literal["grouped", "direct"] = "grouped"
    target_groups: list[str] = Field(default_factory=lambda: ["代理选择"], min_length=1)

    @model_validator(mode="after")
    def check_config(self):
        if not self.name.strip():
            raise ValueError("出口名称不能为空")
        if len(set(self.source_ids)) != len(self.source_ids):
            raise ValueError("来源不能重复选择")
        if len(set(self.target_groups)) != len(self.target_groups) or not all(self.target_groups):
            raise ValueError("目标策略组不能重复或为空")
        if self.mode == "inherit":
            if self.base_source_id not in self.source_ids:
                raise ValueError("基础来源必须是所选来源之一")
            if self.template_yaml is not None:
                raise ValueError("继承模式不接受模板")
        else:
            if self.base_source_id is not None:
                raise ValueError("模板模式不接受基础来源")
            if self.template_yaml is None:
                self.template_yaml = DEFAULT_TEMPLATE
        return self


class ExportCreate(ExportConfig):
    token: str | None = Field(default=None, min_length=1, max_length=512)


class ExportPatch(InputModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    enabled: bool | None = None
    source_ids: list[str] | None = None
    mode: Literal["template", "inherit"] | None = None
    template_yaml: str | None = Field(default=None, max_length=10 * 1024 * 1024)
    base_source_id: str | None = None
    injection: Literal["grouped", "direct"] | None = None
    target_groups: list[str] | None = None


class TokenInput(InputModel):
    token: str | None = Field(default=None, min_length=1, max_length=512)


class SourceView(BaseModel):
    id: str
    name: str
    kind: Literal["url", "manual"]
    url: str | None
    refresh_interval_seconds: int
    created_at: str
    last_attempt_at: str | None
    last_success_at: str | None
    next_refresh_at: str | None
    last_error: str | None
    using_stale_snapshot: bool
    status: Literal["pending", "ready", "error"]
    node_count: int
    has_snapshot: bool


class NodeView(BaseModel):
    id: str | None = Field(description="自定义节点具有稳定 ID；URL 来源节点的 ID 为 null")
    position: int
    config: dict[str, Any]


class SourceErrorView(BaseModel):
    source_id: str
    message: str


class ExportView(ExportConfig):
    id: str
    created_at: str
    last_attempt_at: str | None
    last_success_at: str | None
    last_error: str | None
    source_errors: list[SourceErrorView]
    using_stale_snapshot: bool
    has_snapshot: bool
    status: Literal["disabled", "pending", "ready", "stale", "error"]


class SubscriptionCredentials(BaseModel):
    token: str
    subscription_url: str


class ExportCreatedView(ExportView, SubscriptionCredentials):
    pass


class PreviewView(BaseModel):
    yaml: str
    digest: str
    node_count: int
    group_count: int
