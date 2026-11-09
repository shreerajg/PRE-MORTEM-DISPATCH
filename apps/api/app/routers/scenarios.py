from __future__ import annotations

import json
import math
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from app.domain.schemas import AllocationInput, Demand, DisruptionRequest, Inventory, Route, ScenarioCreate, ScenarioRename
from app.repo import database as db
from app.services.advisory import scenario_brief
from app.services.allocation import solve_allocation
from app.services.audit import record as record_activity
from app.services.diagnosis import diagnose_unmet
from app.services.disruption import apply_disruptions
from app.services.kpi import compute_delivery_risk, compute_kpis
from app.services.normalize import build_network, load_deadlines, load_destinations
from app.services.recovery import recover_allocation
from app.services.reporting import export_scenario_csv
from app.services.sensitivity import run_sensitivity_sweep

router = APIRouter(prefix="/api/v1/scenarios", tags=["scenarios"])


def _load_dataset_inventory_routes(dataset_meta: Dict[str, Any]):
    inventory, demand, routes, priorities = build_network(dataset_meta)
    return inventory, demand, routes, priorities


def _load_destinations(dataset_meta: Dict[str, Any]) -> List[Dict[str, Any]]:
    return load_destinations(dataset_meta)


def _requested_disruptions(body: ScenarioCreate) -> List[DisruptionRequest]:
    if body.disruptions:
        return list(body.disruptions)
    assert body.disruption is not None  # guaranteed by ScenarioCreate validation
    return [body.disruption]


def _stored_disruption_payload(events: List[DisruptionRequest]) -> Dict[str, Any]:
    """Single events keep the familiar shape; combinations become a compound event."""
    if len(events) == 1:
        return events[0].model_dump()
    return {"type": "compound", "events": [event.model_dump() for event in events]}


def _stored_disruptions(payload: Dict[str, Any]) -> List[DisruptionRequest]:
    if isinstance(payload, dict) and payload.get("type") == "compound":
        return [DisruptionRequest(**event) for event in payload.get("events", [])]
    return [DisruptionRequest(**payload)]


def _clean_name(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


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
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {
        "scenarios": [_scenario_summary(s, plans) for s in scenarios],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/")
def create_scenario(body: ScenarioCreate):
    baseline_plan = db.get_plan(body.baseline_plan_id)
    if not baseline_plan:
        raise HTTPException(status_code=404, detail=f"Baseline plan {body.baseline_plan_id} not found")
    if baseline_plan.get("type") != "baseline":
        raise HTTPException(
            status_code=400,
            detail=f"Plan {body.baseline_plan_id} is a '{baseline_plan.get('type')}' plan; scenarios require a baseline plan",
        )

    dataset_id = baseline_plan["dataset_id"]
    ds = db.get_dataset(dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail=f"Dataset {dataset_id} for baseline plan not found")

    meta = ds.get("meta", {})
    inventory, demand, routes, priorities = _load_dataset_inventory_routes(meta)

    # A scenario inherits the planning policy of the baseline it branches from:
    # a deadline-enforced baseline must not be compared against a relaxed replan.
    baseline_data = baseline_plan.get("data", {}) or {}
    respect_deadlines = bool(
        (baseline_data.get("constraints") or {}).get("respect_deadlines", False)
    )

    # Validate and apply every requested disruption in order
    requested = _requested_disruptions(body)
    try:
        new_inventory, new_routes, description = apply_disruptions(inventory, routes, requested)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Disruption failed: {e}")

    disrupted_input = AllocationInput(
        inventory=new_inventory,
        demand=demand,
        routes=new_routes,
        priorities=priorities,
        deadlines=load_deadlines(meta),
        respect_deadlines=respect_deadlines,
    )
    disrupted_result = solve_allocation(disrupted_input)
    disrupted_kpi = compute_kpis(disrupted_result, new_inventory, demand, new_routes)
    disrupted_diagnosis = diagnose_unmet(disrupted_input, disrupted_result)

    destinations = _load_destinations(meta)
    # Delivery risk (deadline vs transit time) — KPI signal, never blocks feasibility
    disrupted_delivery = compute_delivery_risk(disrupted_result.allocations, new_routes, destinations)
    baseline_delivery = compute_delivery_risk(baseline_data.get("allocations", []), routes, destinations)

    # Save disrupted plan
    disrupted_plan_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()
    disrupted_data = {
        "allocations": [a.model_dump() if hasattr(a, "model_dump") else dict(a) for a in disrupted_result.allocations],
        "unmet": [u.model_dump() if hasattr(u, "model_dump") else dict(u) for u in disrupted_result.unmet],
        "kpis": disrupted_kpi.model_dump() if hasattr(disrupted_kpi, "model_dump") else dict(disrupted_kpi),
        "diagnostics": disrupted_result.diagnostics,
        "utilization": disrupted_result.utilization,
        "fulfillment_rate": disrupted_result.fulfillment_rate,
        "total_cost": disrupted_result.total_cost,
        "status_detail": disrupted_result.status,
        "violations": disrupted_result.violations,
        "disruption_description": description,
        "delivery_risk": disrupted_delivery,
        "unmet_diagnosis": disrupted_diagnosis,
        "constraints": {"respect_deadlines": respect_deadlines},
    }
    try:
        db.save_plan(disrupted_plan_id, dataset_id, type="disrupted", status="completed", solver=disrupted_result.solver, created_at=created_at, data=disrupted_data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save disrupted plan: {e}")

    # Save scenario
    scenario_id = str(uuid.uuid4())
    disruption_dict = _stored_disruption_payload(requested)
    scenario_name = _clean_name(body.name)
    try:
        db.save_scenario(
            scenario_id,
            body.baseline_plan_id,
            disruption_dict,
            disrupted_plan_id,
            None,
            status="disrupted",
            created_at=created_at,
            name=scenario_name,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save scenario: {e}")

    record_activity(
        "scenario.created",
        "scenario",
        scenario_id,
        {
            "name": scenario_name,
            "baseline_plan_id": body.baseline_plan_id,
            "events": len(requested),
            "fulfillment_rate": disrupted_kpi.fulfillment_rate,
            "unmet": disrupted_kpi.unmet,
        },
    )

    # Compute impact deltas vs baseline
    baseline_kpis = baseline_data.get("kpis", {})
    # Normalize baseline kpis dict if KPISnapshot stored
    if isinstance(baseline_kpis, dict):
        base_fulfillment = float(baseline_kpis.get("fulfillment_rate", 0) or 0)
        base_cost = float(baseline_kpis.get("total_cost", baseline_data.get("total_cost", 0)) or 0)
        base_unmet = float(baseline_kpis.get("unmet", 0) or 0)
    else:
        base_fulfillment = 0
        base_cost = 0
        base_unmet = 0

    disrupted_fulfillment = float(disrupted_kpi.fulfillment_rate)
    disrupted_cost = float(disrupted_kpi.total_cost)
    disrupted_unmet = float(disrupted_kpi.unmet)

    impact = {
        "fulfillment_delta": round(disrupted_fulfillment - base_fulfillment, 6),
        "cost_delta": round(disrupted_cost - base_cost, 4),
        "unmet_delta": round(disrupted_unmet - base_unmet, 4),
        "at_risk_units": disrupted_delivery["at_risk_units"],
        "at_risk_delta": round(disrupted_delivery["at_risk_units"] - baseline_delivery["at_risk_units"], 2),
        "max_late_days": disrupted_delivery["max_late_days"],
        "delivery_risk": disrupted_delivery,
        "disruption_description": description,
    }

    return {"scenario": {"id": scenario_id, "name": scenario_name, "baseline_plan_id": body.baseline_plan_id, "disruption": disruption_dict, "disrupted_plan_id": disrupted_plan_id, "status": "disrupted", "created_at": created_at}, "disrupted_plan": {"id": disrupted_plan_id, "dataset_id": dataset_id, "type": "disrupted", "status": "completed", "solver": disrupted_result.solver, "solver_status": disrupted_result.status, "created_at": created_at, "allocations": disrupted_data["allocations"], "unmet": disrupted_data["unmet"], "kpis": disrupted_data["kpis"], "unmet_diagnosis": disrupted_diagnosis}, "impact": impact}


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
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sweep failed: {e}")

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
    # Fetch plans
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
def recover_scenario(scenario_id: str):
    scen = db.get_scenario(scenario_id)
    if not scen:
        raise HTTPException(status_code=404, detail=f"Scenario {scenario_id} not found")

    disrupted_plan = db.get_plan(scen["disrupted_plan_id"]) if scen.get("disrupted_plan_id") else None
    # If no disrupted_plan, fallback to baseline dataset + disruption replay
    baseline_plan = db.get_plan(scen["baseline_plan_id"])
    if not baseline_plan:
        raise HTTPException(status_code=404, detail=f"Baseline plan {scen['baseline_plan_id']} not found")

    dataset_id = baseline_plan["dataset_id"]
    ds = db.get_dataset(dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail=f"Dataset {dataset_id} not found")
    meta = ds.get("meta", {})
    inventory, demand, routes, priorities = _load_dataset_inventory_routes(meta)
    respect_deadlines = bool(
        ((baseline_plan.get("data", {}) or {}).get("constraints") or {}).get(
            "respect_deadlines", False
        )
    )

    # Re-apply the stored disruption(s) to get the same disrupted inputs (idempotent)
    try:
        replay = _stored_disruptions(scen.get("disruption", {}))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid disruption in scenario: {e}")

    try:
        new_inventory, new_routes, description = apply_disruptions(inventory, routes, replay)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))

    disrupted_input = AllocationInput(
        inventory=new_inventory,
        demand=demand,
        routes=new_routes,
        priorities=priorities,
        deadlines=load_deadlines(meta),
        respect_deadlines=respect_deadlines,
    )

    recovered_result = recover_allocation(
        disrupted_input,
        disrupted_allocations=(disrupted_plan or {}).get("data", {}).get("allocations", []),
    )
    recovered_kpi = compute_kpis(recovered_result, new_inventory, demand, new_routes)
    recovered_delivery = compute_delivery_risk(
        recovered_result.allocations, new_routes, _load_destinations(meta)
    )
    recovered_diagnosis = diagnose_unmet(
        disrupted_input, recovered_result, allow_backup=True
    )

    recovered_plan_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()
    recovered_data = {
        "allocations": [a.model_dump() if hasattr(a, "model_dump") else dict(a) for a in recovered_result.allocations],
        "unmet": [u.model_dump() if hasattr(u, "model_dump") else dict(u) for u in recovered_result.unmet],
        "kpis": recovered_kpi.model_dump() if hasattr(recovered_kpi, "model_dump") else dict(recovered_kpi),
        "diagnostics": recovered_result.diagnostics,
        "utilization": recovered_result.utilization,
        "fulfillment_rate": recovered_result.fulfillment_rate,
        "total_cost": recovered_result.total_cost,
        "status_detail": recovered_result.status,
        "violations": recovered_result.violations,
        "delivery_risk": recovered_delivery,
        "unmet_diagnosis": recovered_diagnosis,
        "constraints": {"respect_deadlines": respect_deadlines},
    }
    try:
        db.save_plan(recovered_plan_id, dataset_id, type="recovered", status="completed", solver=recovered_result.solver, created_at=created_at, data=recovered_data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save recovered plan: {e}")

    # Update scenario
    try:
        db.update_scenario(scenario_id, {"recovered_plan_id": recovered_plan_id, "status": "recovered"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update scenario: {e}")

    recovery_actions = recovered_result.diagnostics.get("recovery_actions", []) if isinstance(recovered_result.diagnostics, dict) else []
    residual_unmet = recovered_data["unmet"]

    record_activity(
        "scenario.recovered",
        "scenario",
        scenario_id,
        {
            "recovered_plan_id": recovered_plan_id,
            "fulfillment_rate": recovered_kpi.fulfillment_rate,
            "residual_units": recovered_kpi.unmet,
            "total_cost": recovered_kpi.total_cost,
            "actions": len(recovery_actions),
        },
    )

    return {"recovered_plan": {"id": recovered_plan_id, "dataset_id": dataset_id, "type": "recovered", "status": "completed", "solver": recovered_result.solver, "solver_status": recovered_result.status, "created_at": created_at, "allocations": recovered_data["allocations"], "unmet": recovered_data["unmet"], "kpis": recovered_data["kpis"], "unmet_diagnosis": recovered_diagnosis}, "recovery_actions": recovery_actions, "residual_unmet": residual_unmet, "residual_diagnosis": recovered_diagnosis}


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
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid disruption in scenario: {e}")

    try:
        return scenario_brief(ds.get("meta", {}), baseline_plan, disruptions, scen)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Scenario brief failed: {e}")


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

    # Deltas
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

    # Narrative
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
            # Volume was preserved — describe the delay exposure instead of a 0% change
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

    # Build baseline/disrupted/recovered dicts for CompareResponse
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
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Export failed: {e}")

    filename = f"pre-mortem-scenario-{scenario_id[:8]}.csv"
    return Response(
        content=payload,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
