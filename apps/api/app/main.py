from __future__ import annotations

import logging
import re
import secrets
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.core.config import get_allowed_hosts, get_cors_origins, settings
from app.core.errors import (
    generic_exception_handler,
    http_exception_handler,
    validation_exception_handler,
)
from app.repo.database import init_db

logger = logging.getLogger("app.access")

_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,64}$")
_AUTH_PUBLIC_PATHS = {
    "/api/v1/health",
    "/api/v1/health/live",
    "/api/v1/health/ready",
    "/api/v1/auth/status",
}
_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
}


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
    access.setLevel(getattr(logging, settings.log_level.upper(), logging.INFO))
    access.propagate = False


def _request_id_for(request: Request) -> str:
    """Keep a valid caller id; never echo control characters or arbitrary length."""
    supplied = request.headers.get("x-request-id")
    if supplied and _REQUEST_ID_RE.fullmatch(supplied):
        return supplied
    return uuid.uuid4().hex[:12]


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Attach a request id to every response and log its outcome.

    Clients (and this app's error envelope) can quote the id when reporting a
    failure; the same id appears in the server log line.
    """

    async def dispatch(self, request: Request, call_next):
        request_id = _request_id_for(request)
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


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Defence-in-depth headers for API responses (nginx covers the SPA)."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if settings.security_headers:
            for header, value in _SECURITY_HEADERS.items():
                response.headers.setdefault(header, value)
            if request.url.path.startswith("/api/"):
                response.headers.setdefault("Cache-Control", "no-store")
        return response


class OperatorAuthMiddleware(BaseHTTPMiddleware):
    """Optional bearer-token gate for a single-operator deployment.

    This is deliberately not a user system: when ``API_TOKEN`` is unset the
    console stays open for the bundled demo. When it is set, every API route
    except health and auth discovery requires the shared token.
    """

    async def dispatch(self, request: Request, call_next):
        token = settings.api_token.strip()
        path = request.url.path.rstrip("/") or "/"
        if (
            not token
            or request.method == "OPTIONS"
            or not path.startswith("/api/v1")
            or path in _AUTH_PUBLIC_PATHS
        ):
            return await call_next(request)

        authorization = request.headers.get("authorization", "").strip()
        supplied = ""
        if authorization.lower().startswith("bearer "):
            supplied = authorization[7:].strip()
        if not supplied:
            supplied = request.headers.get("x-api-key", "").strip()

        if supplied and secrets.compare_digest(supplied, token):
            return await call_next(request)

        return JSONResponse(
            status_code=401,
            content={
                "detail": "Missing or invalid operator token",
                "code": "unauthorized",
                "request_id": getattr(request.state, "request_id", None),
            },
            headers={"WWW-Authenticate": "Bearer"},
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    logger.info(
        "Pre-Mortem Dispatch ready · solver=%s · operator_token=%s · docs=%s",
        settings.solver,
        "required" if settings.api_token.strip() else "disabled",
        "enabled" if settings.docs_enabled else "disabled",
    )
    yield


def create_app() -> FastAPI:
    _configure_access_logging()
    docs_enabled = settings.docs_enabled
    application = FastAPI(
        title="Pre-Mortem Dispatch API",
        version=settings.app_version,
        description=(
            "Distribution intelligence: baseline allocation, disruption simulation, "
            "impact analysis, recovery planning and scenario comparison."
        ),
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
        openapi_url="/openapi.json" if docs_enabled else None,
        lifespan=lifespan,
    )

    # Middleware is added inside-out: the last one registered is outermost.
    allowed_hosts = get_allowed_hosts()
    if allowed_hosts:
        application.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts)
    application.add_middleware(OperatorAuthMiddleware)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=get_cors_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID", "X-Process-Time-Ms"],
    )
    application.add_middleware(SecurityHeadersMiddleware)
    application.add_middleware(RequestContextMiddleware)

    application.add_exception_handler(StarletteHTTPException, http_exception_handler)
    application.add_exception_handler(RequestValidationError, validation_exception_handler)
    application.add_exception_handler(Exception, generic_exception_handler)

    # Routers are imported here so the app object exists before module-level imports run
    from app.routers.auth import router as auth_router
    from app.routers.datasets import router as datasets_router
    from app.routers.forecast import router as forecast_router
    from app.routers.health import router as health_router
    from app.routers.plans import router as plans_router
    from app.routers.scenarios import router as scenarios_router

    application.include_router(health_router)
    application.include_router(auth_router)
    application.include_router(datasets_router)
    application.include_router(plans_router)
    application.include_router(scenarios_router)
    application.include_router(forecast_router)

    @application.get("/", tags=["meta"])
    def root():
        return {
            "message": "Pre-Mortem Dispatch API",
            "version": settings.app_version,
            "docs": "/docs" if docs_enabled else None,
            "operator_token_required": bool(settings.api_token.strip()),
        }

    return application


app = create_app()

# Ensure tables exist even when the app is used without the lifespan (e.g. tests)
try:
    init_db()
except Exception:  # pragma: no cover - defensive only
    pass
