from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# config.py lives at <repo>/apps/api/app/core/config.py
_API_ROOT = Path(__file__).resolve().parents[2]
_REPO_ROOT = Path(__file__).resolve().parents[4]


class Settings(BaseSettings):
    """Central configuration. Every value can be overridden with an environment variable."""

    model_config = SettingsConfigDict(
        # Both documented locations are read regardless of the process CWD. The repo
        # root file is second so it wins over an app-local override.
        env_file=(str(_API_ROOT / ".env"), str(_REPO_ROOT / ".env")),
        extra="ignore",
    )

    database_url: str = "sqlite:///./data/app.db"
    cors_origins: str = "http://localhost:5173,http://localhost:3000"
    solver: str = "greedy"  # greedy | ortools | auto
    llm_enabled: bool = False
    api_port: int = 8000
    max_upload_bytes: int = 5 * 1024 * 1024  # 5 MB per CSV

    # Production controls. Empty values keep the single-operator demo unlocked.
    api_token: str = ""  # when set, /api/v1 requires Bearer <token> or X-API-Key
    allowed_hosts: str = ""  # comma-separated; empty disables host filtering
    docs_enabled: bool = True
    security_headers: bool = True
    log_level: str = "INFO"
    app_version: str = "1.0.0"

    @field_validator("api_token")
    @classmethod
    def require_entropy_for_operator_token(cls, value: str) -> str:
        token = value.strip()
        if token and len(token) < 16:
            raise ValueError("API_TOKEN must contain at least 16 characters; generate a random token (e.g. openssl rand -hex 24)")
        return token


settings = Settings()


def get_cors_origins() -> list[str]:
    return [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]


def get_allowed_hosts() -> list[str]:
    return [host.strip() for host in settings.allowed_hosts.split(",") if host.strip()]
