"""Plan lifecycle operations shared by the HTTP layer.

Keeping the orchestration here keeps routers thin and free of allocation maths.
Domain failures surface as HTTPException so the router can pass them through
unchanged.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from app.domain.schemas import AllocationInput
from app.repo import database as db
from app.services.allocation import solve_allocation
from app.services.audit import record as record_activity
from app.services.diagnosis import diagnose_unmet
from app.services.kpi import compute_delivery_risk, compute_kpis
from app.services.normalize import build_network, load_deadlines, load_destinations

_SOLVERS = ("greedy", "ortools", "auto")


def _build_allocation_input(meta, respect_deadlines: bool = False) -> AllocationInput:
    inventory, demand, routes, priorities = build_network(meta)
    return AllocationInput(
        inventory=inventory,
        demand=demand,
        routes=routes,
        priorities=priorities,
        deadlines=load_deadlines(meta),
        respect_deadlines=respect_deadlines,
    )


def create_plan(
    dataset_id: str,
    solver: str | None = None,
    respect_deadlines: bool = False,
) -> dict:
    """Solve a baseline plan for a dataset and persist it."""
    ds = db.get_dataset(dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail=f"Dataset {dataset_id} not found")

    validation_report = (ds.get("meta") or {}).get("validation_report") or {}
    if isinstance(validation_report, dict) and validation_report.get("valid") is False:
        summary = validation_report.get("summary") or {}
        errors = summary.get("errors", "the dataset contains errors")
        raise HTTPException(
            status_code=422,
            detail=(
                f"Dataset {dataset_id} failed validation ({errors} error(s)); "
                "correct its CSV data before generating a plan."
            ),
        )
    if solver is not None and solver not in _SOLVERS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid solver '{solver}'; allowed {', '.join(_SOLVERS)}",
        )
    meta = ds.get("meta", {})

    allocation_input = _build_allocation_input(meta, respect_deadlines=respect_deadlines)
    result = solve_allocation(allocation_input, solver=solver)

    kpi = compute_kpis(
        result, allocation_input.inventory, allocation_input.demand, allocation_input.routes
    )
    delivery_risk = compute_delivery_risk(
        result.allocations, allocation_input.routes, load_destinations(meta)
    )
    unmet_diagnosis = diagnose_unmet(allocation_input, result)

    plan_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()
    solver_used = result.solver

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
        "constraints": {"respect_deadlines": bool(respect_deadlines)},
    }

    try:
        db.save_plan(
            plan_id,
            dataset_id,
            type="baseline",
            status="completed",
            solver=solver_used,
            created_at=created_at,
            data=data,
        )
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to save plan") from None

    record_activity(
        "plan.created",
        "plan",
        plan_id,
        {
            "dataset_id": dataset_id,
            "solver": solver_used,
            "solver_status": result.status,
            "fulfillment_rate": kpi.fulfillment_rate,
            "total_cost": kpi.total_cost,
            "respect_deadlines": bool(respect_deadlines),
        },
    )

    return {
        "id": plan_id,
        "dataset_id": dataset_id,
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
