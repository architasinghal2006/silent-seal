import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All runtime configuration comes from the environment / .env. No secrets in code."""

    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    database_url: str = "sqlite:///./silentseal.db"
    jwt_secret: str  # required: no default on purpose
    jwt_ttl_minutes: int = 30
    cors_origins: str = "http://localhost:5173"

    # Unlock hardening
    max_failed_attempts: int = 5
    lockout_seconds: int = 60

    # Notification adapter. Mock logs and shows in the demo dashboard; sms and email are stubs.
    notify_adapter: Literal["mock", "sms", "email"] = "mock"

    # SMS stub: msg91 | twilio
    sms_provider: str = ""
    msg91_auth_key: str = ""
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""

    # SMTP stub
    smtp_host: str = ""
    smtp_user: str = ""
    smtp_password: str = ""

    # Live location share. The base URL is what contacts open, so it must be reachable by them.
    public_base_url: str = "http://localhost:8000"
    live_share_ttl_minutes: int = 120

    # Received-alerts demo dashboard. Empty disables it (404). Never enable with real data.
    demo_dashboard_token: str = ""

    # Folder holding the built frontend (`vite build` output). Set in the single-service
    # Docker image; empty means the API runs alone, as in local dev.
    frontend_dist: str = ""

    @field_validator("database_url")
    @classmethod
    def _use_psycopg_driver(cls, v: str) -> str:
        # Hosted Postgres (Neon, Render, Supabase) hands out postgres:// or postgresql:// URLs.
        # SQLAlchemy would pick psycopg2 for those, but this app ships psycopg 3.
        for prefix in ("postgres://", "postgresql://"):
            if v.startswith(prefix):
                return "postgresql+psycopg://" + v[len(prefix):]
        return v

    @model_validator(mode="after")
    def _public_url_from_host(self) -> "Settings":
        # On Render, default the live-map link base to the service's own https URL.
        render_url = os.environ.get("RENDER_EXTERNAL_URL")
        if "public_base_url" not in self.model_fields_set and render_url:
            self.public_base_url = render_url
        return self

    @property
    def frontend_dist_path(self) -> Path | None:
        if not self.frontend_dist:
            return None
        path = Path(self.frontend_dist).resolve()
        return path if (path / "index.html").is_file() else None

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
