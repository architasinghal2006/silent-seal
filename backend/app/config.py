from functools import lru_cache
from typing import Literal

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

    # Received-alerts demo dashboard. Empty disables it (404). Never enable with real data.
    demo_dashboard_token: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
