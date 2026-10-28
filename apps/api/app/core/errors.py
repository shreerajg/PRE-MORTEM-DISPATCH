import logging

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)

_STATUS_CODES = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    409: "conflict",
    413: "payload_too_large",
    422: "validation_error",
    429: "rate_limited",
}


def _request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """HTTP errors keep their status and message, wrapped in the standard envelope."""
    detail = exc.detail if isinstance(exc.detail, str) else "Request failed"
    content = {
        "detail": detail,
        "code": _STATUS_CODES.get(exc.status_code, "http_error"),
    }
    if not isinstance(exc.detail, str):
        content["errors"] = jsonable_encoder(exc.detail)
    rid = _request_id(request)
    if rid:
        content["request_id"] = rid
    headers = getattr(exc, "headers", None)
    return JSONResponse(status_code=exc.status_code, content=content, headers=headers)


async def validation_exception_handler(request: Request, exc: RequestValidationError):
    content = {
        "detail": "Request validation failed",
        "code": "validation_error",
        "errors": jsonable_encoder(exc.errors()),
    }
    rid = _request_id(request)
    if rid:
        content["request_id"] = rid
    return JSONResponse(status_code=422, content=content)


async def generic_exception_handler(request: Request, exc: Exception):
    logger.exception(
        "Unhandled error on %s %s [%s]",
        request.method,
        request.url.path,
        _request_id(request),
    )
    content = {"detail": "Internal server error", "code": "internal_error"}
    rid = _request_id(request)
    if rid:
        content["request_id"] = rid
    return JSONResponse(status_code=500, content=content)


def error_response(message: str, code: str, status: int = 400, errors=None):
    content = {"detail": message, "code": code}
    if errors:
        content["errors"] = errors
    return JSONResponse(status_code=status, content=content)
