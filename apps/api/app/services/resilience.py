"""Pre-mortem readiness assessment for a completed baseline plan.

The result is intentionally an ephemeral projection: it reads stored planning
inputs and allocations, scores the network, and writes nothing back. Every
component is derived from the model rather than assigned a categorical label.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Tuple

from app.services.normalize import build_network, load_deadlines, load_destinations

_TOL = 1e-6

_WEIGHTS = {
    "lane_redundancy": 30,
    "contingency_coverage": 20,
    "capacity_headroom": 20,
    "inventory_diversification": 15,
    "delivery_margin": 15,
}


def _attr(obj: Any, field: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(field, default)
    return getattr(obj, field, default)


def _num(obj: Any, field: str, default: float = 0.0) -> float:
    try:
        value = float(_attr(obj, field, default) or 0)
    except (TypeError, ValueError):
        return default
    return value


def _int_priority(obj: Any) -> int:
    try:
        value = int(float(_attr(obj, "priority", 3) or 3))
    except (TypeError, ValueError):
        return 3
    return max(1, min(5, value))


def _priority_weight(priority: int) -> int:
    """Priority 1 receives weight 5; priority 5 receives weight 1."""
    return max(1, 6 - priority)


def _name_map(rows: Iterable[Any]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for row in rows or []:
        key = _attr(row, "id")
        if key is None:
            continue
        name = str(_attr(row, "name") or key)
        out[str(key)] = name
    return out


def _label(kind: str, key: Any, names: Dict[str, str]) -> str:
    key_str = str(key)
    name = names.get(key_str)
    return f"{name} ({key_str})" if name and name != key_str else key_str


def _product_allowed(route: Any, product_id: str) -> bool:
    product_ids = _attr(route, "product_ids")
    return not product_ids or product_id in product_ids


def _eligible_lanes(
    demand_row: Any,
    routes: List[Any],
    inventory_by_key: Dict[Tuple[str, str], float],
    deadlines: Dict[str, float],
    respect_deadlines: bool,
    *,
    backup: bool,
) -> List[Any]:
    dest = str(_attr(demand_row, "destination_id"))
    product = str(_attr(demand_row, "product_id"))
    deadline = deadlines.get(dest)
    out = []
    for route in routes:
        if bool(_attr(route, "backup", False)) != backup:
            continue
        if not bool(_attr(route, "available", True)):
            continue
        if str(_attr(route, "destination_id")) != dest:
            continue
        if _num(route, "capacity") <= _TOL:
            continue
        if not _product_allowed(route, product):
            continue
        if inventory_by_key.get((str(_attr(route, "warehouse_id")), product), 0.0) <= _TOL:
            continue
        if respect_deadlines and deadline is not None:
            if _num(route, "time_days") > float(deadline) + _TOL:
                continue
        out.append(route)
    return out


def _pct(value: float) -> float:
    return round(max(0.0, min(1.0, value)), 6)


def _add_vulnerability(
    buckets: Dict[str, Dict[str, Any]],
    key: str,
    *,
    kind: str,
    severity: str,
    title: str,
    detail: str,
    affected_units: float,
    priority: int,
    route_ids: Iterable[str] = (),
    destination_ids: Iterable[str] = (),
    product_ids: Iterable[str] = (),
    warehouse_ids: Iterable[str] = (),
    evidence: Dict[str, Any] | None = None,
) -> None:
    bucket = buckets.get(key)
    if bucket is None:
        bucket = {
            "kind": kind,
            "severity": severity,
            "title": title,
            "detail": detail,
            "affected_units": 0.0,
            "priority": 5,
            "route_ids": set(),
            "destination_ids": set(),
            "product_ids": set(),
            "warehouse_ids": set(),
            "evidence": evidence or {},
        }
        buckets[key] = bucket
    bucket["affected_units"] = round(bucket["affected_units"] + affected_units, 4)
    bucket["priority"] = min(bucket["priority"], priority)
    bucket["route_ids"].update(route_ids)
    bucket["destination_ids"].update(destination_ids)
    bucket["product_ids"].update(product_ids)
    bucket["warehouse_ids"].update(warehouse_ids)
    if evidence:
        bucket["evidence"].update(evidence)


def _severity_from_units(units: float, priority: int) -> str:
    if priority <= 1 and units > 1:
        return "critical"
    if priority <= 2 and units > 1:
        return "high"
    if units > 1:
        return "medium"
    return "low"


def assess_plan_resilience(meta: Dict[str, Any], plan: Dict[str, Any]) -> Dict[str, Any]:
    inventory, demand, routes, priorities = build_network(meta)
    deadlines = load_deadlines(meta)
    destinations = load_destinations(meta)
    data = plan.get("data", {}) or {}
    allocations = data.get("allocations", []) or []
    unmet = data.get("unmet", []) or []
    respect_deadlines = bool((data.get("constraints") or {}).get("respect_deadlines", False))

    route_by_id = {str(_attr(r, "id")): r for r in routes}
    inventory_by_key: Dict[Tuple[str, str], float] = {}
    inventory_by_product: Dict[str, float] = {}
    inventory_by_wh_product: Dict[Tuple[str, str], float] = {}
    for inv in inventory:
        wh = str(_attr(inv, "warehouse_id"))
        product = str(_attr(inv, "product_id"))
        qty = _num(inv, "quantity")
        key = (wh, product)
        inventory_by_key[key] = inventory_by_key.get(key, 0.0) + qty
        inventory_by_product[product] = inventory_by_product.get(product, 0.0) + qty
        inventory_by_wh_product[key] = inventory_by_key[key]

    demand_by_product: Dict[str, float] = {}
    for row in demand:
        product = str(_attr(row, "product_id"))
        demand_by_product[product] = demand_by_product.get(product, 0.0) + _num(row, "quantity")

    priority_by_dest = {str(_attr(d, "id")): _int_priority(d) for d in destinations}
    destination_names = _name_map(meta.get("destinations", []))
    product_names = _name_map(meta.get("products", []))
    warehouse_names = _name_map(meta.get("warehouses", []))
    route_names = {
        str(_attr(r, "id")): f"{_attr(r, 'warehouse_id')} → {_attr(r, 'destination_id')}"
        for r in routes
    }

    shipped_by_route: Dict[str, float] = {}
    for allocation in allocations:
        route_id = str(_attr(allocation, "route_id"))
        shipped_by_route[route_id] = shipped_by_route.get(route_id, 0.0) + _num(allocation, "quantity")

    eligible_primary_routes = [
        r for r in routes
        if not _attr(r, "backup", False)
        and _attr(r, "available", True)
        and _num(r, "capacity") > _TOL
    ]
    total_eligible_capacity = sum(_num(r, "capacity") for r in eligible_primary_routes)
    used_eligible_capacity = sum(
        shipped_by_route.get(str(_attr(r, "id")), 0.0) for r in eligible_primary_routes
    )
    capacity_headroom = (
        (total_eligible_capacity - used_eligible_capacity) / total_eligible_capacity
        if total_eligible_capacity > _TOL
        else 0.0
    )

    total_demand = sum(_num(row, "quantity") for row in demand)
    redundant_units = 0.0
    contingency_units = 0.0
    diversification_units = 0.0
    vulnerability_buckets: Dict[str, Dict[str, Any]] = {}

    # Demand-row level redundancy and contingency readiness.
    for row in demand:
        dest = str(_attr(row, "destination_id"))
        product = str(_attr(row, "product_id"))
        qty = _num(row, "quantity")
        if qty <= _TOL:
            continue
        priority = priority_by_dest.get(dest, _int_priority(row))
        primary = _eligible_lanes(
            row, routes, inventory_by_key, deadlines, respect_deadlines, backup=False
        )
        backups = _eligible_lanes(
            row, routes, inventory_by_key, deadlines, respect_deadlines, backup=True
        )
        if len(primary) >= 2:
            redundant_units += qty
        if backups:
            contingency_units += qty

        dest_label = _label("destination", dest, destination_names)
        product_label = _label("product", product, product_names)
        primary_ids = sorted(str(_attr(r, "id")) for r in primary)
        backup_ids = sorted(str(_attr(r, "id")) for r in backups)

        if not primary:
            _add_vulnerability(
                vulnerability_buckets,
                f"no_primary_lane:{dest}:{product}",
                kind="no_primary_lane",
                severity="critical",
                title=f"No ordinary lane can serve {dest_label} for {product_label}",
                detail=(
                    "The plan has no available, product-eligible lane with reachable stock"
                    + (" and deadline compliance" if respect_deadlines else "")
                    + "."
                ),
                affected_units=qty,
                priority=priority,
                destination_ids=[dest],
                product_ids=[product],
                evidence={
                    "contingency_lanes": backup_ids,
                    "reachable_inventory": round(inventory_by_product.get(product, 0.0), 4),
                },
            )
        elif len(primary) == 1:
            route_id = primary_ids[0]
            _add_vulnerability(
                vulnerability_buckets,
                f"single_source:{route_id}:{dest}:{product}",
                kind="single_source",
                severity=_severity_from_units(qty, priority),
                title=f"{dest_label} depends on one ordinary lane for {product_label}",
                detail=f"Lane {route_id} ({route_names.get(route_id, route_id)}) is the only non-contingency option.",
                affected_units=qty,
                priority=priority,
                route_ids=[route_id],
                destination_ids=[dest],
                product_ids=[product],
                warehouse_ids=[str(_attr(primary[0], "warehouse_id"))],
                evidence={
                    "eligible_lanes": primary_ids,
                    "contingency_lanes": backup_ids,
                    "deadline_policy": "enforced" if respect_deadlines else "reported",
                },
            )
        elif not backups:
            _add_vulnerability(
                vulnerability_buckets,
                f"no_contingency:{dest}:{product}",
                kind="no_contingency",
                severity=_severity_from_units(qty, priority),
                title=f"No pre-negotiated backup reaches {dest_label} for {product_label}",
                detail="Recovery would have to fall back entirely to ordinary lanes.",
                affected_units=qty,
                priority=priority,
                route_ids=primary_ids,
                destination_ids=[dest],
                product_ids=[product],
                evidence={"eligible_lanes": primary_ids},
            )

    # Inventory diversification and product dependency.
    weighted_diversification = 0.0
    diversification_weight = 0.0
    for product, stock in inventory_by_product.items():
        weight = demand_by_product.get(product, 0.0)
        if stock > _TOL:
            largest = max(qty for (wh, prod), qty in inventory_by_wh_product.items() if prod == product)
            concentration = largest / stock
        else:
            concentration = 1.0
        if weight > _TOL:
            weighted_diversification += weight * (1.0 - concentration)
            diversification_weight += weight
        if concentration >= 1 - _TOL and weight > _TOL:
            affected_destinations = sorted(
                str(_attr(row, "destination_id"))
                for row in demand
                if str(_attr(row, "product_id")) == product
            )
            warehouses = sorted(wh for (wh, prod) in inventory_by_wh_product if prod == product)
            _add_vulnerability(
                vulnerability_buckets,
                f"inventory_concentration:{product}",
                kind="inventory_concentration",
                severity=_severity_from_units(weight, min(priority_by_dest.values(), default=3)),
                title=f"{_label('product', product, product_names)} is sourced from one warehouse",
                detail="A site-level supply interruption removes all reachable stock for demand that depends on it.",
                affected_units=weight,
                priority=min((priority_by_dest.get(d, 3) for d in affected_destinations), default=3),
                destination_ids=affected_destinations,
                product_ids=[product],
                warehouse_ids=warehouses,
                evidence={
                    "product_stock": round(stock, 4),
                    "largest_warehouse_share": round(concentration, 6),
                },
            )

    inventory_diversification = weighted_diversification / diversification_weight if diversification_weight > _TOL else 0.0

    # Delivery margin, based on allocations actually shipped by the plan.
    on_time_units = 0.0
    for allocation in allocations:
        dest = str(_attr(allocation, "destination_id"))
        route = route_by_id.get(str(_attr(allocation, "route_id")))
        qty = _num(allocation, "quantity")
        if route is None or qty <= _TOL:
            continue
        deadline = deadlines.get(dest)
        if deadline is None:
            on_time_units += qty
            continue
        slack = float(deadline) - _num(route, "time_days")
        if slack >= 0:
            on_time_units += qty
        priority = priority_by_dest.get(dest, 3)
        product = str(_attr(allocation, "product_id"))
        dest_label = _label("destination", dest, destination_names)
        product_label = _label("product", product, product_names)
        route_id = str(_attr(route, "id"))
        if slack < 0:
            _add_vulnerability(
                vulnerability_buckets,
                f"late_lane:{route_id}:{dest}:{product}",
                kind="deadline_exposure",
                severity=_severity_from_units(qty, priority),
                title=f"{dest_label} receives {product_label} late via {route_id}",
                detail=f"Transit is {_num(route, 'time_days'):g} days against a {float(deadline):g}-day deadline.",
                affected_units=qty,
                priority=priority,
                route_ids=[route_id],
                destination_ids=[dest],
                product_ids=[product],
                warehouse_ids=[str(_attr(route, "warehouse_id"))],
                evidence={"deadline_days": round(float(deadline), 4), "late_by_days": round(-slack, 4)},
            )
        elif slack <= 2:
            _add_vulnerability(
                vulnerability_buckets,
                f"tight_deadline:{route_id}:{dest}:{product}",
                kind="deadline_margin",
                severity=_severity_from_units(qty, priority),
                title=f"{dest_label} has only {slack:g} days of deadline margin",
                detail="A small delay turns this shipment into a service failure.",
                affected_units=qty,
                priority=priority,
                route_ids=[route_id],
                destination_ids=[dest],
                product_ids=[product],
                warehouse_ids=[str(_attr(route, "warehouse_id"))],
                evidence={
                    "deadline_days": round(float(deadline), 4),
                    "transit_days": round(_num(route, "time_days"), 4),
                    "slack_days": round(slack, 4),
                },
            )

    delivery_margin = on_time_units / total_demand if total_demand > _TOL else 1.0

    # Lane bottleneck analysis, weighted by destination criticality.
    for route in eligible_primary_routes:
        route_id = str(_attr(route, "id"))
        shipped = shipped_by_route.get(route_id, 0.0)
        utilization = shipped / _num(route, "capacity") if _num(route, "capacity") > _TOL else 0.0
        if utilization >= 0.8:
            priority = priority_by_dest.get(str(_attr(route, "destination_id")), 3)
            _add_vulnerability(
                vulnerability_buckets,
                f"lane_bottleneck:{route_id}",
                kind="lane_bottleneck",
                severity=_severity_from_units(shipped, priority),
                title=f"{route_names.get(route_id, route_id)} is {utilization * 100:.1f}% allocated",
                detail="This lane has little spare throughput if its primary plan is disrupted.",
                affected_units=shipped,
                priority=priority,
                route_ids=[route_id],
                destination_ids=[str(_attr(route, "destination_id"))],
                warehouse_ids=[str(_attr(route, "warehouse_id"))],
                evidence={
                    "shipped": round(shipped, 4),
                    "capacity": round(_num(route, "capacity"), 4),
                    "utilization": round(utilization, 6),
                },
            )

    redundancy_rate = redundant_units / total_demand if total_demand > _TOL else 1.0
    contingency_rate = contingency_units / total_demand if total_demand > _TOL else 1.0
    rates = {
        "lane_redundancy": _pct(redundancy_rate),
        "contingency_coverage": _pct(contingency_rate),
        "capacity_headroom": _pct(capacity_headroom),
        "inventory_diversification": _pct(inventory_diversification),
        "delivery_margin": _pct(delivery_margin),
    }
    components = [
        {
            "key": key,
            "label": label,
            "weight": _WEIGHTS[key],
            "rate": rates[key],
            "points": round(_WEIGHTS[key] * rates[key], 2),
            "evidence": evidence,
        }
        for key, label, evidence in (
            ("lane_redundancy", "Ordinary-lane redundancy", {"redundant_units": round(redundant_units, 4)}),
            ("contingency_coverage", "Contingency-lane coverage", {"contingency_units": round(contingency_units, 4)}),
            ("capacity_headroom", "Spare lane capacity", {"eligible_capacity": round(total_eligible_capacity, 4)}),
            ("inventory_diversification", "Warehouse stock diversification", {"product_demand": round(diversification_weight, 4)}),
            ("delivery_margin", "On-time delivery margin", {"on_time_units": round(on_time_units, 4)}),
        )
    ]
    score = round(sum(component["points"] for component in components), 2)
    grade = (
        "resilient"
        if score >= 80
        else "prepared"
        if score >= 65
        else "fragile"
        if score >= 45
        else "critical"
    )

    vulnerabilities = sorted(
        (
            {
                "kind": v["kind"],
                "severity": v["severity"],
                "title": v["title"],
                "detail": v["detail"],
                "affected_units": round(v["affected_units"], 4),
                "priority": v["priority"],
                "rank_score": round(v["affected_units"] * _priority_weight(v["priority"]), 4),
                "route_ids": sorted(v["route_ids"]),
                "destination_ids": sorted(v["destination_ids"]),
                "product_ids": sorted(v["product_ids"]),
                "warehouse_ids": sorted(v["warehouse_ids"]),
                "evidence": v["evidence"],
            }
            for v in vulnerability_buckets.values()
        ),
        key=lambda item: (-item["rank_score"], item["severity"], item["title"]),
    )[:12]

    recommendations = _recommendations(vulnerabilities, rates, bool(unmet), total_demand)

    return {
        "plan_id": plan.get("id"),
        "dataset_id": plan.get("dataset_id"),
        "solver": plan.get("solver"),
        "solver_status": data.get("status_detail"),
        "constraints": data.get("constraints", {}),
        "score": score,
        "grade": grade,
        "definition": (
            "resilience_score = 30×lane redundancy + 20×contingency coverage + "
            "20×capacity headroom + 15×inventory diversification + 15×delivery margin"
        ),
        "score_components": components,
        "metrics": {
            "total_demand": round(total_demand, 4),
            "redundant_lane_units": round(redundant_units, 4),
            "contingency_covered_units": round(contingency_units, 4),
            "capacity_headroom_rate": rates["capacity_headroom"],
            "eligible_primary_routes": len(eligible_primary_routes),
            "contingency_routes": len([r for r in routes if _attr(r, "backup", False)]),
            "unmet_rows": len(unmet),
            "vulnerabilities": len(vulnerabilities),
        },
        "vulnerabilities": vulnerabilities,
        "recommendations": recommendations,
        "note": "Ephemeral readiness assessment: it does not store a plan, scenario, or activity record.",
    }


def _recommendations(
    vulnerabilities: List[Dict[str, Any]],
    rates: Dict[str, float],
    has_unmet: bool,
    total_demand: float,
) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    by_kind: Dict[str, List[Dict[str, Any]]] = {}
    for vulnerability in vulnerabilities:
        by_kind.setdefault(vulnerability["kind"], []).append(vulnerability)

    if by_kind.get("no_primary_lane"):
        top = by_kind["no_primary_lane"][0]
        out.append({
            "kind": "network_design",
            "title": "Qualify an ordinary lane for unreachable demand",
            "detail": "No currently eligible primary lane can serve the affected destination × product rows.",
            "affected_units": top["affected_units"],
            "evidence": {"vulnerability": top["kind"]},
        })

    if by_kind.get("single_source"):
        top = by_kind["single_source"][0]
        out.append({
            "kind": "dual_source",
            "title": f"Dual-source {top['title'].lower()}",
            "detail": "Negotiate a second ordinary lane or make an existing alternate lane product-eligible.",
            "affected_units": top["affected_units"],
            "evidence": {"route_ids": top["route_ids"], "destination_ids": top["destination_ids"]},
        })

    if rates["contingency_coverage"] < 1:
        out.append({
            "kind": "contingency_contract",
            "title": "Add contracted backup capacity to remaining demand",
            "detail": f"Only {rates['contingency_coverage'] * 100:.1f}% of demand currently has a pre-negotiated contingency lane.",
            "affected_units": round(total_demand * (1 - rates["contingency_coverage"]), 4),
            "evidence": {"coverage_rate": rates["contingency_coverage"]},
        })

    if rates["capacity_headroom"] < 0.25 or by_kind.get("lane_bottleneck"):
        bottleneck = (by_kind.get("lane_bottleneck") or [None])[0]
        out.append({
            "kind": "capacity_uplift",
            "title": "Increase spare lane capacity before the next planning cycle",
            "detail": "Network headroom is low enough that a single lane outage should be expected to create a gap.",
            "affected_units": bottleneck["affected_units"] if bottleneck else None,
            "evidence": {"headroom_rate": rates["capacity_headroom"]},
        })

    if by_kind.get("inventory_concentration"):
        top = by_kind["inventory_concentration"][0]
        out.append({
            "kind": "inventory_rebalance",
            "title": f"Create a second stocking site for {top['title'].lower()}",
            "detail": "Move or place safety stock where a second warehouse has an eligible lane to the affected destinations.",
            "affected_units": top["affected_units"],
            "evidence": {"product_ids": top["product_ids"], "warehouse_ids": top["warehouse_ids"]},
        })

    if by_kind.get("deadline_exposure") or by_kind.get("deadline_margin") or rates["delivery_margin"] < 0.95:
        out.append({
            "kind": "expedite_margin",
            "title": "Buy deadline margin for the most exposed shipments",
            "detail": "Expedite critical lanes or move inventory closer to high-priority destinations.",
            "affected_units": sum(v["affected_units"] for v in by_kind.get("deadline_exposure", [])),
            "evidence": {"on_time_rate": rates["delivery_margin"]},
        })

    if has_unmet:
        out.append({
            "kind": "demand_validation",
            "title": "Resolve baseline gaps before stress-testing",
            "detail": "The baseline itself has unmet rows; a disrupted comparison should not inherit an already-infeasible plan.",
            "affected_units": None,
            "evidence": {"baseline_unmet_rows": True},
        })

    if not out:
        out.append({
            "kind": "stress_test",
            "title": "Stress-test the network",
            "detail": "The ordinary-lane network is structurally redundant, so the next useful step is to test its behaviour under outage.",
            "affected_units": None,
            "evidence": {"score_components": rates},
        })
    return out[:6]
