from __future__ import annotations

import csv
import io
from typing import Any, Dict, List


_FORMULA_PREFIXES = ("=", "+", "-", "@")


def _spreadsheet_safe(value):
    """Escape untrusted text that spreadsheet apps could evaluate as a formula.

    Only string values are escaped, so numeric KPI values (including negative
    deltas) remain numeric in downstream spreadsheet tools.
    """
    if isinstance(value, str) and value.lstrip(" \t\r\n").startswith(_FORMULA_PREFIXES):
        return "'" + value
    return value


def export_scenario_csv(scenario, plans) -> bytes:
    """
    Generate CSV content for allocations, unmet, kpis.
    scenario: dict with at least id
    plans: list of plan dicts or AllocationResult-like dicts, or dict mapping type->plan
    Returns bytes ready for response.
    CSV sections separated by blank lines and section headers.
    """
    output = io.StringIO()
    writer = csv.writer(output)

    # Normalize scenario
    if isinstance(scenario, dict):
        scen_id = scenario.get("id", "scenario")
        scen_name = scenario.get("name")
    else:
        scen_id = getattr(scenario, "id", "scenario")
        scen_name = getattr(scenario, "name", None)
    if scen_name:
        writer.writerow([
            f"Scenario: {_spreadsheet_safe(scen_name)} ({_spreadsheet_safe(scen_id)})"
        ])
    else:
        writer.writerow([_spreadsheet_safe(f"Scenario: {scen_id}")])
    writer.writerow([])

    # Normalize plans to list
    if isinstance(plans, dict):
        plan_list = list(plans.values())
    elif isinstance(plans, list):
        plan_list = plans
    else:
        plan_list = [plans]

    for plan in plan_list:
        if isinstance(plan, dict):
            pid = plan.get("id", "plan")
            ptype = plan.get("type", "unknown")
            data = plan.get("data", plan)
            # data may contain allocations, unmet, kpis
            allocations = data.get("allocations", plan.get("allocations", []))
            unmet = data.get("unmet", plan.get("unmet", []))
            kpis = data.get("kpis", plan.get("kpis", {}))
        else:
            pid = getattr(plan, "id", "plan")
            ptype = getattr(plan, "type", "unknown")
            allocations = getattr(plan, "allocations", [])
            unmet = getattr(plan, "unmet", [])
            kpis = getattr(plan, "kpis", {})

        writer.writerow([
            f"Plan: {_spreadsheet_safe(pid)} ({_spreadsheet_safe(ptype)})"
        ])
        # Allocations section
        writer.writerow(["Allocations"])
        writer.writerow(["warehouse_id", "destination_id", "product_id", "route_id", "quantity"])
        for a in allocations or []:
            if isinstance(a, dict):
                writer.writerow([
                    _spreadsheet_safe(a.get("warehouse_id", "")),
                    _spreadsheet_safe(a.get("destination_id", "")),
                    _spreadsheet_safe(a.get("product_id", "")),
                    _spreadsheet_safe(a.get("route_id", "")),
                    a.get("quantity", ""),
                ])
            else:
                writer.writerow([
                    _spreadsheet_safe(getattr(a, "warehouse_id", "")),
                    _spreadsheet_safe(getattr(a, "destination_id", "")),
                    _spreadsheet_safe(getattr(a, "product_id", "")),
                    _spreadsheet_safe(getattr(a, "route_id", "")),
                    getattr(a, "quantity", ""),
                ])
        writer.writerow([])
        # Unmet section
        writer.writerow(["Unmet"])
        writer.writerow(["destination_id", "product_id", "quantity", "priority"])
        for u in unmet or []:
            if isinstance(u, dict):
                writer.writerow([
                    _spreadsheet_safe(u.get("destination_id", "")),
                    _spreadsheet_safe(u.get("product_id", "")),
                    u.get("quantity", ""),
                    u.get("priority", ""),
                ])
            else:
                writer.writerow([
                    _spreadsheet_safe(getattr(u, "destination_id", "")),
                    _spreadsheet_safe(getattr(u, "product_id", "")),
                    getattr(u, "quantity", ""),
                    getattr(u, "priority", ""),
                ])
        writer.writerow([])
        # KPIs section
        writer.writerow(["KPIs"])
        if isinstance(kpis, dict):
            writer.writerow(["metric", "value"])
            for k, v in kpis.items():
                # ensure no dict nesting explosion
                if isinstance(v, dict):
                    import json
                    writer.writerow([k, json.dumps(v)])
                else:
                    writer.writerow([_spreadsheet_safe(k), _spreadsheet_safe(v)])
        else:
            # KPISnapshot object
            writer.writerow(["metric", "value"])
            try:
                kd = kpis.model_dump() if hasattr(kpis, "model_dump") else dict(kpis)
                for k, v in kd.items():
                    if isinstance(v, dict):
                        import json
                        writer.writerow([k, json.dumps(v)])
                    else:
                        writer.writerow([_spreadsheet_safe(k), _spreadsheet_safe(v)])
            except Exception:
                writer.writerow(["kpis", str(kpis)])
        writer.writerow([])
        writer.writerow([])

    content = output.getvalue()
    return content.encode("utf-8")
