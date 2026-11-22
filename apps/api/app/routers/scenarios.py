from __future__ import annotations

import math
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from app.domain.schemas import DisruptionRequest, ScenarioCreate, ScenarioRename
from app.repo import database as db
from app.services.advisory import scenario_brief
from app.services.audit import record as record_activity
from app.services.reporting import export_scenario_csv
from app.services.scenario_service import (
    _clean_name,
    _stored_disruptions,
    create_disrupted_scenario,
    recover_scenario,
)
from app.services.sensitivity import run_sensitivity_sweep

router = APIRouter(prefix="/api/v1/scenarios", tags=["scenarios"])


def _requested_disruptions(body: ScenarioCreate) -> List[DisruptionRequest]:
    if body.disruptions:
        return list(body.disruptions)
    assert body.disruption is not None  # guaranteed by ScenarioCreate validation
    return [body.disruption]


def _scenario_summary(
    scen: Dict[str, Any],
    kpis_by_plan: Optional[Dict[str, Optional[Dict[str, Any]]]] = None,
) -> Dict[str, Any]:
    """Compact scenario row for lists / dashboard recency panels.

    ``kpis_by_plan`` is a pre-fetched plan id → KPI map so list endpoints do not
    issue three queries per scenario or decode full plan documents.
    """
    def kpis(plan_id):
        if not plan_id:
            return None
        if kpis_by_plan is not None:
            return kpis_by_plan.get(plan_id)
        plan = db.get_plan(plan_id)
        return (plan or {}).get("data", {}).get("kpis")

    return {
        "id": scen["id"],
        "name": scen.get("name"),
        "status": scen.get("status"),
        "created_at": scen.get("created_at"),
        "baseline_plan_id": scen.get("baseline_plan_id"),
        "disrupted_plan_id": scen.get("disrupted_plan_id"),
        "recovered_plan_id": scen.get("recovered_plan_id"),
        "disruption": scen.get("disruption"),
        "kpis": {
            "baseline": kpis(scen.get("baseline_plan_id")),
            "disrupted": kpis(scen.get("disrupted_plan_id")),
            "recovered": kpis(scen.get("recovered_plan_id")),
        },
    }


@router.get("/")
def list_scenarios(limit: int = 25, offset: int = 0):
    """Recent scenarios, newest first — powers the dashboard and scenario pickers."""
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    try:
        scenarios = db.list_scenarios(limit=limit, offset=offset)
        plan_ids = [
            plan_id
            for scen in scenarios
            for plan_id in (
                scen.get("baseline_plan_id"),
                scen.get("disrupted_plan_id"),
                scen.get("recovered_plan_id"),
            )
            if plan_id
        ]
        plans = db.get_plan_kpis_by_ids(plan_ids)
        total = db.count_scenarios()
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to read scenarios") from None
    return {
        "scenarios": [_scenario_summary(s, plans) for s in scenarios],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/")
def create_scenario(body: ScenarioCreate):
    requested = _requested_disruptions(body)
    return create_disrupted_scenario(body.baseline_plan_id, requested, body.name)


_SWEEP_RULES = {
    "inventory_shortage": ("reduction_pct", 100.0, "%"),
    "route_delay": ("extra_days", 60.0, "days"),
}


class SweepRequest(BaseModel):
    baseline_plan_id: str
    disruption: DisruptionRequest
    parameter: str
    values: List[float]


@router.post("/sweep")
def sweep_scenario(body: SweepRequest):
    """Re-solve one disruption at several severities; the result is not stored."""
    if body.disruption.type not in _SWEEP_RULES:
        raise HTTPException(
            status_code=400,
            detail="Sensitivity sweeps support inventory_shortage and route_delay only",
        )
    expected, upper, unit = _SWEEP_RULES[body.disruption.type]
    if body.parameter != expected:
        raise HTTPException(
            status_code=400,
            detail=f"{body.disruption.type} varies '{expected}', not '{body.parameter}'",
        )

    values = sorted({round(float(value), 4) for value in body.values})
    if not 2 <= len(values) <= 7:
        raise HTTPException(
            status_code=400,
            detail="Provide between 2 and 7 distinct severity values",
        )
    if any((not math.isfinite(value)) or value < 0 or value > upper for value in values):
        raise HTTPException(
            status_code=400,
            detail=f"Values must be finite and between 0 and {upper:g} {unit}",
        )

    baseline_plan = db.get_plan(body.baseline_plan_id)
    if not baseline_plan:
        raise HTTPException(
            status_code=404,
            detail=f"Baseline plan {body.baseline_plan_id} not found",
        )
    if baseline_plan.get("type") != "baseline":
        raise HTTPException(
            status_code=400,
            detail=f"Plan {body.baseline_plan_id} is a '{baseline_plan.get('type')}' plan; sweeps require a baseline plan",
        )
    dataset = db.get_dataset(baseline_plan["dataset_id"])
    if not dataset:
        raise HTTPException(
            status_code=404,
            detail=f"Dataset {baseline_plan['dataset_id']} not found",
        )

    data = baseline_plan.get("data", {}) or {}
    respect_deadlines = bool(
        (data.get("constraints") or {}).get("respect_deadlines", False)
    )
    solver = baseline_plan.get("solver")
    if solver not in ("greedy", "ortools", "auto"):
        solver = None

    try:
        sweep = run_sensitivity_sweep(
            dataset.get("meta", {}),
            body.disruption,
            body.parameter,
            values,
            respect_deadlines=respect_deadlines,
            solver=solver,
        )
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception:
        raise HTTPException(status_code=500, detail="Sensitivity sweep failed") from None

    return {
        "baseline_plan_id": body.baseline_plan_id,
        "parameter": body.parameter,
        "disruption": body.disruption.model_dump(),
        "respect_deadlines": respect_deadlines,
        **sweep,
        "note": "Ephemeral analysis: each point re-solves the same network; nothing is stored.",
    }


@router.get("/{scenario_id}")
def get_scenario(scenario_id: str):
    scen = db.get_scenario(scenario_id)
    if not scen:
        raise HTTPException(status_code=404, detail=f"Scenario {scenario_id} not found")
    baseline_plan = db.get_plan(scen["baseline_plan_id"]) if scen.get("baseline_plan_id") else None
    disrupted_plan = db.get_plan(scen["disrupted_plan_id"]) if scen.get("disrupted_plan_id") else None
    recovered_plan = db.get_plan(scen["recovered_plan_id"]) if scen.get("recovered_plan_id") else None
    return {"scenario": scen, "baseline_plan": baseline_plan, "disrupted_plan": disrupted_plan, "recovered_plan": recovered_plan}


@router.patch("/{scenario_id}")
def rename_scenario(scenario_id: str, body: ScenarioRename):
    scen = db.get_scenario(scenario_id)
    if not scen:
        raise HTTPException(status_code=404, detail=f"Scenario {scenario_id} not found")
    name = _clean_name(body.name)
    if not name:
        raise HTTPException(status_code=400, detail="Scenario name cannot be blank")
    db.update_scenario(scenario_id, {"name": name})
    record_activity(
        "scenario.renamed",
        "scenario",
        scenario_id,
        {"name": name, "previous_name": scen.get("name")},
    )
    return {"scenario": db.get_scenario(scenario_id)}


@router.delete("/{scenario_id}")
def delete_scenario(scenario_id: str):
    """Delete a scenario and the plans it owns; the baseline plan is untouched."""
    scen = db.get_scenario(scenario_id)
    if not scen:
        raise HTTPException(status_code=404, detail=f"Scenario {scenario_id} not found")

    owned_plan_ids = [
        plan_id
        for plan_id in (scen.get("disrupted_plan_id"), scen.get("recovered_plan_id"))
        if plan_id
    ]
    deleted = db.delete_scenario_with_plans(scenario_id, owned_plan_ids)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Scenario {scenario_id} not found")
    record_activity(
        "scenario.deleted",
        "scenario",
        scenario_id,
        {
            "name": scen.get("name"),
            "deleted_plan_ids": owned_plan_ids,
            "baseline_plan_id": scen.get("baseline_plan_id"),
        },
    )
    return {
        "deleted": True,
        "scenario_id": scenario_id,
        "deleted_plan_ids": owned_plan_ids,
        "baseline_plan_id": scen.get("baseline_plan_id"),
    }


@router.post("/{scenario_id}/recover")
def recover_scenario_route(scenario_id: str):
    return recover_scenario(scenario_id)


@router.get("/{scenario_id}/brief")
def get_scenario_brief(scenario_id: str):
    """Project consumer service exposure and evaluate one-lever manufacturer mitigations."""
    scen = db.get_scenario(scenario_id)
    if not scen:
        raise HTTPException(status_code=404, detail=f"Scenario {scenario_id} not found")
    if not scen.get("disrupted_plan_id"):
        raise HTTPException(status_code=409, detail="Disrupt a baseline before requesting a service brief")

    baseline_plan = db.get_plan(scen["baseline_plan_id"]) if scen.get("baseline_plan_id") else None
    if not baseline_plan:
        raise HTTPException(status_code=404, detail=f"Baseline plan {scen.get('baseline_plan_id')} not found")

    ds = db.get_dataset(baseline_plan["dataset_id"])
    if not ds:
        raise HTTPException(status_code=404, detail=f"Dataset {baseline_plan['dataset_id']} not found")

    try:
        disruptions = _stored_disruptions(scen.get("disruption", {}))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid disruption stored for this scenario") from None

    try:
        return scenario_brief(ds.get("meta", {}), baseline_plan, disruptions, scen)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception:
        raise HTTPException(status_code=500, detail="Could not compute the scenario brief") from None


@router.get("/{scenario_id}/compare")
def compare_scenario(scenario_id: str):
    scen = db.get_scenario(scenario_id)
    if not scen:
        raise HTTPException(status_code=404, detail=f"Scenario {scenario_id} not found")

    baseline_plan = db.get_plan(scen["baseline_plan_id"]) if scen.get("baseline_plan_id") else None
    disrupted_plan = db.get_plan(scen["disrupted_plan_id"]) if scen.get("disrupted_plan_id") else None
    recovered_plan = db.get_plan(scen["recovered_plan_id"]) if scen.get("recovered_plan_id") else None

    if not baseline_plan:
        raise HTTPException(status_code=404, detail="Baseline plan not found for scenario")

    def extract_kpis(plan):
        if not plan:
            return None
        data = plan.get("data", {})
        k = data.get("kpis", {})
        if not k and "fulfillment_rate" in data:
            k = {"fulfillment_rate": data.get("fulfillment_rate"), "total_cost": data.get("total_cost"), "unmet": sum(float(u.get("quantity", 0)) for u in data.get("unmet", []))}
        return k

    baseline_k = extract_kpis(baseline_plan)
    disrupted_k = extract_kpis(disrupted_plan)
    recovered_k = extract_kpis(recovered_plan)

    deltas: Dict[str, Any] = {}
    try:
        if baseline_k and disrupted_k:
            deltas["disrupted_vs_baseline"] = {
                "fulfillment_delta": round(float(disrupted_k.get("fulfillment_rate", 0) or 0) - float(baseline_k.get("fulfillment_rate", 0) or 0), 6),
                "cost_delta": round(float(disrupted_k.get("total_cost", 0) or 0) - float(baseline_k.get("total_cost", 0) or 0), 4),
                "unmet_delta": round(float(disrupted_k.get("unmet", 0) or 0) - float(baseline_k.get("unmet", 0) or 0), 4),
            }
        if disrupted_k and recovered_k:
            deltas["recovered_vs_disrupted"] = {
                "fulfillment_delta": round(float(recovered_k.get("fulfillment_rate", 0) or 0) - float(disrupted_k.get("fulfillment_rate", 0) or 0), 6),
                "cost_delta": round(float(recovered_k.get("total_cost", 0) or 0) - float(disrupted_k.get("total_cost", 0) or 0), 4),
                "unmet_delta": round(float(recovered_k.get("unmet", 0) or 0) - float(disrupted_k.get("unmet", 0) or 0), 4),
            }
        if baseline_k and recovered_k:
            deltas["recovered_vs_baseline"] = {
                "fulfillment_delta": round(float(recovered_k.get("fulfillment_rate", 0) or 0) - float(baseline_k.get("fulfillment_rate", 0) or 0), 6),
                "cost_delta": round(float(recovered_k.get("total_cost", 0) or 0) - float(baseline_k.get("total_cost", 0) or 0), 4),
                "unmet_delta": round(float(recovered_k.get("unmet", 0) or 0) - float(baseline_k.get("unmet", 0) or 0), 4),
            }
    except Exception:
        pass

    narrative = ""
    delivery_risk = {
        "baseline": (baseline_plan or {}).get("data", {}).get("delivery_risk"),
        "disrupted": (disrupted_plan or {}).get("data", {}).get("delivery_risk"),
        "recovered": (recovered_plan or {}).get("data", {}).get("delivery_risk"),
    }
    baseline_late = float((delivery_risk["baseline"] or {}).get("at_risk_units", 0) or 0)
    disrupted_late = float((delivery_risk["disrupted"] or {}).get("at_risk_units", 0) or 0)
    max_late = float((delivery_risk["disrupted"] or {}).get("max_late_days", 0) or 0)

    if baseline_k and disrupted_k:
        base_ful = float(baseline_k.get("fulfillment_rate", 0) or 0) * 100
        dis_ful = float(disrupted_k.get("fulfillment_rate", 0) or 0) * 100
        dis_unmet = float(disrupted_k.get("unmet", 0) or 0)
        dis_cost = float(disrupted_k.get("total_cost", 0) or 0)
        if abs(dis_ful - base_ful) < 0.05 and dis_unmet <= 1e-6:
            if disrupted_late > 0:
                narrative = (
                    f"Fulfillment is unchanged at {dis_ful:.1f}%, but {disrupted_late:.0f} units now miss "
                    f"their destination deadline (up to {max_late:.0f} days late; "
                    f"baseline: {baseline_late:.0f} units late) at ${dis_cost:.2f} total cost. "
                )
            else:
                narrative = (
                    f"Fulfillment is unchanged at {dis_ful:.1f}% and no shipment breaches its deadline. "
                    f"Total cost ${dis_cost:.2f}. "
                )
        else:
            narrative = (
                f"Disruption reduced fulfillment from {base_ful:.1f}% to {dis_ful:.1f}%; "
                f"{dis_unmet:.0f} units remain unmet with total cost ${dis_cost:.2f}. "
            )
            if disrupted_late > baseline_late:
                narrative += f"A further {disrupted_late - baseline_late:.0f} units now breach their deadline. "

    if recovered_k and disrupted_k:
        rec_ful = float(recovered_k.get("fulfillment_rate", 0) or 0) * 100
        dis_ful = float(disrupted_k.get("fulfillment_rate", 0) or 0) * 100
        rec_cost = float(recovered_k.get("total_cost", 0) or 0)
        dis_cost = float(disrupted_k.get("total_cost", 0) or 0)
        extra_cost = rec_cost - dis_cost
        rec_unmet = float(recovered_k.get("unmet", 0) or 0)
        restored = rec_ful - dis_ful
        if restored > 0.01:
            narrative += f"Recovery restored {restored:.1f}% fulfillment at ${extra_cost:+.2f} extra cost. "
        elif extra_cost < -0.5:
            narrative += f"Recovery held fulfillment while saving ${abs(extra_cost):.2f} in transport cost. "
        else:
            narrative += f"Recovery could not improve fulfillment (remains {rec_ful:.1f}%) at ${extra_cost:+.2f} extra cost. "
        if rec_unmet > 0:
            narrative += f"{rec_unmet:.0f} units remain unmet. " + _bottleneck_narrative(recovered_plan)
        else:
            narrative += "All demand is now fulfilled."
    elif disrupted_k and not recovered_k:
        narrative += "No recovery has been run yet; run recovery to attempt restoration."
    if not narrative:
        narrative = "Baseline plan ready. Create a disruption scenario to compare impact."

    def plan_out(plan_id, plan):
        return {
            "plan_id": plan_id,
            "kpis": extract_kpis(plan),
            "plan": plan,
            "solver_status": (plan or {}).get("data", {}).get("status_detail"),
        }

    baseline_out = plan_out(scen["baseline_plan_id"], baseline_plan)
    disrupted_out = plan_out(scen.get("disrupted_plan_id"), disrupted_plan) if disrupted_k else None
    recovered_out = plan_out(scen.get("recovered_plan_id"), recovered_plan) if recovered_k else None

    return {
        "baseline": baseline_out or {},
        "disrupted": disrupted_out or {},
        "recovered": recovered_out,
        "deltas": deltas,
        "delivery_risk": delivery_risk,
        "tradeoff_narrative": narrative.strip(),
    }


def _bottleneck_narrative(plan) -> str:
    """Explain *why* demand is still unmet, using the residual rows themselves."""
    data = (plan or {}).get("data", {})
    unmet = data.get("unmet", []) or []
    if not unmet:
        return ""
    ranked = sorted(unmet, key=lambda u: float(u.get("quantity", 0) or 0), reverse=True)
    top = ranked[:3]
    parts = [
        f"{u.get('destination_id')}×{u.get('product_id')} is short {float(u.get('quantity', 0) or 0):.0f} units"
        f"{' (priority ' + str(u.get('priority')) + ')' if u.get('priority') is not None else ''}"
        for u in top
    ]
    explanation = (
        "Limiting constraints: combined warehouse inventory and available route capacity "
        "cannot cover these rows. Largest gaps: " + "; ".join(parts) + "."
    )
    if len(ranked) > len(top):
        explanation += f" Plus {len(ranked) - len(top)} smaller gap(s)."
    return explanation


@router.get("/{scenario_id}/export")
def export_scenario_file(scenario_id: str):
    """Download the scenario as CSV — allocations, unmet demand and KPIs, baseline → recovered."""
    scen = db.get_scenario(scenario_id)
    if not scen:
        raise HTTPException(status_code=404, detail=f"Scenario {scenario_id} not found")

    plans = {
        "baseline": db.get_plan(scen["baseline_plan_id"]) if scen.get("baseline_plan_id") else None,
        "disrupted": db.get_plan(scen["disrupted_plan_id"]) if scen.get("disrupted_plan_id") else None,
        "recovered": db.get_plan(scen["recovered_plan_id"]) if scen.get("recovered_plan_id") else None,
    }
    ordered = [p for p in plans.values() if p]
    if not ordered:
        raise HTTPException(status_code=404, detail="No plans found for this scenario")

    try:
        payload = export_scenario_csv(scen, ordered)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to export scenario") from None

    filename = f"pre-mortem-scenario-{scenario_id[:8]}.csv"
    return Response(
        content=payload,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
