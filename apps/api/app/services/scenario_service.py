"""Scenario lifecycle operations shared by the HTTP layer.

Disruption replay, re-solve, KPI computation, diagnosis and persistence live here so
routers stay thin and free of allocation maths.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.domain.schemas import AllocationInput, DisruptionRequest
from app.repo import database as db
from app.services.allocation import solve_allocation
from app.services.audit import record as record_activity
from app.services.diagnosis import diagnose_unmet
from app.services.disruption import apply_disruptions
from app.services.kpi import compute_delivery_risk, compute_kpis
from app.services.normalize import build_network, load_deadlines, load_destinations
from app.services.recovery import recover_allocation


def _load_dataset_inventory_routes(dataset_meta: Dict[str, Any]):
    return build_network(dataset_meta)


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


def create_disrupted_scenario(
    baseline_plan_id: str,
    requested: List[DisruptionRequest],
    name: Optional[str] = None,
) -> dict:
    """Branch a baseline plan with one or more disruptions and persist the result."""
    baseline_plan = db.get_plan(baseline_plan_id)
    if not baseline_plan:
        raise HTTPException(status_code=404, detail=f"Baseline plan {baseline_plan_id} not found")
    if baseline_plan.get("type") != "baseline":
        raise HTTPException(
            status_code=400,
            detail=f"Plan {baseline_plan_id} is a '{baseline_plan.get('type')}' plan; scenarios require a baseline plan",
        )

    dataset_id = baseline_plan["dataset_id"]
    ds = db.get_dataset(dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail=f"Dataset {dataset_id} for baseline plan not found")

    meta = ds.get("meta", {})
    inventory, demand, routes, priorities = _load_dataset_inventory_routes(meta)

    baseline_data = baseline_plan.get("data", {}) or {}
    respect_deadlines = bool(
        (baseline_data.get("constraints") or {}).get("respect_deadlines", False)
    )

    try:
        new_inventory, new_routes, description = apply_disruptions(inventory, routes, requested)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception:
        raise HTTPException(status_code=400, detail="Disruption failed; verify the disruption configuration") from None

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

    destinations = load_destinations(meta)
    disrupted_delivery = compute_delivery_risk(
        disrupted_result.allocations, new_routes, destinations
    )
    baseline_delivery = compute_delivery_risk(
        baseline_data.get("allocations", []), routes, destinations
    )

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
        db.save_plan(
            disrupted_plan_id,
            dataset_id,
            type="disrupted",
            status="completed",
            solver=disrupted_result.solver,
            created_at=created_at,
            data=disrupted_data,
        )
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to save disrupted plan") from None

    scenario_id = str(uuid.uuid4())
    disruption_dict = _stored_disruption_payload(requested)
    scenario_name = _clean_name(name)
    try:
        db.save_scenario(
            scenario_id,
            baseline_plan_id,
            disruption_dict,
            disrupted_plan_id,
            None,
            status="disrupted",
            created_at=created_at,
            name=scenario_name,
        )
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to save scenario") from None

    record_activity(
        "scenario.created",
        "scenario",
        scenario_id,
        {
            "name": scenario_name,
            "baseline_plan_id": baseline_plan_id,
            "events": len(requested),
            "fulfillment_rate": disrupted_kpi.fulfillment_rate,
            "unmet": disrupted_kpi.unmet,
        },
    )

    baseline_kpis = baseline_data.get("kpis", {})
    if isinstance(baseline_kpis, dict):
        base_fulfillment = float(baseline_kpis.get("fulfillment_rate", 0) or 0)
        base_cost = float(baseline_kpis.get("total_cost", baseline_data.get("total_cost", 0)) or 0)
        base_unmet = float(baseline_kpis.get("unmet", 0) or 0)
    else:
        base_fulfillment = 0.0
        base_cost = 0.0
        base_unmet = 0.0

    impact = {
        "fulfillment_delta": round(float(disrupted_kpi.fulfillment_rate) - base_fulfillment, 6),
        "cost_delta": round(float(disrupted_kpi.total_cost) - base_cost, 4),
        "unmet_delta": round(float(disrupted_kpi.unmet) - base_unmet, 4),
        "at_risk_units": disrupted_delivery["at_risk_units"],
        "at_risk_delta": round(
            disrupted_delivery["at_risk_units"] - baseline_delivery["at_risk_units"], 2
        ),
        "max_late_days": disrupted_delivery["max_late_days"],
        "delivery_risk": disrupted_delivery,
        "disruption_description": description,
    }

    return {
        "scenario": {
            "id": scenario_id,
            "name": scenario_name,
            "baseline_plan_id": baseline_plan_id,
            "disruption": disruption_dict,
            "disrupted_plan_id": disrupted_plan_id,
            "status": "disrupted",
            "created_at": created_at,
        },
        "disrupted_plan": {
            "id": disrupted_plan_id,
            "dataset_id": dataset_id,
            "type": "disrupted",
            "status": "completed",
            "solver": disrupted_result.solver,
            "solver_status": disrupted_result.status,
            "created_at": created_at,
            "allocations": disrupted_data["allocations"],
            "unmet": disrupted_data["unmet"],
            "kpis": disrupted_data["kpis"],
            "unmet_diagnosis": disrupted_diagnosis,
        },
        "impact": impact,
    }


def recover_scenario(scenario_id: str) -> dict:
    """Re-plan a disrupted scenario with contingency lanes and persist the recovery."""
    scen = db.get_scenario(scenario_id)
    if not scen:
        raise HTTPException(status_code=404, detail=f"Scenario {scenario_id} not found")

    disrupted_plan = (
        db.get_plan(scen["disrupted_plan_id"]) if scen.get("disrupted_plan_id") else None
    )
    baseline_plan = db.get_plan(scen["baseline_plan_id"])
    if not baseline_plan:
        raise HTTPException(
            status_code=404, detail=f"Baseline plan {scen['baseline_plan_id']} not found"
        )

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

    try:
        replay = _stored_disruptions(scen.get("disruption", {}))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid disruption stored for this scenario") from None

    try:
        new_inventory, new_routes, description = apply_disruptions(inventory, routes, replay)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception:
        raise HTTPException(
            status_code=400, detail="Failed to replay the disruption; verify the stored scenario"
        ) from None

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
        recovered_result.allocations, new_routes, load_destinations(meta)
    )
    recovered_diagnosis = diagnose_unmet(disrupted_input, recovered_result, allow_backup=True)

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
        db.save_plan(
            recovered_plan_id,
            dataset_id,
            type="recovered",
            status="completed",
            solver=recovered_result.solver,
            created_at=created_at,
            data=recovered_data,
        )
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to save recovered plan") from None

    try:
        db.update_scenario(
            scenario_id,
            {"recovered_plan_id": recovered_plan_id, "status": "recovered"},
        )
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to save scenario recovery") from None

    recovery_actions = (
        recovered_result.diagnostics.get("recovery_actions", [])
        if isinstance(recovered_result.diagnostics, dict)
        else []
    )
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

    return {
        "recovered_plan": {
            "id": recovered_plan_id,
            "dataset_id": dataset_id,
            "type": "recovered",
            "status": "completed",
            "solver": recovered_result.solver,
            "solver_status": recovered_result.status,
            "created_at": created_at,
            "allocations": recovered_data["allocations"],
            "unmet": recovered_data["unmet"],
            "kpis": recovered_data["kpis"],
            "unmet_diagnosis": recovered_diagnosis,
        },
        "recovery_actions": recovery_actions,
        "residual_unmet": residual_unmet,
        "residual_diagnosis": recovered_diagnosis,
    }
