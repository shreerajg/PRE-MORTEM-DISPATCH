from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.domain.schemas import AllocationInput
from app.repo import database as db
from app.services.allocation import solve_allocation
from app.services.audit import record as record_activity
from app.services.diagnosis import diagnose_unmet
from app.services.kpi import compute_delivery_risk, compute_kpis
from app.services.normalize import build_network, load_deadlines, load_destinations
from app.services.resilience import assess_plan_resilience

router = APIRouter(prefix="/api/v1/plans", tags=["plans"])

_SOLVERS = ("greedy", "ortools", "auto")


class PlanCreateRequest(BaseModel):
    dataset_id: str
    solver: Optional[str] = None
    respect_deadlines: bool = False


def _build_allocation_input(meta: Dict[str, Any], respect_deadlines: bool = False) -> AllocationInput:
    inventory, demand, routes, priorities = build_network(meta)
    return AllocationInput(
        inventory=inventory,
        demand=demand,
        routes=routes,
        priorities=priorities,
        deadlines=load_deadlines(meta),
        respect_deadlines=respect_deadlines,
    )


@router.post("/")
def create_plan(body: PlanCreateRequest):
    ds = db.get_dataset(body.dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail=f"Dataset {body.dataset_id} not found")

    validation_report = (ds.get("meta") or {}).get("validation_report") or {}
    if isinstance(validation_report, dict) and validation_report.get("valid") is False:
        summary = validation_report.get("summary") or {}
        errors = summary.get("errors", "the dataset contains errors")
        raise HTTPException(
            status_code=422,
            detail=(
                f"Dataset {body.dataset_id} failed validation ({errors} error(s)); "
                "correct its CSV data before generating a plan."
            ),
        )
    if body.solver is not None and body.solver not in _SOLVERS:
        raise HTTPException(status_code=400, detail=f"Invalid solver '{body.solver}'; allowed {', '.join(_SOLVERS)}")
    meta = ds.get("meta", {})

    allocation_input = _build_allocation_input(meta, respect_deadlines=body.respect_deadlines)
    result = solve_allocation(allocation_input, solver=body.solver)

    # Compute KPIs
    kpi = compute_kpis(result, allocation_input.inventory, allocation_input.demand, allocation_input.routes)
    delivery_risk = compute_delivery_risk(
        result.allocations, allocation_input.routes, load_destinations(meta)
    )
    unmet_diagnosis = diagnose_unmet(allocation_input, result)

    plan_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()
    solver_used = result.solver

    # Prepare data to save: allocations, unmet, kpis, diagnostics, utilization etc.
    data = {
        "allocations": [a.model_dump() if hasattr(a, "model_dump") else dict(a) for a in result.allocations],
        "unmet": [u.model_dump() if hasattr(u, "model_dump") else dict(u) for u in result.unmet],
        "kpis": kpi.model_dump() if hasattr(kpi, "model_dump") else dict(kpi),
        "diagnostics": result.diagnostics,
        "utilization": result.utilization,
        "fulfillment_rate": result.fulfillment_rate,
        "total_cost": result.total_cost,
        "status_detail": result.status,
        "violations": result.violations,
        "delivery_risk": delivery_risk,
        "unmet_diagnosis": unmet_diagnosis,
        "constraints": {"respect_deadlines": bool(body.respect_deadlines)},
    }

    try:
        db.save_plan(plan_id, body.dataset_id, type="baseline", status="completed", solver=solver_used, created_at=created_at, data=data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save plan: {e}")

    record_activity(
        "plan.created",
        "plan",
        plan_id,
        {
            "dataset_id": body.dataset_id,
            "solver": solver_used,
            "solver_status": result.status,
            "fulfillment_rate": kpi.fulfillment_rate,
            "total_cost": kpi.total_cost,
            "respect_deadlines": bool(body.respect_deadlines),
        },
    )

    return {
        "id": plan_id,
        "dataset_id": body.dataset_id,
        "type": "baseline",
        "status": "completed",
        "solver": solver_used,
        "solver_status": result.status,
        "created_at": created_at,
        "allocations": data["allocations"],
        "unmet": data["unmet"],
        "kpis": data["kpis"],
        "diagnostics": data["diagnostics"],
        "constraints": data["constraints"],
        "unmet_diagnosis": data["unmet_diagnosis"],
    }


@router.get("/")
def list_plans(limit: int = 25, offset: int = 0, plan_type: Optional[str] = None):
    """Recent plans, newest first — powers plan pickers in the UI."""
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    try:
        plans = db.list_plans(limit=limit, plan_type=plan_type, offset=offset)
        total = db.count_plans(plan_type)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"plans": plans, "total": total, "limit": limit, "offset": offset}


@router.get("/{plan_id}")
def get_plan(plan_id: str):
    plan = db.get_plan(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail=f"Plan {plan_id} not found")
    data = plan.get("data", {})
    # Return PlanResponse-like
    kpis = data.get("kpis", {})
    return {
        "id": plan["id"],
        "dataset_id": plan["dataset_id"],
        "type": plan["type"],
        "status": plan["status"],
        "solver": plan["solver"],
        "solver_status": data.get("status_detail"),
        "created_at": plan["created_at"],
        "allocations": data.get("allocations", []),
        "unmet": data.get("unmet", []),
        "kpis": kpis,
        "diagnostics": data.get("diagnostics", {}),
        "utilization": data.get("utilization", {}),
        "delivery_risk": data.get("delivery_risk"),
        "constraints": data.get("constraints", {}),
        "unmet_diagnosis": data.get("unmet_diagnosis", []),
    }


@router.get("/{plan_id}/resilience")
def get_plan_resilience(plan_id: str):
    """Assess how much redundancy and headroom a completed baseline has before it breaks."""
    plan = db.get_plan(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail=f"Plan {plan_id} not found")
    if plan.get("type") != "baseline":
        raise HTTPException(
            status_code=400,
            detail=f"Plan {plan_id} is a '{plan.get('type')}' plan; resilience requires a baseline plan",
        )
    if plan.get("status") != "completed":
        raise HTTPException(status_code=409, detail=f"Plan {plan_id} is not completed")

    ds = db.get_dataset(plan["dataset_id"])
    if not ds:
        raise HTTPException(status_code=404, detail=f"Dataset {plan['dataset_id']} not found")

    try:
        return assess_plan_resilience(ds.get("meta", {}), plan)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Resilience assessment failed: {e}")


@router.delete("/{plan_id}")
def delete_plan(plan_id: str):
    """Delete an unreferenced plan. Scenarios keep their history intact."""
    plan = db.get_plan(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail=f"Plan {plan_id} not found")

    deleted, referenced = db.delete_plan_if_unreferenced(plan_id)
    if referenced:
        raise HTTPException(
            status_code=409,
            detail=f"Plan {plan_id} is referenced by a scenario; delete that scenario first.",
        )
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Plan {plan_id} not found")

    record_activity(
        "plan.deleted",
        "plan",
        plan_id,
        {"dataset_id": plan.get("dataset_id"), "type": plan.get("type")},
    )
    return {"deleted": True, "plan_id": plan_id, "type": plan.get("type")}
