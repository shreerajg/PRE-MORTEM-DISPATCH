from __future__ import annotations

from fastapi import APIRouter, Query

from app.repo import database as db

router = APIRouter(prefix="/api/v1/activity", tags=["activity"])


@router.get("")
def list_activity(limit: int = Query(default=25), offset: int = Query(default=0)):
    """Newest-first workspace audit trail."""
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    return {
        "events": db.list_activity(limit=limit, offset=offset),
        "total": db.count_activity(),
        "limit": limit,
        "offset": offset,
    }
