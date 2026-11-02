from __future__ import annotations

from fastapi import APIRouter, Request

from app.core.config import settings

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.get("/status")
def auth_status():
    """Public discovery: does this deployment require an operator token?"""
    required = bool(settings.api_token.strip())
    return {"required": required, "scheme": "bearer" if required else "none"}


@router.get("/check")
def auth_check(request: Request):
    """Reached only when the token gate passed (or no token is configured)."""
    return {
        "ok": True,
        "scheme": "bearer" if settings.api_token.strip() else "none",
        "request_id": getattr(request.state, "request_id", None),
    }
