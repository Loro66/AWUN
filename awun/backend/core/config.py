from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration loaded from environment variables or ``.env``."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="AWUN_",
        extra="ignore",
    )

    app_name: str = "AWUN"
    app_version: str = "1.0.0"
    debug: bool = False
    api_prefix: str = "/api/v1"

    default_limit: int = Field(default=30, ge=1, le=100)
    max_limit: int = Field(default=100, ge=1, le=100)
    search_timeout_seconds: float = Field(default=35.0, gt=0, le=120)
    ytdlp_socket_timeout_seconds: float = Field(default=12.0, gt=0, le=60)
    media_proxy_enabled: bool = True
    media_secret: str = Field(default="dev-only-change-me", min_length=16)
    media_token_ttl_seconds: int = Field(default=1800, ge=60, le=86400)
    media_connect_timeout_seconds: float = Field(default=15.0, gt=0, le=60)

    youtube_enabled: bool = True
    soundcloud_enabled: bool = True
    vk_enabled: bool = True
    vk_access_token: str | None = None
    vk_api_version: str = "5.199"

    cors_origins: list[str] = Field(default_factory=lambda: ["*"])

    @field_validator("api_prefix")
    @classmethod
    def normalize_api_prefix(cls, value: str) -> str:
        value = value.strip()
        if not value:
            return ""
        return "/" + value.strip("/")


@lru_cache
def get_settings() -> Settings:
    return Settings()
