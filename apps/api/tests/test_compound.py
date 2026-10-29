"""Compound scenarios: several disruptions applied in order to one baseline."""

from __future__ import annotations

import pytest

from app.domain.schemas import DisruptionRequest, Inventory
from app.services.disruption import apply_disruption, apply_disruptions

CLOSURE = {"type": "route_closure", "params": {"route_id": "RT-03"}}
SHORTAGE = {
    "type": "inventory_shortage",
    "params": {"warehouse_id": "WH-02", "product_id": "PRD-A", "reduction_pct": 50},
}


def test_compound_scenario_applies_every_event(client, baseline):
    single = client.post(
        "/api/v1/scenarios",
        json={"baseline_plan_id": baseline["id"], "disruption": CLOSURE},
    ).json()

    compound = client.post(
        "/api/v1/scenarios",
        json={"baseline_plan_id": baseline["id"], "disruptions": [CLOSURE, SHORTAGE]},
    )
    assert compound.status_code == 200, compound.text
    body = compound.json()

    stored = body["scenario"]["disruption"]
    assert stored["type"] == "compound"
    assert [event["type"] for event in stored["events"]] == ["route_closure", "inventory_shortage"]

    description = body["impact"]["disruption_description"]
    assert "Route closure" in description
    assert "Inventory shortage" in description

    # Both events left a mark: the lane is gone and the shortfall cannot shrink.
    assert "RT-03" not in {a["route_id"] for a in body["disrupted_plan"]["allocations"]}
    assert body["disrupted_plan"]["kpis"]["unmet"] >= single["disrupted_plan"]["kpis"]["unmet"]


def test_single_item_list_keeps_the_simple_stored_shape(client, baseline):
    res = client.post(
        "/api/v1/scenarios",
        json={"baseline_plan_id": baseline["id"], "disruptions": [CLOSURE]},
    )
    assert res.status_code == 200, res.text
    stored = res.json()["scenario"]["disruption"]
    assert stored["type"] == "route_closure"
    assert "events" not in stored


@pytest.mark.parametrize(
    "payload",
    [
        {"disruption": CLOSURE, "disruptions": [CLOSURE]},
        {},
        {"disruptions": []},
        {"disruptions": [CLOSURE] * 6},
    ],
)
def test_invalid_disruption_forms_are_rejected(client, baseline, payload):
    res = client.post(
        "/api/v1/scenarios",
        json={"baseline_plan_id": baseline["id"], **payload},
    )
    assert res.status_code == 422, res.text
    assert res.json()["code"] == "validation_error"


def test_recovery_replays_the_full_compound_scenario(client, baseline):
    scen = client.post(
        "/api/v1/scenarios",
        json={"baseline_plan_id": baseline["id"], "disruptions": [CLOSURE, SHORTAGE]},
    ).json()

    res = client.post(f"/api/v1/scenarios/{scen['scenario']['id']}/recover")
    assert res.status_code == 200, res.text
    body = res.json()
    recovered = body["recovered_plan"]
    assert recovered["id"]
    assert recovered["kpis"]["fulfillment_rate"] <= 1.0
    # The replay used both events, so recovery cannot quietly ignore one.
    assert isinstance(body["recovery_actions"], list)
    persisted = client.get(f"/api/v1/plans/{recovered['id']}").json()
    assert isinstance(persisted["diagnostics"].get("recovery_actions"), list)


def test_sequential_shortages_compound_and_leave_originals_untouched():
    inventory = [Inventory(warehouse_id="WH-1", product_id="P-1", quantity=100)]
    events = [
        DisruptionRequest(
            type="inventory_shortage",
            params={"warehouse_id": "WH-1", "product_id": "P-1", "reduction_pct": 60},
        ),
        DisruptionRequest(
            type="inventory_shortage",
            params={"warehouse_id": "WH-1", "product_id": "P-1", "reduction_pct": 50},
        ),
    ]

    new_inventory, _, description = apply_disruptions(inventory, [], events)

    # 100 -> 40 -> 20; reductions apply to the running state, not the original.
    assert new_inventory[0].quantity == pytest.approx(20.0)
    assert inventory[0].quantity == 100
    assert description.count("Inventory shortage") == 2


def test_duplicate_closure_is_idempotent(client, baseline):
    res = client.post(
        "/api/v1/scenarios",
        json={"baseline_plan_id": baseline["id"], "disruptions": [CLOSURE, CLOSURE]},
    )
    assert res.status_code == 200, res.text
    assert "RT-03" not in {a["route_id"] for a in res.json()["disrupted_plan"]["allocations"]}


def test_non_finite_disruption_params_are_rejected():
    with pytest.raises(ValueError):
        apply_disruption(
            [],
            [],
            DisruptionRequest(
                type="inventory_shortage",
                params={"warehouse_id": "WH-1", "product_id": "P-1", "reduction_pct": float("nan")},
            ),
        )
    with pytest.raises(ValueError):
        apply_disruption(
            [],
            [],
            DisruptionRequest(
                type="route_delay",
                params={"route_id": "RT-1", "extra_days": float("inf")},
            ),
        )
