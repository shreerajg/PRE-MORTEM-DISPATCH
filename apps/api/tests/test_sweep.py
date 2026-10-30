"""Sensitivity sweeps: computed curves, validation, and no persistence."""

from __future__ import annotations

import pytest

SHORTAGE = {
    "type": "inventory_shortage",
    "params": {"warehouse_id": "WH-02", "product_id": "PRD-A"},
}


def _sweep(client, baseline_id, disruption, parameter, values):
    return client.post(
        "/api/v1/scenarios/sweep",
        json={
            "baseline_plan_id": baseline_id,
            "disruption": disruption,
            "parameter": parameter,
            "values": values,
        },
    )


def test_shortage_sweep_degrades_fulfillment_and_stores_nothing(client, baseline):
    scenarios_before = client.get("/api/v1/scenarios/", params={"limit": 100}).json()["total"]
    plans_before = client.get("/api/v1/plans/", params={"limit": 100}).json()["total"]

    res = _sweep(client, baseline["id"], SHORTAGE, "reduction_pct", [100, 0, 50])
    assert res.status_code == 200, res.text
    body = res.json()

    assert body["parameter"] == "reduction_pct"
    assert body["baseline"]["fulfillment_rate"] == pytest.approx(1.0)
    assert [p["value"] for p in body["points"]] == [0.0, 50.0, 100.0]

    rates = [p["fulfillment_rate"] for p in body["points"]]
    assert rates[0] == pytest.approx(1.0)
    assert all(a >= b - 1e-9 for a, b in zip(rates, rates[1:])), rates
    assert body["points"][-1]["unmet"] > 0
    assert body["worst"]["value"] == 100.0
    assert body["points"][-1]["cause_counts"]

    scenarios_after = client.get("/api/v1/scenarios/", params={"limit": 100}).json()["total"]
    plans_after = client.get("/api/v1/plans/", params={"limit": 100}).json()["total"]
    assert scenarios_after == scenarios_before
    assert plans_after == plans_before


def test_delay_sweep_keeps_volume_and_raises_lateness(client, baseline):
    res = _sweep(
        client,
        baseline["id"],
        {"type": "route_delay", "params": {"route_id": "RT-06"}},
        "extra_days",
        [0, 4, 8],
    )
    assert res.status_code == 200, res.text
    points = res.json()["points"]

    assert [p["value"] for p in points] == [0.0, 4.0, 8.0]
    # A delay does not remove capacity, so volume stays at 100%.
    assert all(p["fulfillment_rate"] == pytest.approx(1.0) for p in points)
    at_risk = [p["at_risk_units"] for p in points]
    assert all(a <= b + 1e-9 for a, b in zip(at_risk, at_risk[1:]))
    assert points[-1]["max_late_days"] > 0
    # For a delay sweep the worst case is the latest exposure, not the first point
    # just because every point has zero unmet volume.
    assert res.json()["worst"]["value"] == 8.0
    assert res.json()["worst"]["at_risk_units"] == points[-1]["at_risk_units"]


def test_sweep_validation(client, baseline):
    assert _sweep(client, baseline["id"], SHORTAGE, "extra_days", [10, 20]).status_code == 400
    assert _sweep(
        client,
        baseline["id"],
        {"type": "route_closure", "params": {"route_id": "RT-03"}},
        "reduction_pct",
        [10, 20],
    ).status_code == 400
    assert _sweep(client, baseline["id"], SHORTAGE, "reduction_pct", [50]).status_code == 400
    assert _sweep(client, baseline["id"], SHORTAGE, "reduction_pct", [50, 50]).status_code == 400
    assert _sweep(
        client, baseline["id"], SHORTAGE, "reduction_pct", [10, 20, 30, 40, 50, 60, 70, 80]
    ).status_code == 400
    assert _sweep(client, baseline["id"], SHORTAGE, "reduction_pct", [-5, 50]).status_code == 400
    assert _sweep(client, baseline["id"], SHORTAGE, "reduction_pct", [50, 150]).status_code == 400
    assert _sweep(client, "does-not-exist", SHORTAGE, "reduction_pct", [10, 20]).status_code == 404


def test_sweep_requires_a_baseline_plan(client, baseline):
    scen = client.post(
        "/api/v1/scenarios",
        json={"baseline_plan_id": baseline["id"], "disruption": {"type": "route_closure", "params": {"route_id": "RT-03"}}},
    ).json()
    disrupted_id = scen["disrupted_plan"]["id"]

    res = _sweep(client, disrupted_id, SHORTAGE, "reduction_pct", [10, 20])
    assert res.status_code == 400
    assert "baseline" in res.json()["detail"].lower()
