# API contract — `/api/v1`

All endpoints return JSON except `/scenarios/{id}/export`, which returns CSV.
Every response carries `X-Request-ID` (caller-supplied values are preserved) and
`X-Process-Time-Ms`. Errors use a single envelope that repeats the id:

```json
{ "detail": "human readable message", "code": "machine_code", "errors": [], "request_id": "a1b2c3d4e5f6" }
```

| Status | Meaning in this API |
|---|---|
| 200 | Read or successful action |
| 201 | (reserved) created — current endpoints return 200 with the created object |
| 400 | Invalid input, bad disruption params, unparseable CSV |
| 404 | Dataset / plan / scenario not found |
| 413 | Upload exceeded the per-file size limit |
| 422 | FastAPI request-shape validation failure |
| 500 | Unexpected error — no stack trace is returned to the client |

---

## Datasets

### `POST /datasets/sample`
Loads the bundled deterministic sample network from `data/samples/`.
No body. Idempotent per call (each call creates a new dataset id).

```json
{
  "dataset_id": "uuid",
  "name": "Sample Network (bundled)",
  "created_at": "2026-10-24T17:00:00+00:00",
  "validation_report": { "valid": true, "issues": [], "summary": { "total_issues": 0, "errors": 0, "warnings": 0 } },
  "preview": { "warehouses": [ ... ], "destinations": [ ... ], "products": [ ... ],
               "routes": [ ... ], "inventory": [ ... ], "demand": [ ... ] }
}
```

### `POST /datasets/import`
`multipart/form-data` with exactly six files: `warehouses`, `destinations`, `products`,
`routes`, `inventory`, `demand`. Each must end in `.csv` and be under the configured limit
(default 5 MB). Returns the same shape as `/datasets/sample`.

### `GET /datasets/`
```json
{ "datasets": [ { "id": "...", "name": "...", "created_at": "...", "meta": { "...": "raw rows" } } ],
  "total": 3 }
```

### `GET /datasets/{id}`
Returns the stored dataset document including `meta.validation_report`.

### `POST /datasets/{id}/validate`
Re-runs validation against the stored rows and returns a `ValidationReport`.

---

## Plans

`status` is the workflow state (`completed`). `solver_status` is the engine's own
verdict (`optimal`, `feasible`, `infeasible`, `error`); the greedy engine always
reports `feasible` because it does not prove optimality.

### `POST /plans`
```json
{ "dataset_id": "uuid", "solver": "greedy", "respect_deadlines": false }
```
`solver` is optional (`greedy | ortools | auto`). Defaults to server config and
applies to this request only. `respect_deadlines` is optional and defaults to
`false`: when true, a lane is eligible only if `time_days <= deadline_days` for
that destination. Destinations without a deadline stay unconstrained, and demand
with no compliant lane is returned as unmet.

Response:
```json
{
  "id": "uuid", "dataset_id": "uuid", "type": "baseline", "status": "completed",
  "solver": "greedy", "solver_status": "feasible", "created_at": "...",
  "allocations": [{ "warehouse_id": "WH-02", "destination_id": "DST-01", "product_id": "PRD-A",
                    "route_id": "RT-03", "quantity": 300.0 }],
  "unmet": [{ "destination_id": "DST-08", "product_id": "PRD-C", "quantity": 160.0, "priority": 3 }],
  "kpis": { "total_inventory": 7000, "total_demand": 4970, "fulfilled": 4970,
            "fulfillment_rate": 1.0, "unmet": 0, "total_cost": 24240,
            "wh_utilization": 0.71, "route_utilization": 0.55,
            "at_risk_destinations": 0, "risk_score": 16.6,
            "risk_breakdown": { "unmet_component": 0, "route_component": 11.0,
                                "at_risk_component": 0, "cost_component": 5.6,
                                "description": "risk_score = ..." } },
  "diagnostics": { "elapsed_seconds": 0.002, "solver": "greedy" },
  "utilization": { "wh_utilization": 0.71, "route_utilization": 0.55 },
  "constraints": { "respect_deadlines": false },
  "unmet_diagnosis": []
}
```

Every unmet row also carries a diagnosis. The fields are computed from the same
inputs and allocations as the plan:

```json
{
  "destination_id": "DST-01", "product_id": "PRD-B", "quantity": 150, "priority": 1,
  "cause": "capacity_shared",
  "summary": "lane capacity was consumed by earlier demand",
  "explanation": "Only 0 units of lane capacity remain for 150 unmet — earlier demand rows (priority order, then quantity) consumed it.",
  "evidence": {
    "demand": 350, "allocated": 200, "unmet": 150,
    "reachable_inventory": 900, "remaining_inventory": 700,
    "lane_capacity": 350, "remaining_capacity": 0,
    "eligible_lanes": ["RT-09"], "deadline_blocked_lanes": [],
    "contingency_lanes": ["RT-13"]
  }
}
```

Causes: `no_route`, `product_not_allowed`, `contingency_only`, `deadline_blocked`,
`no_inventory`, `inventory_short`, `lane_capacity`, `inventory_shared`,
`capacity_shared`, `combined`.

When deadline enforcement is on, `diagnostics` also contains
`deadline_enforced: true`, `lanes_excluded_by_deadline: ["RT-09", ...]` and
`destinations_without_deadline: [...]`. When OR-Tools was requested but not
used, `diagnostics.fallback` is `"greedy"` and `fallback_reason` names the cause
(e.g. `ortools_not_installed`).

### `GET /plans/`
`?limit=25&offset=0&plan_type=baseline` →
`{ "plans": [{ "id", "type", "solver_status", "kpis", "constraints", "allocation_count", ... }], "total": n, "limit": n, "offset": n }`.
`total` is the true table count (after the type filter), not the page size. The type
filter is applied before `limit`, so `limit=1&plan_type=baseline` is never
emptied by newer plans of another type. `constraints` reports the planning policy
(for example `{"respect_deadlines": true}`) so pickers can show it without a detail fetch.

### `GET /plans/{id}`
Same shape as the create response, including `solver_status`, `constraints` and
`unmet_diagnosis`.

---

## Scenarios

### `POST /scenarios`
```json
{
  "baseline_plan_id": "uuid",
  "name": "Q4 lane failure",
  "disruptions": [
    { "type": "route_closure", "params": { "route_id": "RT-03" } },
    { "type": "inventory_shortage",
      "params": { "warehouse_id": "WH-02", "product_id": "PRD-A", "reduction_pct": 60 } }
  ]
}
```

`name` is optional (≤ 80 characters). Provide **either** a single `disruption`
(legacy form) **or** 1–5 `disruptions`, not both. Events apply in order to the
same copies of the planning inputs, so two shortages on the same stock compound
multiplicatively and repeat closures are idempotent. A combination is stored as
`{ "type": "compound", "events": [...] }`; a single event keeps the plain shape.

Disruption parameter schemas:

| Type | Required params | Effect on planning inputs |
|---|---|---|
| `inventory_shortage` | `warehouse_id`, `product_id`, `reduction_pct` (0–100) | `quantity *= (1 − pct/100)` |
| `supply_interruption` | `warehouse_id`, `product_id` | `quantity = 0` |
| `route_closure` | `route_id` | `available = false` |
| `route_delay` | `route_id`, `extra_days` (≥ 0) | `time_days += extra_days` (capacity unchanged) |

Response:
```json
{
  "scenario": { "id", "name", "baseline_plan_id", "disruption", "disrupted_plan_id", "status": "disrupted", "created_at" },
  "disrupted_plan": { "...": "full plan document, including unmet_diagnosis" },
  "impact": {
    "fulfillment_delta": -0.1006, "cost_delta": -1620, "unmet_delta": 500,
    "at_risk_units": 0, "at_risk_delta": 0, "max_late_days": 0,
    "delivery_risk": { "at_risk_units": 0, "at_risk_destinations": [], "at_risk_shipments": [],
                       "max_late_days": 0, "definition": "..." },
    "disruption_description": "Route closure: set route RT-03 available=False"
  }
}
```

Errors: `400` for unknown type or missing/invalid params, `404` for unknown baseline plan.
The referenced plan must have `type: "baseline"`; pointing at a disrupted or recovered
plan is a `400`. A scenario inherits the baseline's `constraints.respect_deadlines`:
the disrupted and recovered plans are written with the same policy so the comparison
stays apples-to-apples.

### `GET /scenarios/`
`?limit=25&offset=0` → `{ "scenarios": [...], "total": n, "limit": n, "offset": n }` with
`kpis.{baseline,disrupted,recovered}`. `total` is the true table count, not the page size.

### `POST /scenarios/sweep`

Re-solves the same baseline at 2–7 severity values for one disruption. The
response is computed on demand and **nothing is stored**. Supported pairs:

| Disruption | Parameter | Range |
|---|---|---|
| `inventory_shortage` | `reduction_pct` | 0–100 (%) |
| `route_delay` | `extra_days` | 0–60 (days) |

```json
{
  "baseline_plan_id": "uuid",
  "disruption": { "type": "inventory_shortage",
                  "params": { "warehouse_id": "WH-02", "product_id": "PRD-A" } },
  "parameter": "reduction_pct",
  "values": [25, 50, 75, 100]
}
```

Response (points sorted by value; `cause_counts` aggregates `unmet_diagnosis`):

```json
{
  "baseline_plan_id": "uuid",
  "parameter": "reduction_pct",
  "disruption": { "...": "template event" },
  "respect_deadlines": false,
  "solver": "greedy",
  "baseline": { "fulfillment_rate": 1.0, "unmet": 0, "total_cost": 24240 },
  "points": [
    { "value": 25, "fulfillment_rate": 1.0, "unmet": 0, "total_cost": 24240,
      "risk_score": 16.6, "at_risk_units": 0, "max_late_days": 0,
      "cause_counts": {}, "unmet_rows": 0 }
  ],
  "worst": { "...": "the point with the largest unmet quantity; for delay sweeps, the largest late exposure" },
  "note": "Ephemeral analysis: each point re-solves the same network; nothing is stored."
}
```

For `route_delay`, fulfilment stays at 1.0 by design; use `at_risk_units` and
`max_late_days` to read the curve.

Errors: `400` for an unsupported type/parameter pair, fewer than 2 or more than 7
distinct values, values out of range, or a plan that is not a baseline; `404` for an
unknown plan or dataset.

### `GET /scenarios/{id}`
`{ "scenario": {...}, "baseline_plan": {...}, "disrupted_plan": {...}, "recovered_plan": {...}|null }`

### `PATCH /scenarios/{id}`
```json
{ "name": "Renamed run" }
```
Returns `{ "scenario": { ... "name": "Renamed run" } }`. A blank or whitespace-only
name is `400`; more than 80 characters is `422`.

### `DELETE /scenarios/{id}`
Deletes the scenario **and** the disrupted/recovered plans it owns in one
transaction. The baseline plan is never deleted, even when every scenario
branched from it is removed.

```json
{ "deleted": true, "scenario_id": "...", "deleted_plan_ids": ["..."],
  "baseline_plan_id": "..." }
```

### `POST /scenarios/{id}/recover`
No body. Re-plans with contingency lanes enabled.

```json
{
  "recovered_plan": { "...": "plan document" },
  "recovery_actions": [
    { "type": "activate_contingency_lane", "details": ["RT-13"], "explanation": "Activated 1 contingency lane(s): RT-13", "avg_cost_per_unit": 7.6 },
    { "type": "reallocate", "warehouse_id": "WH-03", "destination_id": "DST-01", "product_id": "PRD-A",
      "route_id": "RT-13", "quantity_delta": 300.0, "activated_contingency_lane": true,
      "cost_per_unit": 7.6, "explanation": "Added 300 units from WH-03 to DST-01 for PRD-A via RT-13 (contingency lane)" },
    { "type": "residual_unmet", "details": [ ... ], "explanation": "Residual unmet demand: ..." }
  ],
  "residual_unmet": [ { "destination_id": "...", "product_id": "...", "quantity": 0, "priority": 1 } ]
}
```

`residual_diagnosis` uses the same shape as `unmet_diagnosis` and explains every
remaining gap after recovery (for example `contingency_only` or `deadline_blocked`).

### `GET /scenarios/{id}/compare`
```json
{
  "baseline":  { "plan_id", "kpis", "plan", "solver_status" },
  "disrupted": { "plan_id", "kpis", "plan", "solver_status" },
  "recovered": { "plan_id", "kpis", "plan", "solver_status" } | null,
  "deltas": {
    "disrupted_vs_baseline":  { "fulfillment_delta": -0.1006, "cost_delta": -1620, "unmet_delta": 500 },
    "recovered_vs_disrupted": { "fulfillment_delta": 0.1006, "cost_delta": 3410, "unmet_delta": -500 },
    "recovered_vs_baseline":  { "fulfillment_delta": 0, "cost_delta": 1790, "unmet_delta": 0 }
  },
  "delivery_risk": { "baseline": {...}, "disrupted": {...}, "recovered": {...} },
  "tradeoff_narrative": "Disruption reduced fulfillment from 100.0% to 89.9%; ... Recovery restored 10.1% fulfillment at $+3410.00 extra cost. All demand is now fulfilled."
}
```

### `GET /scenarios/{id}/export`
`text/csv; charset=utf-8` with `Content-Disposition: attachment; filename="pre-mortem-scenario-xxxxxxxx.csv"`.

Structure: `Scenario: <name> (<id>)` (or `Scenario: <id>` when unnamed), then one block per
plan (`Plan: <id> (<type>)`) containing `Allocations`, `Unmet`, and `KPIs` sections.
Values are the stored computed plan — nothing is recomputed at export time.

---

## Operational

### `GET /health`
```json
{ "status": "ok", "version": "1.0.0", "solver": "greedy",
  "solver_available": false, "db": "ok" }
```
`status` becomes `degraded` and `db` becomes `error` when the database probe fails
(`db_error` carries a short reason). `solver_available` reports whether OR-Tools can
actually be imported, independent of which solver is configured.

### `GET /forecast?destination_id=&product_id=&horizon=`
Baseline moving-average forecast (window 3) with widened p10/p90 band, computed only
from demand rows that match the requested destination×product. **Labeled
`model: "baseline"`** — this is not a trained model and no accuracy is claimed.
Allocation never consumes it implicitly.

With history (oldest → newest):
```json
{ "destination_id": "DST-01", "product_id": "PRD-A", "horizon": 4, "model": "baseline",
  "forecast": [ { "period": 1, "mean": 300.0, "p10": 240.0, "p90": 360.0 } ],
  "history_used": [ { "quantity": 300.0 } ],
  "fallback": false, "reason": null }
```

With no matching history the endpoint does **not** fabricate a series:
```json
{ "destination_id": "DST-X", "product_id": "PRD-X", "horizon": 4, "model": "baseline",
  "forecast": [], "history_used": [], "fallback": true, "reason": "insufficient_history" }
```
