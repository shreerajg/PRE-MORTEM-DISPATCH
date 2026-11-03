from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Query

from app.repo import database as db

router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])


def _num(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _disruption_type(payload: Any) -> str:
    if isinstance(payload, dict):
        if payload.get("type") == "compound":
            return "compound"
        return str(payload.get("type") or "unknown")
    return "unknown"


def _mean(values: List[float]) -> Optional[float]:
    return round(sum(values) / len(values), 4) if values else None


@router.get("/overview")
def analytics_overview(limit: int = Query(default=50)):
    """Aggregate the stored scenario history into trends and recovery economics.

    This is a read-only projection; every number is derived from stored KPIs,
    nothing is recomputed at read time.
    """
    limit = max(1, min(limit, 100))
    rows = db.list_scenarios(limit=limit, offset=0)
    plan_ids = [
        plan_id
        for scen in rows
        for plan_id in (
            scen.get("baseline_plan_id"),
            scen.get("disrupted_plan_id"),
            scen.get("recovered_plan_id"),
        )
        if plan_id
    ]
    kpis_by_plan = db.get_plan_kpis_by_ids(plan_ids)

    items: List[Dict[str, Any]] = []
    # list_scenarios is newest first; charts want chronological order.
    for scen in reversed(rows):
        def kpis(plan_id):
            if not plan_id:
                return None
            return kpis_by_plan.get(plan_id)

        baseline = kpis(scen.get("baseline_plan_id")) or {}
        disrupted = kpis(scen.get("disrupted_plan_id")) or {}
        recovered = kpis(scen.get("recovered_plan_id")) or {}

        base_ful = _num(baseline.get("fulfillment_rate")) if baseline else None
        dis_ful = _num(disrupted.get("fulfillment_rate")) if disrupted else None
        rec_ful = _num(recovered.get("fulfillment_rate")) if recovered else None
        base_cost = _num(baseline.get("total_cost")) if baseline else None
        dis_cost = _num(disrupted.get("total_cost")) if disrupted else None
        rec_cost = _num(recovered.get("total_cost")) if recovered else None

        items.append(
            {
                "id": scen["id"],
                "name": scen.get("name"),
                "created_at": scen.get("created_at"),
                "status": scen.get("status"),
                "disruption_type": _disruption_type(scen.get("disruption")),
                "baseline_fulfillment": base_ful,
                "disrupted_fulfillment": dis_ful,
                "recovered_fulfillment": rec_ful,
                "cost_delta": round(dis_cost - base_cost, 4) if dis_cost is not None and base_cost is not None else None,
                "unmet_delta": round(
                    _num(disrupted.get("unmet")) - _num(baseline.get("unmet")), 4
                )
                if disrupted and baseline
                else None,
                "recovery_cost": round(rec_cost - dis_cost, 4) if rec_cost is not None and dis_cost is not None else None,
                "restored_pp": round((rec_ful - dis_ful) * 100, 2) if rec_ful is not None and dis_ful is not None else None,
                "residual_units": round(_num(recovered.get("unmet")), 4) if recovered else None,
            }
        )

    recovered_items = [item for item in items if item["recovered_fulfillment"] is not None]
    summary = {
        "scenarios_analyzed": len(items),
        "recovered": len(recovered_items),
        "avg_disrupted_fulfillment": _mean(
            [item["disrupted_fulfillment"] for item in items if item["disrupted_fulfillment"] is not None]
        ),
        "avg_recovery_cost": _mean(
            [item["recovery_cost"] for item in recovered_items if item["recovery_cost"] is not None]
        ),
        "avg_restored_pp": _mean(
            [item["restored_pp"] for item in recovered_items if item["restored_pp"] is not None]
        ),
        "open_gap_scenarios": sum(
            1 for item in recovered_items if (item["residual_units"] or 0) > 0
        ),
    }

    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for item in items:
        grouped.setdefault(item["disruption_type"], []).append(item)

    by_type = [
        {
            "type": disruption_type,
            "count": len(group),
            "avg_unmet_delta": _mean(
                [item["unmet_delta"] for item in group if item["unmet_delta"] is not None]
            ),
            "avg_fulfillment_drop_pp": _mean(
                [
                    (item["disrupted_fulfillment"] - item["baseline_fulfillment"]) * 100
                    for item in group
                    if item["disrupted_fulfillment"] is not None and item["baseline_fulfillment"] is not None
                ]
            ),
        }
        for disruption_type, group in grouped.items()
    ]
    by_type.sort(key=lambda row: (-row["count"], row["type"]))

    return {
        "total_scenarios": db.count_scenarios(),
        "scenarios_analyzed": len(items),
        "limit": limit,
        "summary": summary,
        "by_type": by_type,
        "trend": items,
    }
