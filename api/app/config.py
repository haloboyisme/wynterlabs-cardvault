from functools import cached_property
from pathlib import Path
from typing import Literal
from urllib.parse import quote_plus

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def read_secret(path: str) -> str:
    value = Path(path).read_text().rstrip("\n")
    if not value:
        raise ValueError(f"Secret file is empty: {path}")
    return value


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CARDS_", extra="ignore")

    database_url: str | None = None
    database_host: str = "cards-db"
    database_port: int = 5432
    database_name: str = "wynterlabs_cards"
    database_user: str = "wynterlabs_cards"
    database_password_file: str | None = None
    bootstrap_secret_file: str
    session_pepper_file: str
    # This is deliberately separate from the normal Cards secret bundle.
    mfa_encryption_key_file: str
    mfa_challenge_minutes: int = Field(default=5, ge=1, le=15)
    mfa_challenge_max_attempts: int = Field(default=10, ge=1, le=20)
    environment: Literal["development", "production"] = "production"
    cookie_name: str = "wynterlabs_session"
    session_hours: int = 168
    identity_session_retention_days: int = Field(default=30, ge=1, le=3650)
    identity_login_attempt_retention_days: int = Field(default=30, ge=1, le=3650)
    identity_cleanup_batch_size: int = Field(default=250, ge=1, le=5000)
    catalog_http_timeout_seconds: float = Field(default=20.0, ge=1, le=120)
    catalog_download_timeout_seconds: float = Field(default=900.0, ge=30, le=3600)
    catalog_download_deadline_seconds: float = Field(default=1200.0, ge=0.01, le=7200)
    catalog_retry_attempts: int = Field(default=3, ge=1, le=5)
    catalog_max_download_bytes: int = Field(default=250_000_000, ge=1024, le=500_000_000)
    catalog_batch_size: int = Field(default=500, ge=1, le=5000)
    catalog_min_printings: int = Field(default=100_000, ge=1)
    catalog_min_sets: int = Field(default=500, ge=1)
    catalog_pokemon_min_printings: int = Field(default=1_000, ge=1)
    catalog_pokemon_min_sets: int = Field(default=10, ge=1)
    catalog_yugioh_min_printings: int = Field(default=1_000, ge=1)
    catalog_yugioh_min_sets: int = Field(default=10, ge=1)
    catalog_one_piece_min_printings: int = Field(default=1_000, ge=1)
    catalog_one_piece_min_sets: int = Field(default=10, ge=1)
    catalog_tcgjson_min_printings: int = Field(default=500, ge=1)
    catalog_tcgjson_min_sets: int = Field(default=5, ge=1)
    catalog_max_rejected_records: int = Field(default=1000, ge=0)
    catalog_max_rejected_ratio: float = Field(default=0.02, ge=0, le=1)
    catalog_max_provider_response_bytes: int = Field(default=25_000_000, ge=1024, le=100_000_000)
    catalog_provider_max_records: int = Field(default=100_000, ge=1, le=500_000)
    catalog_provider_max_pages: int = Field(default=500, ge=1, le=2_000)
    catalog_yugioh_page_size: int = Field(default=250, ge=1, le=1_000)
    catalog_media_cache_dir: Path = Path("/var/lib/wynterlabs/catalog-media")
    catalog_media_max_bytes: int = Field(default=10_000_000, ge=1024, le=25_000_000)
    catalog_media_cache_max_bytes: int = Field(
        default=2_000_000_000, ge=10_000_000, le=20_000_000_000
    )
    trading_enabled: bool = False

    @cached_property
    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        if not self.database_password_file:
            raise ValueError("A database URL or password file is required")
        password = quote_plus(read_secret(self.database_password_file))
        return (
            f"postgresql+asyncpg://{self.database_user}:{password}"
            f"@{self.database_host}:{self.database_port}/{self.database_name}"
        )

    @cached_property
    def bootstrap_secret(self) -> str:
        return read_secret(self.bootstrap_secret_file)

    @cached_property
    def session_pepper(self) -> str:
        value = read_secret(self.session_pepper_file)
        if len(value) < 64:
            raise ValueError("Session pepper must contain at least 64 characters")
        return value

    @cached_property
    def mfa_encryption_key(self) -> bytes:
        value = Path(self.mfa_encryption_key_file).read_bytes()
        if len(value) != 32:
            raise ValueError("MFA encryption key must contain exactly 32 bytes")
        return value
