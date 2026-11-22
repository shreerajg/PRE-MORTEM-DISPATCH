from __future__ import annotations

import time
from typing import Any, Dict, List, Tuple

from app.core.config import settings
from app.domain.schemas import (
    AllocationInput,
    AllocationItem,
    AllocationResult,
    Inventory,
    Demand,
    Route,
    UnmetDemand,
)


def _resolve_priority(demand_item: Demand, priorities: Dict[str, int]) -> int:
    # priority 1 is highest (most urgent) for allocation ordering
    # If priorities dict overrides, use it
    if demand_item.destination_id in priorities:
        try:
            p = int(priorities[demand_item.destination_id])
            if 1 <= p <= 5:
                return p
        except Exception:
            pass
    # Derive priority from demand's destination if we had lookup; but Demand doesn't have priority field.
    # Use 3 as default when not overridden
    return 3


def _deadline_diagnostics(input_data: AllocationInput) -> Dict[str, Any]:
    """Report exactly which lanes the hard deadline constraint removed."""
    if not input_data.respect_deadlines:
        return {}
    excluded = set()
    for route in input_data.routes:
        deadline = input_data.deadlines.get(route.destination_id)
        if deadline is not None and float(route.time_days) > float(deadline) + 1e-9:
            excluded.add(str(route.id))
    demand_destinations = {str(d.destination_id) for d in input_data.demand}
    missing = sorted(
        dest for dest in demand_destinations if dest not in input_data.deadlines
    )
    return {
        "deadline_enforced": True,
        "lanes_excluded_by_deadline": sorted(excluded),
        "destinations_without_deadline": missing,
    }


def _try_ortools(
    input_data: AllocationInput,
    priority_map: Dict[Tuple[str, str], int],
    allow_backup: bool = False,
    solver_name: str | None = None,
) -> tuple[AllocationResult | None, str | None]:
    """
    Attempt to solve with OR-Tools linear solver minimizing cost + penalty*unmet_priority_weighted.
    Returns (result, None) on success, or (None, reason) so the caller can report
    exactly why the greedy engine was used instead of guessing.
    """
    active_solver = solver_name or settings.solver
    if active_solver not in ("ortools", "auto"):
        return None, None
    try:
        from ortools.linear_solver import pywraplp
    except ImportError:
        return None, "ortools_not_installed"

    start = time.perf_counter()
    try:
        solver = pywraplp.Solver.CreateSolver("GLOP")
        if solver is None:
            return None, "solver_unavailable"

        # Build indices
        demands = input_data.demand
        inventory = input_data.inventory
        routes = input_data.routes

        # inventory map
        inv_map: Dict[Tuple[str, str], float] = {}
        for inv in inventory:
            key = (inv.warehouse_id, inv.product_id)
            inv_map[key] = inv_map.get(key, 0) + float(inv.quantity)

        # demand map
        dem_list = list(demands)
        route_list = list(routes)

        # Build route lookup by (wh, dst)
        # Variables: x[(i,j)] where i is demand index, j is route index that matches
        # Only allow allocation if route connects a warehouse that has that product and matches product_ids filter

        # Precompute valid (demand_idx, route_idx) pairs
        # Route must go to demand's destination
        # Route's product_ids filter must allow demand's product
        valid_pairs: List[Tuple[int, int]] = []
        # product availability per warehouse
        wh_product_set = set(inv_map.keys())

        for di, dem in enumerate(dem_list):
            for ri, rt in enumerate(route_list):
                if not rt.available:
                    continue
                if rt.backup and not allow_backup:
                    continue
                if rt.destination_id != dem.destination_id:
                    continue
                if input_data.respect_deadlines:
                    deadline = input_data.deadlines.get(dem.destination_id)
                    if deadline is not None and float(rt.time_days) > float(deadline) + 1e-9:
                        continue
                # need at least one warehouse with this product
                # route's warehouse must have inventory for this product
                if (rt.warehouse_id, dem.product_id) not in wh_product_set:
                    continue
                # product_ids filter
                if rt.product_ids is not None and len(rt.product_ids) > 0:
                    if dem.product_id not in rt.product_ids:
                        continue
                valid_pairs.append((di, ri))

        # Create variables
        var_map: Dict[Tuple[int, int], Any] = {}
        for di, ri in valid_pairs:
            dem = dem_list[di]
            var = solver.NumVar(0, float(dem.quantity), f"x_{di}_{ri}")
            var_map[(di, ri)] = var

        # Unmet variables per demand
        unmet_vars: Dict[int, Any] = {}
        for di, dem in enumerate(dem_list):
            uv = solver.NumVar(0, float(dem.quantity), f"unmet_{di}")
            unmet_vars[di] = uv
            # constraint: sum(routes for this demand) + unmet = demand quantity
            relevant = [var_map[(di, ri)] for (d, ri) in valid_pairs if d == di]
            if relevant:
                solver.Add(solver.Sum(relevant) + uv == float(dem.quantity))
            else:
                solver.Add(uv == float(dem.quantity))

        # Inventory constraints: sum allocations using inventory (wh,prod) <= available
        # Group by (warehouse_id, product_id)
        for (wh, prod), avail in inv_map.items():
            relevant = []
            for (di, ri) in valid_pairs:
                rt = route_list[ri]
                dem = dem_list[di]
                if rt.warehouse_id == wh and dem.product_id == prod:
                    relevant.append(var_map[(di, ri)])
            if relevant:
                solver.Add(solver.Sum(relevant) <= float(avail))

        # Route capacity constraints
        for ri, rt in enumerate(route_list):
            relevant = [var_map[(di, r)] for (di, r) in valid_pairs if r == ri]
            if relevant:
                solver.Add(solver.Sum(relevant) <= float(rt.capacity))

        # Objective: minimize cost + penalty * priority_weighted_unmet
        objective = solver.Objective()
        for (di, ri), var in var_map.items():
            rt = route_list[ri]
            objective.SetCoefficient(var, float(rt.cost_per_unit))
        for di, uv in unmet_vars.items():
            # priority 1 highest should have highest penalty
            # need priority for this demand
            dem = dem_list[di]
            pri = priority_map.get((dem.destination_id, dem.product_id), 3)
            # Map 1-> weight 5, 5-> weight 1
            weight = 6 - pri  # 1=>5, 5=>1
            objective.SetCoefficient(uv, float(input_data.penalty_unmet) * weight)
        objective.SetMinimization()

        status = solver.Solve()
        elapsed = time.perf_counter() - start

        if status not in (pywraplp.Solver.OPTIMAL, pywraplp.Solver.FEASIBLE):
            reason = "infeasible" if status == pywraplp.Solver.INFEASIBLE else f"solver_status_{status}"
            return None, reason

        allocations: List[AllocationItem] = []
        route_used: Dict[str, float] = {}
        total_cost = 0.0
        for (di, ri), var in var_map.items():
            qty = float(var.solution_value())
            if qty > 1e-6:
                dem = dem_list[di]
                rt = route_list[ri]
                allocations.append(
                    AllocationItem(
                        warehouse_id=rt.warehouse_id,
                        destination_id=dem.destination_id,
                        product_id=dem.product_id,
                        route_id=rt.id,
                        quantity=round(qty, 6),
                    )
                )
                route_used[rt.id] = route_used.get(rt.id, 0) + qty
                total_cost += qty * float(rt.cost_per_unit)

        unmet: List[UnmetDemand] = []
        total_unmet = 0.0
        total_demand = 0.0
        for di, dem in enumerate(dem_list):
            uv = unmet_vars[di]
            uq = float(uv.solution_value())
            total_demand += float(dem.quantity)
            if uq > 1e-6:
                uq_r = round(uq, 6)
                unmet.append(
                    UnmetDemand(
                        destination_id=dem.destination_id,
                        product_id=dem.product_id,
                        quantity=uq_r,
                        priority=priority_map.get((dem.destination_id, dem.product_id), 3),
                    )
                )
                total_unmet += uq

        fulfillment_rate = ((total_demand - total_unmet) / total_demand) if total_demand > 0 else 1.0

        # utilization — measure used capacity against the lanes this plan could use:
        # available, and contingency lanes only when recovery activated them.
        total_inventory = sum(float(v) for v in inv_map.values())
        used_inventory = total_demand - total_unmet  # simplified
        eligible_routes = [
            r for r in route_list if r.available and (allow_backup or not r.backup)
        ]
        # Warehouse utilization measures the stock this plan could actually ship:
        # only warehouses with at least one eligible lane count toward the denominator,
        # so it is comparable with route utilization (which uses eligible lanes).
        reachable_warehouses = {r.warehouse_id for r in eligible_routes}
        total_reachable_inventory = sum(
            float(qty)
            for (wh, _product), qty in inv_map.items()
            if wh in reachable_warehouses
        )
        wh_util = (
            (used_inventory / total_reachable_inventory)
            if total_reachable_inventory > 0
            else 0.0
        )
        total_route_cap = sum(float(r.capacity) for r in eligible_routes)
        used_route_cap = sum(route_used.values())
        route_util = (used_route_cap / total_route_cap) if total_route_cap > 0 else 0.0

        solver_used = "ortools"
        solver_status = "optimal" if status == pywraplp.Solver.OPTIMAL else "feasible"

        return AllocationResult(
            allocations=allocations,
            unmet=unmet,
            total_cost=round(total_cost, 4),
            fulfillment_rate=round(fulfillment_rate, 6),
            utilization={
                "wh_utilization": round(wh_util, 6),
                "route_utilization": round(route_util, 6),
                "used_inventory": round(used_inventory, 4),
                "total_inventory": round(total_inventory, 4),
                "total_reachable_inventory": round(total_reachable_inventory, 4),
                "used_route_capacity": round(used_route_cap, 4),
                "total_route_capacity": round(total_route_cap, 4),
            },
            status=solver_status,
            solver=solver_used,
            diagnostics={"elapsed_seconds": round(elapsed, 4), "solver": solver_used, "fallback": False},
            violations=[],
        ), None
    except Exception as exc:  # noqa: BLE001 - fall back, but say why
        return None, f"{type(exc).__name__}: {str(exc)[:240]}"


def _greedy_solve(input_data: AllocationInput, priority_map: Dict[Tuple[str, str], int], allow_backup: bool = False) -> AllocationResult:
    start = time.perf_counter()

    inventory = input_data.inventory
    demand = input_data.demand
    # Contingency lanes stay dormant unless recovery explicitly activates them.
    # Unavailable lanes are not part of the usable network and must not inflate
    # the utilization denominator.
    routes = [
        r for r in input_data.routes if r.available and (allow_backup or not r.backup)
    ]

    # inventory map (wh,prod)->qty remaining
    inv_remaining: Dict[Tuple[str, str], float] = {}
    inv_total: Dict[Tuple[str, str], float] = {}
    for inv in inventory:
        key = (inv.warehouse_id, inv.product_id)
        qty = float(inv.quantity)
        inv_remaining[key] = inv_remaining.get(key, 0) + qty
        inv_total[key] = inv_total.get(key, 0) + qty
    total_inventory = sum(inv_total.values())

    # route capacity remaining
    route_remaining: Dict[str, float] = {}
    route_total_cap: Dict[str, float] = {}
    route_obj_map: Dict[str, Route] = {}
    for r in routes:
        cap = float(r.capacity)
        route_remaining[r.id] = cap
        route_total_cap[r.id] = cap
        route_obj_map[r.id] = r
    total_route_cap = sum(route_total_cap.values())

    # Build route index by (wh,dst) with available filter and product_ids filter performed later per demand
    # For each demand sorted by priority (1 highest) then quantity descending
    # Need priority per demand
    def demand_priority(d: Demand) -> int:
        return priority_map.get((d.destination_id, d.product_id), _resolve_priority(d, input_data.priorities))

    # Create enriched demand list
    enriched = []
    for d in demand:
        pri = demand_priority(d)
        enriched.append((pri, float(d.quantity), d))
    # sort by priority ascending (1 highest) then quantity descending
    enriched.sort(key=lambda x: (x[0], -x[1]))

    allocations: List[AllocationItem] = []
    unmet: List[UnmetDemand] = []
    total_cost = 0.0
    total_demand = sum(float(d.quantity) for d in demand)

    for pri, qty, dem in enriched:
        remaining_demand = float(dem.quantity)
        if remaining_demand <= 1e-9:
            continue

        # Find candidate routes for this demand
        candidates: List[Route] = []
        for r in routes:
            if not r.available:
                continue
            if r.destination_id != dem.destination_id:
                continue
            # Hard deadline mode: a lane that cannot arrive in time is not usable.
            if input_data.respect_deadlines:
                deadline = input_data.deadlines.get(dem.destination_id)
                if deadline is not None and float(r.time_days) > float(deadline) + 1e-9:
                    continue
            # product_ids filter
            if r.product_ids is not None and len(r.product_ids) > 0:
                if dem.product_id not in r.product_ids:
                    continue
            # need inventory at route's warehouse for this product
            key = (r.warehouse_id, dem.product_id)
            if inv_remaining.get(key, 0) <= 1e-9:
                # no inventory left for this product at this warehouse, but could still be candidate with 0; skip for efficiency
                # keep if still has capacity but no inventory => no allocation possible, but we filter to avoid useless routes
                continue
            if route_remaining.get(r.id, 0) <= 1e-9:
                continue
            candidates.append(r)

        # sort candidates by cost, then route id so equal-cost lanes are chosen
        # deterministically regardless of the order rows arrived in
        candidates.sort(key=lambda r: (float(r.cost_per_unit), str(r.id)))

        for r in candidates:
            if remaining_demand <= 1e-9:
                break
            key = (r.warehouse_id, dem.product_id)
            avail_inv = inv_remaining.get(key, 0)
            avail_route = route_remaining.get(r.id, 0)
            alloc_qty = min(remaining_demand, avail_inv, avail_route)
            if alloc_qty <= 1e-9:
                continue
            alloc_qty = round(alloc_qty, 6)
            # record allocation
            allocations.append(
                AllocationItem(
                    warehouse_id=r.warehouse_id,
                    destination_id=dem.destination_id,
                    product_id=dem.product_id,
                    route_id=r.id,
                    quantity=alloc_qty,
                )
            )
            # update trackers
            inv_remaining[key] = avail_inv - alloc_qty
            route_remaining[r.id] = avail_route - alloc_qty
            remaining_demand -= alloc_qty
            total_cost += alloc_qty * float(r.cost_per_unit)

        if remaining_demand > 1e-6:
            unmet.append(
                UnmetDemand(
                    destination_id=dem.destination_id,
                    product_id=dem.product_id,
                    quantity=round(remaining_demand, 6),
                    priority=pri,
                )
            )

    total_unmet = sum(float(u.quantity) for u in unmet)
    fulfilled = max(0.0, total_demand - total_unmet)
    fulfillment_rate = (fulfilled / total_demand) if total_demand > 0 else 1.0

    # Warehouse utilization uses the stock this plan could actually ship — only
    # warehouses with at least one eligible lane count toward the denominator, so it
    # is comparable with route utilization (which uses eligible lanes).
    eligible_greedy = [r for r in routes if r.available and (allow_backup or not r.backup)]
    reachable_greedy_wh = {r.warehouse_id for r in eligible_greedy}
    total_reachable_inventory = sum(
        qty for (wh, _product), qty in inv_total.items() if wh in reachable_greedy_wh
    )
    used_inventory = total_inventory - sum(inv_remaining.values())
    wh_util = (
        (used_inventory / total_reachable_inventory)
        if total_reachable_inventory > 0
        else 0.0
    )
    used_route_cap = total_route_cap - sum(route_remaining.values())
    route_util = (used_route_cap / total_route_cap) if total_route_cap > 0 else 0.0

    elapsed = time.perf_counter() - start
    # Greedy is a heuristic: it returns a feasible plan. Claiming optimality here
    # would misreport what the engine actually proved.
    status = "feasible"

    return AllocationResult(
        allocations=allocations,
        unmet=unmet,
        total_cost=round(total_cost, 4),
        fulfillment_rate=round(fulfillment_rate, 6),
        utilization={
            "wh_utilization": round(wh_util, 6),
            "route_utilization": round(route_util, 6),
            "used_inventory": round(used_inventory, 4),
            "total_inventory": round(total_inventory, 4),
            "total_reachable_inventory": round(total_reachable_inventory, 4),
            "used_route_capacity": round(used_route_cap, 4),
            "total_route_capacity": round(total_route_cap, 4),
        },
        status=status,
        solver="greedy",
        diagnostics={"elapsed_seconds": round(elapsed, 4), "solver": "greedy"},
        violations=[],
    )


def solve_allocation(
    input: AllocationInput,
    allow_backup: bool = False,
    solver: str | None = None,
) -> AllocationResult:
    """
    Greedy allocation engine with optional OR-Tools fallback.

    ``allow_backup`` activates contingency lanes. Baseline and disrupted plans use
    primary lanes only; recovery sets this to True to restore fulfillment at premium cost.

    ``solver`` overrides ``settings.solver`` for this call only. Passing the choice
    explicitly keeps request handling concurrency-safe.
    """
    if solver is not None and solver not in ("greedy", "ortools", "auto"):
        raise ValueError(f"Unknown solver '{solver}'; allowed greedy, ortools, auto")
    active_solver = solver or settings.solver

    # Build priority map per (dst,prod)
    priority_map: Dict[Tuple[str, str], int] = {}
    # If priorities override dict provided, use it for all demands from that destination
    for dem in input.demand:
        key = (dem.destination_id, dem.product_id)
        # Check if priorities dict has entry for this destination
        if dem.destination_id in input.priorities:
            try:
                p = int(input.priorities[dem.destination_id])
                if 1 <= p <= 5:
                    priority_map[key] = p
                    continue
            except Exception:
                pass
        # Default priority 3 if not known; if inventory/demand/destinations had priority we would need lookup,
        # but AllocationInput only has priorities dict. So default to 3.
        priority_map[key] = 3

    # Try OR-Tools first if enabled
    ort_result, ort_reason = _try_ortools(
        input, priority_map, allow_backup=allow_backup, solver_name=active_solver
    )
    if ort_result is not None:
        ort_result.diagnostics.update(_deadline_diagnostics(input))
        return ort_result

    # Fallback to greedy
    greedy = _greedy_solve(input, priority_map, allow_backup=allow_backup)
    if allow_backup:
        greedy.diagnostics["backup_lanes_enabled"] = True
    # If ortools was desired but unavailable, keep greedy but mark diagnostics
    if active_solver in ("ortools", "auto"):
        greedy.diagnostics["ortools_attempted"] = True
        greedy.diagnostics["fallback"] = "greedy"
        if ort_reason:
            greedy.diagnostics["fallback_reason"] = ort_reason
    greedy.diagnostics.update(_deadline_diagnostics(input))
    return greedy
