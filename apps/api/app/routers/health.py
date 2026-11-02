from __future__ import annotations

import importlib.util
import time

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.repo.database import _connect

router = APIRouter(prefix="/api/v1", tags=["health"])

_STARTED_AT = time.monotonic()


def _database_status() -> tuple[str, str | None]:
    try:
        conn = _connect()
        try:
            conn.execute("SELECT 1").fetchone()
        finally:
            conn.close()
        return "ok", None
    except Exception as exc:  # noqa: BLE001 - health checks must never raise
        return "error", str(exc)[:200]


def _ready_body() -> dict:
    db_status, db_error = _database_status()
    solver_available = importlib.util.find_spec("ortools") is not None
    body = {
        "status": "ok" if db_status == "ok" else "degraded",
        "version": settings.app_version,
        "solver": settings.solver,
        "solver_available": solver_available,
        "db": db_status,
        "operator_token_required": bool(settings.api_token.strip()),
        "uptime_seconds": round(time.monotonic() - _STARTED_AT, 1),
    }
    if db_error:
        body["db_error"] = db_error
    return body


@router.get("/health/live")
def liveness():
    """Process liveness only: no database, no external dependency."""
    return {
        "status": "ok",
        "version": settings.app_version,
        "uptime_seconds": round(time.monotonic() - _STARTED_AT, 1),
    }


@router.get("/health/ready")
def readiness():
    """Readiness includes the database; a blind 'ok' is worse than a 503."""
    body = _ready_body()
    if body["db"] != "ok":
        return JSONResponse(status_code=503, content=body)
    return body


@router.get("/health")
def health_check():
    # Backwards-compatible alias used by the UI and container healthcheck.
    return _ready_body()
