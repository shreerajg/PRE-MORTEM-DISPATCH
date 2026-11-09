"""Resilience and mitigation intelligence are computed from the model, not narrated."""

from __future__ import annotations

import pytest


def _scenario_closure(client, baseline, route_id="RT-03"):
    res = client.post(
        "/api/v1/scenarios",
        json={
            "baseline_plan_id": baseline["id"],
            "disruption": {"type": "route_closure", "params": {"route_id": route_id}},
        },
    )
    assert res.status_code == 200, res.text
    return res.json()


def test_plan_resilience_uses_a_documented_weighted_score(client, baseline):
    plans_before = client.get("/api/v1/plans/").json()["total"]
    activity_before = client.get("/api/v1/activity?limit=1").json()["total"]

    res = client.get(f"/api/v1/plans/{baseline['id']}/resilience")
    assert res.status_code == 200, res.text
    body = res.json()

    assert body["plan_id"] == baseline["id"]
    assert 0 <= body["score"] <= 100
    assert body["grade"] in {"resilient", "prepared", "fragile", "critical"}
    assert len(body["score_components"]) == 5
    assert sum(component["points"] for component in body["score_components"]) == pytest.approx(
        body["score"], abs=0.02
    )
    assert body["metrics"]["contingency_routes"] > 0
    assert all(0 <= component["rate"] <= 1 for component in body["score_components"])
    assert any("lane" in vulnerability["title"].lower() for vulnerability in body["vulnerabilities"])
    assert "30×lane redundancy" in body["definition"]
    assert body["note"].startswith("Ephemeral readiness assessment")

    assert client.get("/api/v1/plans/").json()["total"] == plans_before
    assert client.get("/api/v1/activity?limit=1").json()["total"] == activity_before


def test_non_baseline_plan_cannot_be_assessed_as_resilience(client, baseline):
    scenario = _scenario_closure(client, baseline)
    disrupted_id = scenario["disrupted_plan"]["id"]
    res = client.get(f"/api/v1/plans/{disrupted_id}/resilience")
    assert res.status_code == 400
    assert "baseline" in res.json()["detail"].lower()


def test_scenario_brief_projects_consumer_service_and_tests_a_mitigation(client, baseline):
    scenario = _scenario_closure(client, baseline)
    sid = scenario["scenario"]["id"]
    scenarios_before = client.get("/api/v1/scenarios/").json()["total"]
    plans_before = client.get("/api/v1/plans/").json()["total"]
    activity_before = client.get("/api/v1/activity?limit=1").json()["total"]

    res = client.get(f"/api/v1/scenarios/{sid}/brief")
    assert res.status_code == 200, res.text
    body = res.json()

    service = body["service"]
    assert service["coverage_rate"] < 1.0
    assert service["unmet"] > 0
    assert service["critical_unmet_units"] > 0
    assert service["on_time_rate"] <= service["coverage_rate"] + 1e-9
    assert service["largest_gaps"]
    assert "on time" in service["statement"].lower()
    assert service["model"]["consumer_scope"] == "modelled destination demand, not named individual consumers"

    mitigations = [
        item
        for item in body["recommendations"]
        if item["kind"] == "activate_contingency_lane" and item["status"] == "validated"
    ]
    assert mitigations, body["recommendations"]
    best = mitigations[0]
    assert best["tested"] is True
    assert best["effect"]["restored_units"] > 0
    assert best["projected"]["coverage_rate"] >= service["coverage_rate"]
    assert "RT-" in best["title"]

    assert client.get("/api/v1/scenarios/").json()["total"] == scenarios_before
    assert client.get("/api/v1/plans/").json()["total"] == plans_before
    assert client.get("/api/v1/activity?limit=1").json()["total"] == activity_before


def test_scenario_brief_requires_a_disrupted_plan(client, baseline):
    res = client.get("/api/v1/scenarios/does-not-exist/brief")
    assert res.status_code == 404
