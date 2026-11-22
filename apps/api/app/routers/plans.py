from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.repo import database as db
from app.services import plan_service
from app.services.audit import record as record_activity
from app.services.resilience import assess_plan_resilience

router = APIRouter(prefix="/api/v1/plans", tags=["plans"])


class PlanCreateRequest(BaseModel):
    dataset_id: str
    solver: Optional[str] = None
    respect_deadlines: bool = False


@router.post("/")
def create_plan(body: PlanCreateRequest):
    return plan_service.create_plan(
        body.dataset_id,
        solver=body.solver,
        respect_deadlines=body.respect_deadlines,
    )


@router.get("/")
def list_plans(limit: int = 25, offset: int = 0, plan_type: Optional[str] = None):
    """Recent plans, newest first — powers plan pickers in the UI."""
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    try:
        plans = db.list_plans(limit=limit, plan_type=plan_type, offset=offset)
        total = db.count_plans(plan_type)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to read plans") from None
    return {"plans": plans, "total": total, "limit": limit, "offset": offset}


@router.get("/{plan_id}")
def get_plan(plan_id: str):
    plan = db.get_plan(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail=f"Plan {plan_id} not found")
    data = plan.get("data", {})
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

    dataset = db.get_dataset(plan["dataset_id"])
    if not dataset:
        raise HTTPException(status_code=404, detail=f"Dataset {plan['dataset_id']} not found")
    try:
        return assess_plan_resilience(dataset.get("meta", {}), plan)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception:
        raise HTTPException(status_code=500, detail="Resilience assessment failed") from None


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
