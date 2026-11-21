"""Contract-level regressions: honest solver status, validation and errors."""

from __future__ import annotations

import pytest


def test_landing_demo_story_matches_computed_run(client, dataset, monkeypatch):
    """The landing page's fixed figures must be reproducible from the sample run."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "solver", "greedy")

    baseline = client.post(
        "/api/v1/plans", json={"dataset_id": dataset["dataset_id"], "solver": "greedy"}
    ).json()
    assert baseline["kpis"]["fulfillment_rate"] == pytest.approx(1.0, abs=1e-9)
    assert baseline["kpis"]["total_cost"] == pytest.approx(24240.0, abs=0.01)
    assert baseline["kpis"]["risk_score"] == pytest.approx(16.64, abs=0.01)
    assert len(baseline["allocations"]) == 27

    scen = client.post(
        "/api/v1/scenarios",
        json={"baseline_plan_id": baseline["id"], "disruption": {"type": "route_closure", "params": {"route_id": "RT-03"}}},
    ).json()
    disrupted = scen["disrupted_plan"]
    assert disrupted["kpis"]["fulfillment_rate"] * 100 == pytest.approx(89.9, abs=0.05)
    assert disrupted["kpis"]["unmet"] == pytest.approx(500.0, abs=1e-6)
    assert disrupted["kpis"]["total_cost"] == pytest.approx(22620.0, abs=0.01)
    assert disrupted["kpis"]["risk_score"] == pytest.approx(25.65, abs=0.01)

    recovered = client.post(f"/api/v1/scenarios/{scen['scenario']['id']}/recover").json()
    rp = recovered["recovered_plan"]
    assert rp["kpis"]["fulfillment_rate"] == pytest.approx(1.0, abs=1e-9)
    assert rp["kpis"]["total_cost"] == pytest.approx(26030.0, abs=0.01)
    assert rp["kpis"]["risk_score"] == pytest.approx(11.95, abs=0.01)
    assert {"RT-13", "RT-16", "RT-19"}.issubset({a["route_id"] for a in rp["allocations"]})


def test_plan_responses_expose_solver_status(client, baseline):
    assert baseline["solver_status"] in {"optimal", "feasible", "infeasible", "error"}
    fetched = client.get(f"/api/v1/plans/{baseline['id']}").json()
    assert fetched["solver_status"] == baseline["solver_status"]

    listed = client.get("/api/v1/plans/?limit=1").json()["plans"][0]
    assert "solver_status" in listed


def test_solver_override_is_per_request(client, dataset):
    from app.core.config import settings

    before = settings.solver
    res = client.post("/api/v1/plans", json={"dataset_id": dataset["dataset_id"], "solver": "greedy"})
    assert res.status_code == 200, res.text
    assert res.json()["solver"] == "greedy"
    assert settings.solver == before


def test_invalid_solver_returns_error_envelope(client, dataset):
    res = client.post("/api/v1/plans", json={"dataset_id": dataset["dataset_id"], "solver": "magic"})
    assert res.status_code == 400
    body = res.json()
    assert body["code"] == "bad_request"
    assert "magic" in body["detail"]


def test_not_found_and_validation_errors_use_envelope(client):
    missing = client.get("/api/v1/plans/does-not-exist")
    assert missing.status_code == 404
    assert missing.json()["code"] == "not_found"

    invalid = client.post("/api/v1/plans", json={})
    assert invalid.status_code == 422
    body = invalid.json()
    assert body["code"] == "validation_error"
    assert body["errors"]


def test_scenario_requires_baseline_plan_type(client, baseline):
    scen = client.post(
        "/api/v1/scenarios",
        json={"baseline_plan_id": baseline["id"], "disruption": {"type": "route_closure", "params": {"route_id": "RT-03"}}},
    ).json()
    disrupted_id = scen["disrupted_plan"]["id"]

    res = client.post(
        "/api/v1/scenarios",
        json={"baseline_plan_id": disrupted_id, "disruption": {"type": "route_closure", "params": {"route_id": "RT-04"}}},
    )
    assert res.status_code == 400
    assert res.json()["code"] == "bad_request"


def test_list_plans_filters_before_limit(client, baseline):
    client.post(
        "/api/v1/scenarios",
        json={"baseline_plan_id": baseline["id"], "disruption": {"type": "route_closure", "params": {"route_id": "RT-03"}}},
    )

    res = client.get("/api/v1/plans/", params={"limit": 1, "plan_type": "baseline"})
    assert res.status_code == 200
    body = res.json()
    assert len(body["plans"]) == 1
    assert body["plans"][0]["type"] == "baseline"
