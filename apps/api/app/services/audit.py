from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from app.repo import database as db

logger = logging.getLogger(__name__)


def record(
    action: str,
    entity_type: str,
    entity_id: Optional[str] = None,
    detail: Optional[Dict[str, Any]] = None,
) -> None:
    """Write an audit event without letting a logging failure break the action."""
    try:
        db.log_activity(action, entity_type, entity_id=entity_id, detail=detail)
    except Exception:  # noqa: BLE001 - audit must never take down the operation
        logger.warning("Could not record activity '%s' for %s", action, entity_id, exc_info=True)
