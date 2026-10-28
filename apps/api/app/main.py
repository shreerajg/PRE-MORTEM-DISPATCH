from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import get_cors_origins
from app.core.errors import (
    generic_exception_handler,
    http_exception_handler,
    validation_exception_handler,
)
from app.repo.database import init_db

logger = logging.getLogger("app.access")


def _configure_access_logging() -> None:
    """Emit one line per request with its id and duration.

    Uvicorn's own access log cannot see the request id this app assigns, so a
    dedicated logger with its own handler keeps incidents traceable end to end.
    """
    access = logging.getLogger("app.access")
    if access.handlers:
        return
    handler = logging.StreamHandler()
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    )
    access.addHandler(handler)
    access.setLevel(logging.INFO)
    access.propagate = False


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Attach a request id to every response and log its outcome.

    Clients (and this app's error envelope) can quote the id when reporting a
    failure; the same id appears in the server log line.
    """

    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        request.state.request_id = request_id
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            elapsed_ms = (time.perf_counter() - started) * 1000
            logger.exception(
                "%s %s failed after %.1f ms [%s]",
                request.method,
                request.url.path,
                elapsed_ms,
                request_id,
            )
            raise
        elapsed_ms = (time.perf_counter() - started) * 1000
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Process-Time-Ms"] = f"{elapsed_ms:.1f}"
        logger.info(
            "%s %s %s %.1fms [%s]",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
            request_id,
        )
        return response


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


def create_app() -> FastAPI:
    _configure_access_logging()
    application = FastAPI(
        title="Pre-Mortem Dispatch API",
        version="1.0.0",
        description=(
            "Distribution intelligence: baseline allocation, disruption simulation, "
            "impact analysis, recovery planning and scenario comparison."
        ),
        lifespan=lifespan,
    )

    application.add_middleware(
        CORSMiddleware,
        allow_origins=get_cors_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    # Added after CORS so it wraps every route (and every CORS response) with an id.
    application.add_middleware(RequestContextMiddleware)

    application.add_exception_handler(StarletteHTTPException, http_exception_handler)
    application.add_exception_handler(RequestValidationError, validation_exception_handler)
    application.add_exception_handler(Exception, generic_exception_handler)

    # Routers are imported here so the app object exists before module-level imports run
    from app.routers.datasets import router as datasets_router
    from app.routers.forecast import router as forecast_router
    from app.routers.health import router as health_router
    from app.routers.plans import router as plans_router
    from app.routers.scenarios import router as scenarios_router

    application.include_router(health_router)
    application.include_router(datasets_router)
    application.include_router(plans_router)
    application.include_router(scenarios_router)
    application.include_router(forecast_router)

    @application.get("/", tags=["meta"])
    def root():
        return {"message": "Pre-Mortem Dispatch API", "version": "1.0.0", "docs": "/docs"}

    return application


app = create_app()

# Ensure tables exist even when the app is used without the lifespan (e.g. tests)
try:
    init_db()
except Exception:  # pragma: no cover - defensive only
    pass
