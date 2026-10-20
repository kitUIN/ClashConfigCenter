import time
import uuid
from typing import Any

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def identifier() -> str:
    return uuid.uuid4().hex


class Base(DeclarativeBase):
    pass


class SystemSetting(Base):
    __tablename__ = "system_settings"
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


class Source(Base):
    __tablename__ = "sources"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=identifier)
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(20))
    url: Mapped[str | None] = mapped_column(Text)
    refresh_interval_seconds: Mapped[int] = mapped_column(Integer, default=3600)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)
    last_attempt_at: Mapped[float | None] = mapped_column(Float)
    last_success_at: Mapped[float | None] = mapped_column(Float)
    next_refresh_at: Mapped[float | None] = mapped_column(Float)
    last_error: Mapped[str | None] = mapped_column(Text)


class ManualNode(Base):
    __tablename__ = "manual_nodes"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=identifier)
    source_id: Mapped[str] = mapped_column(ForeignKey("sources.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    config: Mapped[dict[str, Any]] = mapped_column(JSON)


class SourceSnapshot(Base):
    __tablename__ = "source_snapshots"
    source_id: Mapped[str] = mapped_column(
        ForeignKey("sources.id", ondelete="CASCADE"), primary_key=True
    )
    nodes: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    document: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    revision: Mapped[int] = mapped_column(Integer)
    version: Mapped[str] = mapped_column(String(32))
    fetched_at: Mapped[float] = mapped_column(Float)


class Export(Base):
    __tablename__ = "exports"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=identifier)
    name: Mapped[str] = mapped_column(String(200))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    mode: Mapped[str] = mapped_column(String(20))
    template_yaml: Mapped[str | None] = mapped_column(Text)
    base_source_id: Mapped[str | None] = mapped_column(
        ForeignKey("sources.id", ondelete="RESTRICT")
    )
    injection: Mapped[str] = mapped_column(String(20))
    target_groups: Mapped[list[str]] = mapped_column(JSON)
    token_hash: Mapped[str] = mapped_column(String(64))
    # 明文订阅 Token，供管理端随时查看/复制；旧版本创建的出口为空，需更换一次 Token。
    token: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)
    last_attempt_at: Mapped[float | None] = mapped_column(Float)
    last_error: Mapped[str | None] = mapped_column(Text)


class ExportSource(Base):
    __tablename__ = "export_sources"
    export_id: Mapped[str] = mapped_column(
        ForeignKey("exports.id", ondelete="CASCADE"), primary_key=True
    )
    source_id: Mapped[str] = mapped_column(
        ForeignKey("sources.id", ondelete="RESTRICT"), primary_key=True
    )
    position: Mapped[int] = mapped_column(Integer)


class ExportSnapshot(Base):
    __tablename__ = "export_snapshots"
    export_id: Mapped[str] = mapped_column(
        ForeignKey("exports.id", ondelete="CASCADE"), primary_key=True
    )
    yaml_content: Mapped[str] = mapped_column(Text)
    digest: Mapped[str] = mapped_column(String(64))
    source_versions: Mapped[dict[str, str]] = mapped_column(JSON)
    generated_at: Mapped[float] = mapped_column(Float)
