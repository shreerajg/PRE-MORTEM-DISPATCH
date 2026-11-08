"""Scenario lifecycle: optional names, rename, and safe deletion."""

from __future__ import annotations

CLOSURE = {"type": "route_closure", "params": {"route_id": "RT-03"}}


def _create(client, baseline, name=None):
    payload = {"baseline_plan_id": baseline["id"], "disruption": CLOSURE}
    if name is not None:
        payload["name"] = name
    res = client.post("/api/v1/scenarios", json=payload)
    assert res.status_code == 200, res.text
    return res.json()


def test_scenario_name_is_trimmed_and_returned_everywhere(client, baseline):
    body = _create(client, baseline, name="  Q4 lane failure  ")
    scenario_id = body["scenario"]["id"]
    assert body["scenario"]["name"] == "Q4 lane failure"

    detail = client.get(f"/api/v1/scenarios/{scenario_id}").json()
    assert detail["scenario"]["name"] == "Q4 lane failure"

    listed = client.get("/api/v1/scenarios/", params={"limit": 100}).json()["scenarios"]
    row = next(s for s in listed if s["id"] == scenario_id)
    assert row["name"] == "Q4 lane failure"

    unnamed = _create(client, baseline)
    assert unnamed["scenario"]["name"] is None


def test_rename_scenario(client, baseline):
    scenario_id = _create(client, baseline, name="First name")["scenario"]["id"]

    res = client.patch(f"/api/v1/scenarios/{scenario_id}", json={"name": "  Renamed  "})
    assert res.status_code == 200, res.text
    assert res.json()["scenario"]["name"] == "Renamed"
    assert client.get(f"/api/v1/scenarios/{scenario_id}").json()["scenario"]["name"] == "Renamed"

    blank = client.patch(f"/api/v1/scenarios/{scenario_id}", json={"name": "   "})
    assert blank.status_code == 400
    assert blank.json()["code"] == "bad_request"

    empty = client.patch(f"/api/v1/scenarios/{scenario_id}", json={"name": ""})
    assert empty.status_code == 422

    too_long = client.patch(f"/api/v1/scenarios/{scenario_id}", json={"name": "x" * 81})
    assert too_long.status_code == 422

    assert client.patch("/api/v1/scenarios/nope", json={"name": "x"}).status_code == 404


def test_export_includes_scenario_name(client, baseline):
    body = _create(client, baseline, name="Named export")
    scenario_id = body["scenario"]["id"]

    res = client.get(f"/api/v1/scenarios/{scenario_id}/export")
    assert res.status_code == 200
    assert f"Scenario: Named export ({scenario_id})" in res.text


def test_delete_scenario_removes_owned_plans_but_keeps_baseline(client, baseline):
    body = _create(client, baseline, name="Disposable")
    scenario_id = body["scenario"]["id"]
    disrupted_id = body["scenario"]["disrupted_plan_id"]

    recovered = client.post(f"/api/v1/scenarios/{scenario_id}/recover").json()
    recovered_id = recovered["recovered_plan"]["id"]

    res = client.delete(f"/api/v1/scenarios/{scenario_id}")
    assert res.status_code == 200, res.text
    payload = res.json()
    assert payload["deleted"] is True
    assert set(payload["deleted_plan_ids"]) == {disrupted_id, recovered_id}
    assert payload["baseline_plan_id"] == baseline["id"]

    assert client.get(f"/api/v1/scenarios/{scenario_id}").status_code == 404
    assert client.get(f"/api/v1/plans/{disrupted_id}").status_code == 404
    assert client.get(f"/api/v1/plans/{recovered_id}").status_code == 404
    # The shared baseline survives: history is not collateral damage.
    assert client.get(f"/api/v1/plans/{baseline['id']}").status_code == 200

    listed = client.get("/api/v1/scenarios/", params={"limit": 100}).json()["scenarios"]
    assert scenario_id not in {s["id"] for s in listed}


def test_plan_deletion_checks_references_atomically(client, baseline):
    from app.repo import database as db

    _create(client, baseline)
    deleted, referenced = db.delete_plan_if_unreferenced(baseline["id"])
    assert (deleted, referenced) == (False, True)

    standalone = client.post(
        "/api/v1/plans", json={"dataset_id": baseline["dataset_id"]}
    ).json()
    deleted, referenced = db.delete_plan_if_unreferenced(standalone["id"])
    assert (deleted, referenced) == (True, False)
    assert db.get_plan(standalone["id"]) is None


def test_deleting_one_scenario_leaves_the_others_intact(client, baseline):
    keep = _create(client, baseline, name="Keep me")
    drop = _create(client, baseline, name="Drop me")

    assert client.delete(f"/api/v1/scenarios/{drop['scenario']['id']}").status_code == 200
    assert client.get(f"/api/v1/scenarios/{keep['scenario']['id']}").status_code == 200
    assert client.get(f"/api/v1/plans/{keep['scenario']['disrupted_plan_id']}").status_code == 200

    assert client.delete(f"/api/v1/scenarios/{drop['scenario']['id']}").status_code == 404
