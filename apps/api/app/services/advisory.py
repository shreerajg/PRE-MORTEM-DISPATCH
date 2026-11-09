"""Consumer service exposure and solver-tested mitigations for a disrupted scenario.

A recommendation is not advice generated from a template. Each option mutates a
deep copy of the disrupted planning inputs, re-solves the network, and reports
only the effect that the solver actually achieved. Nothing is persisted.
"""

from __future__ import annotations

import copy
from typing import Any, Dict, Iterable, List, Optional, Tuple

from app.domain.schemas import AllocationInput, Inventory
from app.services.allocation import solve_allocation
from app.services.diagnosis import diagnose_unmet
from app.services.kpi import compute_delivery_risk, compute_kpis
from app.services.normalize import build_network, load_deadlines, load_destinations

_TOL = 1e-6
_MAX_CANDIDATES = 6


def _attr(obj: Any, field: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(field, default)
    return getattr(obj, field, default)


def _num(obj: Any, field: str, default: float = 0.0) -> float:
    try:
        return float(_attr(obj, field, default) or 0)
    except (TypeError, ValueError):
        return default


def _priority(value: Any) -> int:
    try:
        return max(1, min(5, int(float(value or 3))))
    except (TypeError, ValueError):
        return 3


def _weight(priority: int) -> int:
    return max(1, 6 - priority)


def _name_map(rows: Iterable[Any]) -> Dict[str, str]:
    return {
        str(_attr(row, "id")): str(_attr(row, "name") or _attr(row, "id"))
        for row in rows or []
        if _attr(row, "id") is not None
    }


def _label(key: Any, names: Dict[str, str]) -> str:
    key_str = str(key)
    name = names.get(key_str, key_str)
    return f"{name} ({key_str})" if name and name != key_str else key_str


def _fulfilled_units(demand: List[Any], unmet: List[Any]) -> float:
    total_demand = sum(_num(row, "quantity") for row in demand)
    unmet_total = sum(_num(row, "quantity") for row in unmet)
    return max(0.0, total_demand - unmet_total)


def _on_time_units(
    allocations: Iterable[Any],
    route_by_id: Dict[str, Any],
    deadlines: Dict[str, float],
) -> float:
    total = 0.0
    for allocation in allocations or []:
        qty = _num(allocation, "quantity")
        if qty <= _TOL:
            continue
        route = route_by_id.get(str(_attr(allocation, "route_id")))
        if route is None:
            continue
        deadline = deadlines.get(str(_attr(allocation, "destination_id")))
        if deadline is None or _num(route, "time_days") <= float(deadline) + _TOL:
            total += qty
    return total


def compute_service_projection(
    meta: Dict[str, Any],
    demand: List[Any],
    allocations: List[Any],
    unmet: List[Any],
    delivery_risk: Dict[str, Any],
    diagnoses: List[Dict[str, Any]],
    routes: List[Any],
    deadlines: Dict[str, float],
) -> Dict[str, Any]:
    destination_names = _name_map(meta.get("destinations", []))
    product_names = _name_map(meta.get("products", []))
    destinations = {str(_attr(d, "id")): _priority(_attr(d, "priority")) for d in load_destinations(meta)}
    route_by_id = {str(_attr(r, "id")): r for r in routes}

    demand_by_dest: Dict[str, float] = {}
    demand_by_product: Dict[str, float] = {}
    for row in demand:
        dest = str(_attr(row, "destination_id"))
        product = str(_attr(row, "product_id"))
        qty = _num(row, "quantity")
        demand_by_dest[dest] = demand_by_dest.get(dest, 0.0) + qty
        demand_by_product[product] = demand_by_product.get(product, 0.0) + qty

    fulfilled_by_dest: Dict[str, float] = {}
    fulfilled_by_product: Dict[str, float] = {}
    late_by_dest: Dict[str, float] = {}
    for allocation in allocations:
        dest = str(_attr(allocation, "destination_id"))
        product = str(_attr(allocation, "product_id"))
        qty = _num(allocation, "quantity")
        fulfilled_by_dest[dest] = fulfilled_by_dest.get(dest, 0.0) + qty
        fulfilled_by_product[product] = fulfilled_by_product.get(product, 0.0) + qty
        route = route_by_id.get(str(_attr(allocation, "route_id")))
        deadline = deadlines.get(dest)
        if route is not None and deadline is not None and _num(route, "time_days") > float(deadline) + _TOL:
            late_by_dest[dest] = late_by_dest.get(dest, 0.0) + qty

    unmet_by_dest: Dict[str, float] = {}
    unmet_by_product: Dict[str, float] = {}
    critical_unmet = 0.0
    unmet_destinations: set[str] = set()
    unmet_products: set[str] = set()
    for row in unmet:
        dest = str(_attr(row, "destination_id"))
        product = str(_attr(row, "product_id"))
        qty = _num(row, "quantity")
        priority = _priority(_attr(row, "priority"))
        unmet_by_dest[dest] = unmet_by_dest.get(dest, 0.0) + qty
        unmet_by_product[product] = unmet_by_product.get(product, 0.0) + qty
        if priority <= 2:
            critical_unmet += qty
        unmet_destinations.add(dest)
        unmet_products.add(product)

    total_demand = sum(demand_by_dest.values())
    fulfilled = _fulfilled_units(demand, unmet)
    late_units = float(delivery_risk.get("at_risk_units", 0.0) or 0.0)
    on_time = max(0.0, fulfilled - late_units)
    coverage = fulfilled / total_demand if total_demand > _TOL else 1.0
    on_time_rate = on_time / total_demand if total_demand > _TOL else 1.0

    diagnosis_by_row = {
        f"{d['destination_id']}:{d['product_id']}": d for d in diagnoses
    }
    impacted_destinations = []
    for dest in sorted({*demand_by_dest, *unmet_by_dest}):
        dest_demand = demand_by_dest.get(dest, 0.0)
        dest_fulfilled = fulfilled_by_dest.get(dest, 0.0)
        dest_unmet = unmet_by_dest.get(dest, 0.0)
        dest_late = late_by_dest.get(dest, 0.0)
        dest_on_time = max(0.0, dest_fulfilled - dest_late)
        priority = destinations.get(dest, 3)
        impacted_destinations.append(
            {
                "destination_id": dest,
                "name": destination_names.get(dest, dest),
                "priority": priority,
                "demand": round(dest_demand, 4),
                "fulfilled": round(dest_fulfilled, 4),
                "unmet": round(dest_unmet, 4),
                "late": round(dest_late, 4),
                "coverage_rate": round(dest_fulfilled / dest_demand, 6) if dest_demand > _TOL else 1.0,
                "on_time_rate": round(dest_on_time / dest_demand, 6) if dest_demand > _TOL else 1.0,
            }
        )
    impacted_destinations.sort(
        key=lambda row: (
            -_num(row, "unmet"),
            -_num(row, "late"),
            row["priority"],
            -_num(row, "demand"),
            row["destination_id"],
        )
    )

    impacted_products = []
    for product in sorted({*demand_by_product, *unmet_by_product}):
        prod_demand = demand_by_product.get(product, 0.0)
        prod_fulfilled = fulfilled_by_product.get(product, 0.0)
        prod_unmet = unmet_by_product.get(product, 0.0)
        impacted_products.append(
            {
                "product_id": product,
                "name": product_names.get(product, product),
                "demand": round(prod_demand, 4),
                "fulfilled": round(prod_fulfilled, 4),
                "unmet": round(prod_unmet, 4),
                "coverage_rate": round(prod_fulfilled / prod_demand, 6) if prod_demand > _TOL else 1.0,
            }
        )
    impacted_products.sort(key=lambda row: (-_num(row, "unmet"), -_num(row, "demand"), row["product_id"]))

    gap_rows = []
    for row in unmet:
        dest = str(_attr(row, "destination_id"))
        product = str(_attr(row, "product_id"))
        diagnosis = diagnosis_by_row.get(f"{dest}:{product}")
        quantity = _num(row, "quantity")
        priority = _priority(_attr(row, "priority"))
        gap_rows.append(
            {
                "destination_id": dest,
                "destination_name": destination_names.get(dest, dest),
                "product_id": product,
                "product_name": product_names.get(product, product),
                "quantity": round(quantity, 4),
                "priority": priority,
                "demand": round(demand_by_dest.get(dest, 0.0), 4),
                "cause": diagnosis.get("cause") if diagnosis else "not_diagnosed",
                "summary": diagnosis.get("summary") if diagnosis else "Constraint cause unavailable",
                "explanation": diagnosis.get("explanation") if diagnosis else "",
            }
        )
    gap_rows.sort(key=lambda row: (-row["quantity"] * _weight(row["priority"]), row["priority"], row["destination_id"]))

    unmet_units = sum(unmet_by_dest.values())
    if total_demand <= _TOL:
        statement = "This dataset has no demand rows, so there is no consumer service volume to project."
    elif on_time_rate >= 1 - 1e-6:
        statement = (
            f"All {total_demand:,.0f} modelled demand units are covered and arrive by their destination deadline."
        )
    else:
        worst = gap_rows[0] if gap_rows else None
        statement = (
            f"{on_time:,.0f} of {total_demand:,.0f} units ({on_time_rate * 100:.1f}%) would be complete and on time. "
            f"{fulfilled - on_time:,.0f} shipped units miss a deadline and {unmet_units:,.0f} are not served"
        )
        if critical_unmet > _TOL:
            statement += f", including {critical_unmet:,.0f} units at priority 1–2 destinations"
        if worst:
            statement += (
                f". Largest service gap: {worst['destination_name']} × {worst['product_name']} "
                f"({worst['quantity']:,.0f} units)"
            )
        statement += "."

    return {
        "total_demand": round(total_demand, 4),
        "fulfilled": round(fulfilled, 4),
        "unmet": round(unmet_units, 4),
        "late_units": round(late_units, 4),
        "on_time_units": round(on_time, 4),
        "coverage_rate": round(coverage, 6),
        "on_time_rate": round(on_time_rate, 6),
        "critical_unmet_units": round(critical_unmet, 4),
        "affected_destinations": len(unmet_destinations),
        "late_destinations": len({d for d, qty in late_by_dest.items() if qty > _TOL}),
        "affected_products": len(unmet_products),
        "impacted_destinations": impacted_destinations[:12],
        "impacted_products": impacted_products[:12],
        "largest_gaps": gap_rows[:12],
        "statement": statement,
        "model": {
            "coverage": "fulfilled units / total demand units",
            "on_time": "fulfilled units whose route transit meets destination.deadline_days",
            "consumer_scope": "modelled destination demand, not named individual consumers",
        },
    }


def _empty_candidate(kind: str, target: str) -> Dict[str, Any]:
    return {
        "kind": kind,
        "target": target,
        "targeted_units": 0.0,
        "late_targeted_units": 0.0,
        "priority": 5,
        "rows": {},
        "evidence": {},
        "payload": {},
    }


def _add_candidate(
    candidates: Dict[str, Dict[str, Any]],
    kind: str,
    target: str,
    *,
    quantity: float,
    priority: int,
    late_quantity: float = 0.0,
    destination_id: str,
    product_id: str,
    evidence: Dict[str, Any],
    payload: Dict[str, Any],
) -> None:
    candidate = candidates.setdefault(kind + ":" + target, _empty_candidate(kind, target))
    candidate["targeted_units"] += quantity
    candidate["late_targeted_units"] += late_quantity
    candidate["priority"] = min(candidate["priority"], priority)
    row_key = f"{destination_id}:{product_id}"
    row = candidate["rows"].setdefault(
        row_key,
        {
            "destination_id": destination_id,
            "product_id": product_id,
            "quantity": 0.0,
            "late_quantity": 0.0,
            "priority": priority,
        },
    )
    row["quantity"] += quantity
    row["late_quantity"] += late_quantity
    row["priority"] = min(row["priority"], priority)
    candidate["evidence"].update(evidence)
    candidate["payload"].update(payload)


def _build_candidates(
    meta: Dict[str, Any],
    disrupted_input: AllocationInput,
    disrupted_result: Any,
    baseline_routes: List[Any],
    delivery_risk: Dict[str, Any],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    diagnoses = diagnose_unmet(disrupted_input, disrupted_result)
    candidates: Dict[str, Dict[str, Any]] = {}
    route_by_id = {str(_attr(r, "id")): r for r in baseline_routes}
    disrupted_route_by_id = {str(_attr(r, "id")): r for r in disrupted_input.routes}

    for diagnosis in diagnoses:
        dest = str(diagnosis["destination_id"])
        product = str(diagnosis["product_id"])
        quantity = float(diagnosis["quantity"])
        priority = _priority(diagnosis.get("priority"))
        evidence = diagnosis.get("evidence", {}) or {}
        cause = diagnosis["cause"]
        eligible = [route_by_id.get(str(r)) for r in evidence.get("eligible_lanes", [])]
        eligible = [r for r in eligible if r is not None]

        for lane in evidence.get("contingency_lanes", []) or []:
            lane_id = str(lane)
            route = disrupted_route_by_id.get(lane_id) or route_by_id.get(lane_id)
            if route is None or not bool(_attr(route, "backup", False)):
                continue
            _add_candidate(
                candidates,
                "activate_contingency_lane",
                lane_id,
                quantity=quantity,
                priority=priority,
                destination_id=dest,
                product_id=product,
                evidence={"cause": cause, "diagnosis": diagnosis.get("explanation", "")},
                payload={"route_id": lane_id},
            )

        if cause in {"lane_capacity", "capacity_shared", "combined"}:
            for route in eligible[:2]:
                route_id = str(_attr(route, "id"))
                _add_candidate(
                    candidates,
                    "increase_route_capacity",
                    route_id,
                    quantity=quantity,
                    priority=priority,
                    destination_id=dest,
                    product_id=product,
                    evidence={"cause": cause, "diagnosis": diagnosis.get("explanation", "")},
                    payload={"route_id": route_id, "additional_capacity": round(quantity, 4)},
                )

        if cause in {"no_inventory", "inventory_short", "inventory_shared", "combined"}:
            for route in eligible[:2]:
                warehouse = str(_attr(route, "warehouse_id"))
                route_id = str(_attr(route, "id"))
                _add_candidate(
                    candidates,
                    "add_inventory_buffer",
                    f"{warehouse}:{product}",
                    quantity=quantity,
                    priority=priority,
                    destination_id=dest,
                    product_id=product,
                    evidence={"cause": cause, "diagnosis": diagnosis.get("explanation", "")},
                    payload={
                        "warehouse_id": warehouse,
                        "product_id": product,
                        "additional_units": round(quantity, 4),
                        "access_lane": route_id,
                    },
                )

        if cause == "deadline_blocked":
            deadline = evidence.get("deadline_days")
            for lane in evidence.get("deadline_blocked_lanes", []) or []:
                lane_id = str(lane)
                _add_candidate(
                    candidates,
                    "expedite_lane",
                    lane_id,
                    quantity=quantity,
                    priority=priority,
                    destination_id=dest,
                    product_id=product,
                    evidence={"cause": cause, "diagnosis": diagnosis.get("explanation", "")},
                    payload={
                        "route_id": lane_id,
                        "target_time_days": float(deadline) if deadline is not None else 0.0,
                        "target_reason": "destination_deadline",
                    },
                )

    late_by_route: Dict[str, Dict[str, Any]] = {}
    for shipment in delivery_risk.get("at_risk_shipments", []) or []:
        route_id = str(_attr(shipment, "route_id"))
        dest = str(_attr(shipment, "destination_id"))
        qty = _num(shipment, "quantity")
        entry = late_by_route.setdefault(route_id, {"late": 0.0, "priority": 5, "dest": dest})
        entry["late"] += qty
        entry["priority"] = min(entry["priority"], _priority(_attr(shipment, "priority", 3)))

    route_by_id = {str(_attr(r, "id")): r for r in disrupted_input.routes}
    baseline_by_id = {str(_attr(r, "id")): r for r in baseline_routes}
    deadlines = disrupted_input.deadlines
    for route_id, late in late_by_route.items():
        route = route_by_id.get(route_id)
        original = baseline_by_id.get(route_id)
        if route is None:
            continue
        deadline = deadlines.get(late["dest"])
        original_time = _num(original, "time_days") if original else _num(route, "time_days")
        target = min(
            _num(route, "time_days"),
            original_time,
            float(deadline) if deadline is not None else _num(route, "time_days"),
        )
        if target >= _num(route, "time_days") - _TOL:
            continue
        _add_candidate(
            candidates,
            "expedite_lane",
            route_id,
            quantity=0.0,
            priority=late["priority"],
            late_quantity=late["late"],
            destination_id=late["dest"],
            product_id="*",
            evidence={"cause": "late_shipment", "late_units": round(late["late"], 4)},
            payload={"route_id": route_id, "target_time_days": round(target, 4), "target_reason": "baseline_or_deadline"},
        )

    ranked = sorted(
        candidates.values(),
        key=lambda item: (
            sum(_row["quantity"] * _weight(_row["priority"]) + _row["late_quantity"] for _row in item["rows"].values()),
            item["targeted_units"] + item["late_targeted_units"],
            -len(item["rows"]),
            item["target"],
        ),
        reverse=True,
    )
    return ranked[:_MAX_CANDIDATES], diagnoses


def _apply_candidate(
    candidate: Dict[str, Any],
    inventory: List[Any],
    routes: List[Any],
) -> Tuple[List[Any], List[Any]]:
    new_inventory = copy.deepcopy(inventory)
    new_routes = copy.deepcopy(routes)
    kind = candidate["kind"]
    payload = candidate["payload"]

    if kind == "activate_contingency_lane":
        route_id = str(payload["route_id"])
        for route in new_routes:
            if str(_attr(route, "id")) == route_id:
                _set_attr(route, "backup", False)
                break

    elif kind == "increase_route_capacity":
        route_id = str(payload["route_id"])
        units = max(0.0, float(payload.get("additional_capacity", 0.0)))
        for route in new_routes:
            if str(_attr(route, "id")) == route_id:
                _set_attr(route, "capacity", _num(route, "capacity") + units)
                break

    elif kind == "add_inventory_buffer":
        warehouse = str(payload["warehouse_id"])
        product = str(payload["product_id"])
        units = max(0.0, float(payload.get("additional_units", 0.0)))
        for row in new_inventory:
            if str(_attr(row, "warehouse_id")) == warehouse and str(_attr(row, "product_id")) == product:
                _set_attr(row, "quantity", _num(row, "quantity") + units)
                break
        else:
            new_inventory.append(
                Inventory(warehouse_id=warehouse, product_id=product, quantity=units)
            )

    elif kind == "expedite_lane":
        route_id = str(payload["route_id"])
        target = max(0.0, float(payload.get("target_time_days", 0.0)))
        for route in new_routes:
            if str(_attr(route, "id")) == route_id:
                if target < _num(route, "time_days"):
                    _set_attr(route, "time_days", target)
                break

    return new_inventory, new_routes


def _set_attr(obj: Any, field: str, value: Any) -> None:
    if isinstance(obj, dict):
        obj[field] = value
    else:
        setattr(obj, field, value)


def _action_for_candidate(candidate: Dict[str, Any]) -> Tuple[str, str, str]:
    kind = candidate["kind"]
    target = candidate["target"]
    payload = candidate["payload"]
    if kind == "activate_contingency_lane":
        return kind, f"Activate contingency lane {target}", "Re-solve with this one pre-negotiated backup lane available."
    if kind == "increase_route_capacity":
        return kind, f"Add {payload.get('additional_capacity', 0):,.0f} units of capacity to {target}", "Re-solve after increasing only this ordinary lane's throughput."
    if kind == "add_inventory_buffer":
        return kind, f"Add {payload.get('additional_units', 0):,.0f} units of {payload.get('product_id')} at {payload.get('warehouse_id')}", "Re-solve after creating inventory at a warehouse with an eligible lane."
    return kind, f"Expedite {target}", "Re-solve after reducing this lane's transit time to its tested target."


def _row_labels(rows: Dict[str, Dict[str, Any]], meta: Dict[str, Any]) -> List[Dict[str, Any]]:
    destination_names = _name_map(meta.get("destinations", []))
    product_names = _name_map(meta.get("products", []))
    out = []
    for row in rows.values():
        out.append(
            {
                **row,
                "quantity": round(row["quantity"], 4),
                "late_quantity": round(row["late_quantity"], 4),
                "destination_name": destination_names.get(row["destination_id"], row["destination_id"]),
                "product_name": product_names.get(row["product_id"], row["product_id"]),
            }
        )
    out.sort(key=lambda row: (-(row["quantity"] * _weight(row["priority"]) + row["late_quantity"]), row["destination_id"]))
    return out[:8]


def build_mitigation_recommendations(
    meta: Dict[str, Any],
    disrupted_input: AllocationInput,
    disrupted_result: Any,
    disrupted_delivery: Dict[str, Any],
    baseline_routes: List[Any],
    solver: Optional[str],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    candidates, diagnoses = _build_candidates(
        meta, disrupted_input, disrupted_result, baseline_routes, disrupted_delivery
    )
    total_demand = sum(_num(row, "quantity") for row in disrupted_input.demand)
    route_by_id = {str(_attr(r, "id")): r for r in disrupted_input.routes}
    disrupted_fulfilled = _fulfilled_units(disrupted_input.demand, disrupted_result.unmet)
    disrupted_on_time = _on_time_units(disrupted_result.allocations, route_by_id, disrupted_input.deadlines)
    disrupted_late = float(disrupted_delivery.get("at_risk_units", 0.0) or 0.0)

    results: List[Dict[str, Any]] = []
    for candidate in candidates:
        candidate_inventory, candidate_routes = _apply_candidate(
            candidate, disrupted_input.inventory, disrupted_input.routes
        )
        candidate_input = AllocationInput(
            inventory=candidate_inventory,
            demand=disrupted_input.demand,
            routes=candidate_routes,
            priorities=disrupted_input.priorities,
            deadlines=disrupted_input.deadlines,
            respect_deadlines=disrupted_input.respect_deadlines,
            penalty_unmet=disrupted_input.penalty_unmet,
        )
        candidate_result = solve_allocation(candidate_input, allow_backup=False, solver=solver)
        candidate_delivery = compute_delivery_risk(
            candidate_result.allocations,
            candidate_routes,
            load_destinations(meta),
        )
        candidate_route_by_id = {str(_attr(r, "id")): r for r in candidate_routes}
        candidate_fulfilled = _fulfilled_units(disrupted_input.demand, candidate_result.unmet)
        candidate_on_time = _on_time_units(
            candidate_result.allocations, candidate_route_by_id, disrupted_input.deadlines
        )
        restored = max(0.0, candidate_fulfilled - disrupted_fulfilled)
        on_time_restored = max(0.0, candidate_on_time - disrupted_on_time)
        late_reduced = max(0.0, disrupted_late - float(candidate_delivery.get("at_risk_units", 0.0) or 0.0))
        cost_delta = round(_num(candidate_result, "total_cost") - _num(disrupted_result, "total_cost"), 4)
        improvement_units = max(restored, on_time_restored)
        status = (
            "validated"
            if restored > _TOL or on_time_restored > _TOL
            else "no_effect"
        )
        kind, title, description = _action_for_candidate(candidate)

        effect = {
            "restored_units": round(restored, 4),
            "on_time_restored_units": round(on_time_restored, 4),
            "late_units_reduced": round(late_reduced, 4),
            "cost_delta": cost_delta,
            "cost_per_restored_unit": round(max(0.0, cost_delta) / restored, 4) if restored > _TOL else None,
        }
        results.append(
            {
                "id": f"{kind}:{candidate['target']}",
                "kind": kind,
                "title": title,
                "description": description,
                "tested": True,
                "status": status,
                "solver": candidate_result.solver,
                "solver_status": candidate_result.status,
                "action": candidate["payload"],
                "targeted_units": round(candidate["targeted_units"], 4),
                "rows": _row_labels(candidate["rows"], meta),
                "evidence": candidate["evidence"],
                "baseline_projection": {
                    "coverage_rate": round(disrupted_fulfilled / total_demand, 6) if total_demand > _TOL else 1.0,
                    "on_time_rate": round(disrupted_on_time / total_demand, 6) if total_demand > _TOL else 1.0,
                    "unmet": round(sum(_num(u, "quantity") for u in disrupted_result.unmet), 4),
                    "late_units": round(disrupted_late, 4),
                    "total_cost": round(_num(disrupted_result, "total_cost"), 4),
                },
                "projected": {
                    "coverage_rate": round(candidate_result.fulfillment_rate, 6),
                    "on_time_rate": round(candidate_on_time / total_demand, 6) if total_demand > _TOL else 1.0,
                    "unmet": round(sum(_num(u, "quantity") for u in candidate_result.unmet), 4),
                    "late_units": round(float(candidate_delivery.get("at_risk_units", 0.0) or 0.0), 4),
                    "total_cost": round(_num(candidate_result, "total_cost"), 4),
                    "max_late_days": round(float(candidate_delivery.get("max_late_days", 0.0) or 0.0), 4),
                },
                "effect": effect,
                "improvement_units": round(improvement_units, 4),
            }
        )

    results.sort(
        key=lambda item: (
            item["effect"]["restored_units"] + item["effect"]["on_time_restored_units"],
            -max(item["effect"]["cost_delta"], 0.0),
            item["targeted_units"],
            item["title"],
        ),
        reverse=True,
    )

    strategic = []
    if not results:
        strategic.append({
            "kind": "full_recovery",
            "title": "Run the combined recovery plan",
            "detail": "No single isolated lever is projected to change service; recovery evaluates all contingency lanes together.",
            "tested": False,
        })
    for diagnosis in diagnoses:
        cause = diagnosis.get("cause")
        if cause in {"no_route", "product_not_allowed"}:
            destination_name = _label(diagnosis["destination_id"], _name_map(meta.get("destinations", [])))
            product_name = _label(diagnosis["product_id"], _name_map(meta.get("products", [])))
            strategic.append({
                "kind": "network_design",
                "title": f"Qualify a lane for {destination_name} × {product_name}",
                "detail": diagnosis.get("explanation", "No currently eligible lane can serve this demand."),
                "affected_units": diagnosis.get("quantity"),
                "tested": False,
            })
    strategic = strategic[:4]
    return results, strategic, diagnoses


def scenario_brief(
    meta: Dict[str, Any],
    baseline_plan: Dict[str, Any],
    disruptions: List[Any],
    scenario: Dict[str, Any],
) -> Dict[str, Any]:
    from app.services.disruption import apply_disruptions

    inventory, demand, routes, priorities = build_network(meta)
    deadlines = load_deadlines(meta)
    destinations = load_destinations(meta)
    data = baseline_plan.get("data", {}) or {}
    respect_deadlines = bool((data.get("constraints") or {}).get("respect_deadlines", False))
    solver = baseline_plan.get("solver") if baseline_plan.get("solver") in {"greedy", "ortools", "auto"} else None

    new_inventory, new_routes, disruption_description = apply_disruptions(inventory, routes, disruptions)
    disrupted_input = AllocationInput(
        inventory=new_inventory,
        demand=demand,
        routes=new_routes,
        priorities=priorities,
        deadlines=deadlines,
        respect_deadlines=respect_deadlines,
    )
    disrupted_result = solve_allocation(disrupted_input, solver=solver)
    disrupted_kpi = compute_kpis(disrupted_result, new_inventory, demand, new_routes)
    disrupted_delivery = compute_delivery_risk(disrupted_result.allocations, new_routes, destinations)
    recommendations, strategic_actions, diagnoses = build_mitigation_recommendations(
        meta,
        disrupted_input,
        disrupted_result,
        disrupted_delivery,
        routes,
        solver,
    )
    service = compute_service_projection(
        meta,
        demand,
        disrupted_result.allocations,
        disrupted_result.unmet,
        disrupted_delivery,
        diagnoses,
        new_routes,
        deadlines,
    )

    validated = sum(1 for item in recommendations if item["status"] == "validated")
    return {
        "scenario_id": scenario.get("id"),
        "baseline_plan_id": scenario.get("baseline_plan_id"),
        "disrupted_plan_id": scenario.get("disrupted_plan_id"),
        "solver": disrupted_result.solver,
        "solver_status": disrupted_result.status,
        "disruption_description": disruption_description,
        "respect_deadlines": respect_deadlines,
        "kpis": disrupted_kpi.model_dump(),
        "delivery_risk": disrupted_delivery,
        "service": service,
        "recommendations": recommendations,
        "strategic_actions": strategic_actions,
        "mitigation_summary": {
            "options_tested": len(recommendations),
            "validated_options": validated,
            "best_restored_units": max((item["effect"]["restored_units"] for item in recommendations), default=0.0),
            "best_on_time_restored_units": max(
                (item["effect"]["on_time_restored_units"] for item in recommendations), default=0.0
            ),
        },
        "note": (
            "Ephemeral advisory: each option re-solves one isolated network change and "
            "no scenario, plan, or activity row is stored."
        ),
    }
