"""Sensitivity analysis over one disruption severity.

Every point is a fresh solve of the same baseline network, so the curve is
computed rather than interpolated. Nothing is persisted.
"""

from __future__ import annotations

from collections import Counter
from typing import Any, Dict, List

from app.domain.schemas import AllocationInput, DisruptionRequest
from app.services.allocation import solve_allocation
from app.services.diagnosis import diagnose_unmet
from app.services.disruption import apply_disruptions
from app.services.kpi import compute_delivery_risk, compute_kpis
from app.services.normalize import build_network, load_deadlines, load_destinations


def run_sensitivity_sweep(
    meta: Dict[str, Any],
    disruption: DisruptionRequest,
    parameter: str,
    values: List[float],
    respect_deadlines: bool = False,
    solver: str | None = None,
) -> Dict[str, Any]:
    inventory, demand, routes, priorities = build_network(meta)
    deadlines = load_deadlines(meta)
    destinations = load_destinations(meta)

    def solve(events: List[DisruptionRequest]):
        if events:
            inv, rts, _ = apply_disruptions(inventory, routes, events)
        else:
            inv, rts = inventory, routes
        allocation_input = AllocationInput(
            inventory=inv,
            demand=demand,
            routes=rts,
            priorities=priorities,
            deadlines=deadlines,
            respect_deadlines=respect_deadlines,
        )
        result = solve_allocation(allocation_input, solver=solver)
        kpi = compute_kpis(result, inv, demand, rts)
        delivery = compute_delivery_risk(result.allocations, rts, destinations)
        diagnosis = diagnose_unmet(allocation_input, result)
        return result, kpi, delivery, diagnosis

    base_result, base_kpi, _, _ = solve([])

    points: List[Dict[str, Any]] = []
    for value in sorted({float(v) for v in values}):
        event = DisruptionRequest(
            type=disruption.type,
            params={**disruption.params, parameter: value},
        )
        result, kpi, delivery, diagnosis = solve([event])
        causes = Counter(d["cause"] for d in diagnosis)
        points.append(
            {
                "value": value,
                "fulfillment_rate": round(float(kpi.fulfillment_rate), 6),
                "unmet": round(float(kpi.unmet), 4),
                "total_cost": round(float(kpi.total_cost), 4),
                "risk_score": round(float(kpi.risk_score), 2),
                "at_risk_units": round(float(delivery["at_risk_units"]), 2),
                "max_late_days": round(float(delivery["max_late_days"]), 2),
                "cause_counts": dict(causes),
                "unmet_rows": len(result.unmet),
            }
        )

    worst = max(points, key=lambda p: (p["unmet"], -p["fulfillment_rate"])) if points else None

    return {
        "solver": base_result.solver,
        "baseline": {
            "fulfillment_rate": round(float(base_kpi.fulfillment_rate), 6),
            "unmet": round(float(base_kpi.unmet), 4),
            "total_cost": round(float(base_kpi.total_cost), 4),
        },
        "points": points,
        "worst": worst,
    }
