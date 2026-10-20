from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="CCC_", env_file=BACKEND_DIR / ".env", extra="ignore"
    )

    host: str = "127.0.0.1"
    port: int = Field(default=8000, ge=1, le=65535)
    data_dir: Path = BACKEND_DIR / "data"
    cors_origins: list[str] = []
    public_base_url: str | None = None
    fetch_timeout_seconds: float = Field(default=30, gt=0)
    fetch_max_bytes: int = Field(default=10 * 1024 * 1024, gt=0)
    scheduler_interval_seconds: float = Field(default=60, gt=0)
    scheduler_enabled: bool = True

    @field_validator("data_dir")
    @classmethod
    def resolve_data_dir(cls, value: Path) -> Path:
        return (value if value.is_absolute() else BACKEND_DIR / value).resolve()

    @property
    def database_path(self) -> Path:
        return self.data_dir / "config-center.sqlite3"
