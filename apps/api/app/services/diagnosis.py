"""Explain every unmet row with the constraint that actually bound it.

The diagnosis is computed from the same inputs and the same output as the plan;
it never invents a cause. A cause is only reported when the evidence supports
it (no lane, product filter, deadline, stock, capacity, or sharing with
higher-priority demand).
"""

from __future__ import annotations

from typing import Any, Dict, List

from app.domain.schemas import AllocationInput, AllocationResult

_TOL = 1e-6

_CAUSE_LABELS = {
    "no_route": "no lane reaches this destination",
    "product_not_allowed": "lanes to this destination exclude the product",
    "contingency_only": "only contingency lanes can serve it",
    "deadline_blocked": "every eligible lane misses the deadline",
    "no_inventory": "no reachable stock",
    "inventory_short": "reachable stock is below demand",
    "lane_capacity": "lane capacity is below demand",
    "inventory_shared": "stock was consumed by earlier demand",
    "capacity_shared": "lane capacity was consumed by earlier demand",
    "combined": "stock and lane capacity are jointly binding",
}


def _fmt(value: float) -> str:
    return f"{value:,.0f}" if abs(value - round(value)) < 1e-9 else f"{value:,.2f}"


def _qty(obj: Any) -> float:
    return float(getattr(obj, "quantity", 0) or 0)


def _explain(cause: str, ctx: Dict[str, Any]) -> str:
    dest = ctx["destination_id"]
    product = ctx["product_id"]
    if cause == "no_route":
        return f"No open lane reaches {dest} for {product}."
    if cause == "product_not_allowed":
        return f"Lanes to {dest} do not carry {product} (product filter)."
    if cause == "contingency_only":
        return (
            f"Only contingency lanes can serve {dest}×{product}; they stay dormant "
            "until recovery is run."
        )
    if cause == "deadline_blocked":
        return (
            f"Every eligible lane to {dest} needs more than {_fmt(ctx['deadline_days'])} "
            f"days, so deadline enforcement removes them all."
        )
    if cause == "no_inventory":
        return f"No warehouse with a lane to {dest} holds stock of {product}."
    if cause == "inventory_short":
        return (
            f"Reachable stock of {product} is {_fmt(ctx['reachable_inventory'])} units "
            f"against demand of {_fmt(ctx['demand'])}."
        )
    if cause == "lane_capacity":
        return (
            f"Lane capacity into {dest} is {_fmt(ctx['lane_capacity'])} units against "
            f"demand of {_fmt(ctx['demand'])}."
        )
    if cause == "inventory_shared":
        return (
            f"Only {_fmt(ctx['remaining_inventory'])} units remain of the {_fmt(ctx['shortfall'])} "
            "still unmet — earlier demand rows (priority order) consumed the reachable stock."
        )
    if cause == "capacity_shared":
        return (
            f"Only {_fmt(ctx['remaining_capacity'])} units of lane capacity remain for "
            f"{_fmt(ctx['shortfall'])} unmet — earlier demand rows (priority order, then "
            "quantity) consumed it."
        )
    return (
        f"Reachable stock ({_fmt(ctx['remaining_inventory'])}) and lane capacity "
        f"({_fmt(ctx['remaining_capacity'])}) are both below the {_fmt(ctx['shortfall'])} "
        "units still unmet."
    )


def diagnose_unmet(
    input_data: AllocationInput,
    result: AllocationResult,
    allow_backup: bool = False,
) -> List[Dict[str, Any]]:
    """Return one diagnosis per unmet demand row, in the solver's own order."""
    unmet_rows = list(getattr(result, "unmet", []) or [])
    if not unmet_rows:
        return []

    routes = list(input_data.routes)
    deadlines = input_data.deadlines if input_data.respect_deadlines else {}

    inventory_by_key: Dict[tuple, float] = {}
    for inv in input_data.inventory:
        key = (inv.warehouse_id, inv.product_id)
        inventory_by_key[key] = inventory_by_key.get(key, 0.0) + _qty(inv)

    allocated_by_row: Dict[tuple, float] = {}
    inventory_used: Dict[tuple, float] = {}
    route_used: Dict[str, float] = {}
    for allocation in getattr(result, "allocations", []) or []:
        qty = _qty(allocation)
        key = (allocation.destination_id, allocation.product_id)
        allocated_by_row[key] = allocated_by_row.get(key, 0.0) + qty
        inv_key = (allocation.warehouse_id, allocation.product_id)
        inventory_used[inv_key] = inventory_used.get(inv_key, 0.0) + qty
        route_used[allocation.route_id] = route_used.get(allocation.route_id, 0.0) + qty

    diagnoses: List[Dict[str, Any]] = []
    for unmet in unmet_rows:
        dest = unmet.destination_id
        product = unmet.product_id
        shortfall = _qty(unmet)

        to_destination = [r for r in routes if r.destination_id == dest]
        open_lanes = [r for r in to_destination if r.available]
        product_lanes = [
            r for r in open_lanes
            if not r.product_ids or product in r.product_ids
        ]
        usable = [r for r in product_lanes if allow_backup or not r.backup]

        deadline = deadlines.get(dest)
        deadline_blocked: List[str] = []
        eligible = usable
        if product_lanes and usable and deadline is not None:
            eligible = []
            for route in usable:
                if float(route.time_days) <= float(deadline) + _TOL:
                    eligible.append(route)
                else:
                    deadline_blocked.append(str(route.id))

        # Defaults for evidence; every branch fills what it can substantiate.
        warehouses = {r.warehouse_id for r in (eligible or usable)}
        reachable_inventory = sum(
            qty for (wh, prod), qty in inventory_by_key.items()
            if wh in warehouses and prod == product
        )
        inventory_used_reachable = sum(
            qty for (wh, prod), qty in inventory_used.items()
            if wh in warehouses and prod == product
        )
        lane_capacity = sum(float(r.capacity) for r in (eligible or usable))
        capacity_used = sum(route_used.get(r.id, 0.0) for r in (eligible or usable))
        demand_total = allocated_by_row.get((dest, product), 0.0) + shortfall

        if not to_destination or not open_lanes:
            cause = "no_route"
        elif not product_lanes:
            cause = "product_not_allowed"
        elif not usable:
            cause = "contingency_only"
        elif deadline is not None and not eligible:
            cause = "deadline_blocked"
        elif reachable_inventory <= _TOL:
            cause = "no_inventory"
        else:
            remaining_inventory = max(0.0, reachable_inventory - inventory_used_reachable)
            remaining_capacity = max(0.0, lane_capacity - capacity_used)
            stock_short = reachable_inventory + _TOL < demand_total
            capacity_short = lane_capacity + _TOL < demand_total
            if stock_short and capacity_short:
                cause = "combined"
            elif stock_short:
                cause = "inventory_short"
            elif capacity_short:
                cause = "lane_capacity"
            else:
                stock_left_short = remaining_inventory + _TOL < shortfall
                capacity_left_short = remaining_capacity + _TOL < shortfall
                if stock_left_short and capacity_left_short:
                    cause = "combined"
                elif stock_left_short:
                    cause = "inventory_shared"
                elif capacity_left_short:
                    cause = "capacity_shared"
                else:
                    cause = "combined"

        remaining_inventory = max(0.0, reachable_inventory - inventory_used_reachable)
        remaining_capacity = max(0.0, lane_capacity - capacity_used)
        context = {
            "destination_id": dest,
            "product_id": product,
            "shortfall": shortfall,
            "demand": demand_total,
            "reachable_inventory": reachable_inventory,
            "remaining_inventory": remaining_inventory,
            "lane_capacity": lane_capacity,
            "remaining_capacity": remaining_capacity,
            "deadline_days": deadline if deadline is not None else 0.0,
        }

        diagnoses.append(
            {
                "destination_id": dest,
                "product_id": product,
                "quantity": round(shortfall, 4),
                "priority": unmet.priority,
                "cause": cause,
                "summary": _CAUSE_LABELS[cause],
                "explanation": _explain(cause, context),
                "evidence": {
                    "demand": round(demand_total, 4),
                    "allocated": round(demand_total - shortfall, 4),
                    "unmet": round(shortfall, 4),
                    "reachable_inventory": round(reachable_inventory, 4),
                    "remaining_inventory": round(remaining_inventory, 4),
                    "lane_capacity": round(lane_capacity, 4),
                    "remaining_capacity": round(remaining_capacity, 4),
                    "eligible_lanes": sorted(str(r.id) for r in eligible),
                    "deadline_blocked_lanes": sorted(deadline_blocked),
                    "contingency_lanes": sorted(
                        str(r.id) for r in product_lanes if r.backup and not allow_backup
                    ),
                },
            }
        )

    return diagnoses
