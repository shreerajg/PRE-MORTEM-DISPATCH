"""Workspace lifecycle, audit trail and analytics aggregation."""

from __future__ import annotations

CLOSURE = {"type": "route_closure", "params": {"route_id": "RT-03"}}
SHORTAGE = {
    "type": "inventory_shortage",
    "params": {"warehouse_id": "WH-02", "product_id": "PRD-A", "reduction_pct": 50},
}


def _scenario(client, baseline, disruption, name):
    res = client.post(
        "/api/v1/scenarios",
        json={"baseline_plan_id": baseline["id"], "disruption": disruption, "name": name},
    )
    assert res.status_code == 200, res.text
    return res.json()


def test_dataset_rename_is_trimmed_and_validated(client, dataset):
    dataset_id = dataset["dataset_id"]

    res = client.patch(f"/api/v1/datasets/{dataset_id}", json={"name": "  Renamed network  "})
    assert res.status_code == 200, res.text
    assert res.json()["name"] == "Renamed network"
    assert client.get(f"/api/v1/datasets/{dataset_id}").json()["name"] == "Renamed network"

    blank = client.patch(f"/api/v1/datasets/{dataset_id}", json={"name": "   "})
    assert blank.status_code == 400
    assert blank.json()["code"] == "bad_request"

    too_long = client.patch(f"/api/v1/datasets/{dataset_id}", json={"name": "x" * 81})
    assert too_long.status_code == 422

    assert client.patch("/api/v1/datasets/nope", json={"name": "x"}).status_code == 404


def test_delete_dataset_cascades_plans_and_scenarios(client, dataset):
    dataset_id = dataset["dataset_id"]
    baseline = client.post("/api/v1/plans", json={"dataset_id": dataset_id}).json()
    created = _scenario(client, baseline, CLOSURE, "cascade target")
    scenario_id = created["scenario"]["id"]
    recovered = client.post(f"/api/v1/scenarios/{scenario_id}/recover").json()

    deleted = client.delete(f"/api/v1/datasets/{dataset_id}")
    assert deleted.status_code == 200, deleted.text
    body = deleted.json()
    assert body["deleted"] is True
    assert body["deleted_plans"] >= 2
    assert body["deleted_scenarios"] >= 1

    assert client.get(f"/api/v1/datasets/{dataset_id}").status_code == 404
    assert client.get(f"/api/v1/plans/{baseline['id']}").status_code == 404
    assert client.get(f"/api/v1/plans/{created['scenario']['disrupted_plan_id']}").status_code == 404
    assert client.get(f"/api/v1/plans/{recovered['recovered_plan']['id']}").status_code == 404
    assert client.get(f"/api/v1/scenarios/{scenario_id}").status_code == 404

    assert client.delete(f"/api/v1/datasets/{dataset_id}").status_code == 404

    latest = client.get("/api/v1/activity", params={"limit": 1}).json()["events"][0]
    assert latest["action"] == "dataset.deleted"
    assert latest["detail"]["deleted_plans"] == body["deleted_plans"]


def test_plan_deletion_refuses_when_a_scenario_needs_it(client, dataset):
    baseline = client.post("/api/v1/plans", json={"dataset_id": dataset["dataset_id"]}).json()
    _scenario(client, baseline, CLOSURE, "keeps baseline")

    blocked = client.delete(f"/api/v1/plans/{baseline['id']}")
    assert blocked.status_code == 409
    assert blocked.json()["code"] == "conflict"
    assert "scenario" in blocked.json()["detail"].lower()

    unused = client.post("/api/v1/plans", json={"dataset_id": dataset["dataset_id"]}).json()
    removed = client.delete(f"/api/v1/plans/{unused['id']}")
    assert removed.status_code == 200
    assert removed.json()["deleted"] is True
    assert client.get(f"/api/v1/plans/{unused['id']}").status_code == 404

    latest = client.get("/api/v1/activity", params={"limit": 1}).json()["events"][0]
    assert latest["action"] == "plan.deleted"
    assert latest["entity_id"] == unused["id"]

    assert client.delete("/api/v1/plans/nope").status_code == 404


def test_activity_trail_records_the_workspace_story(client, dataset):
    dataset_id = dataset["dataset_id"]
    baseline = client.post("/api/v1/plans", json={"dataset_id": dataset_id}).json()
    _scenario(client, baseline, CLOSURE, "audited scenario")

    res = client.get("/api/v1/activity", params={"limit": 5})
    assert res.status_code == 200
    body = res.json()
    assert body["total"] >= 3
    assert 1 <= len(body["events"]) <= 5

    actions = {event["action"] for event in body["events"]}
    assert "dataset.created" in actions
    assert "plan.created" in actions
    assert "scenario.created" in actions

    newest = body["events"][0]
    assert {"id", "at", "action", "entity_type", "entity_id", "detail"} <= set(newest)


def test_analytics_overview_aggregates_scenarios(client, dataset):
    baseline = client.post("/api/v1/plans", json={"dataset_id": dataset["dataset_id"]}).json()
    closed = _scenario(client, baseline, CLOSURE, "analytics closure")
    recovered = client.post(f"/api/v1/scenarios/{closed['scenario']['id']}/recover")
    assert recovered.status_code == 200
    shortage = _scenario(client, baseline, SHORTAGE, "analytics shortage")

    body = client.get("/api/v1/analytics/overview").json()
    assert body["total_scenarios"] >= body["scenarios_analyzed"] >= 2
    assert body["summary"]["scenarios_analyzed"] == len(body["trend"])
    assert body["summary"]["recovered"] >= 1

    types = {row["type"]: row for row in body["by_type"]}
    assert types["route_closure"]["count"] >= 1
    assert types["inventory_shortage"]["count"] >= 1

    trend_ids = [item["id"] for item in body["trend"]]
    assert trend_ids.index(closed["scenario"]["id"]) < trend_ids.index(shortage["scenario"]["id"])

    recovered_item = next(item for item in body["trend"] if item["id"] == closed["scenario"]["id"])
    assert recovered_item["recovered_fulfillment"] == 1.0
    assert recovered_item["recovery_cost"] is not None
    assert recovered_item["restored_pp"] is not None

    # Empty windows still return a valid shape.
    small = client.get("/api/v1/analytics/overview", params={"limit": 1}).json()
    assert len(small["trend"]) == 1
    assert small["limit"] == 1
