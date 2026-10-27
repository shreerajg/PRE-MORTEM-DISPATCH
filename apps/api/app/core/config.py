from pathlib import Path

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


settings = Settings()


def get_cors_origins() -> list[str]:
    return [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]
