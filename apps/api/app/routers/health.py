import importlib.util

from fastapi import APIRouter

from app.core.config import settings
from app.repo.database import _connect

router = APIRouter(prefix="/api/v1", tags=["health"])


@router.get("/health")
def health_check():
    # A health check that cannot see the database is not healthy. Report the
    # failure instead of a constant "ok" so the UI and Docker can react.
    db_status = "ok"
    db_error = None
    try:
        conn = _connect()
        try:
            conn.execute("SELECT 1").fetchone()
        finally:
            conn.close()
    except Exception as exc:  # noqa: BLE001 - health checks must never raise
        db_status = "error"
        db_error = str(exc)[:200]

    solver_available = importlib.util.find_spec("ortools") is not None
    body = {
        "status": "ok" if db_status == "ok" else "degraded",
        "version": "1.0.0",
        "solver": settings.solver,
        "solver_available": solver_available,
        "db": db_status,
    }
    if db_error:
        body["db_error"] = db_error
    return body
