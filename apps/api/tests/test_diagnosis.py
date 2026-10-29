"""Unmet diagnosis: each cause is only claimed when the inputs support it."""

from __future__ import annotations

from app.domain.schemas import AllocationInput, Demand, Inventory, Route
from app.services.allocation import solve_allocation
from app.services.diagnosis import diagnose_unmet


def _input(inventory, demand, routes, deadlines=None, respect=False, priorities=None):
    return AllocationInput(
        inventory=[Inventory(**row) for row in inventory],
        demand=[Demand(**row) for row in demand],
        routes=[Route(**row) for row in routes],
        deadlines=deadlines or {},
        respect_deadlines=respect,
        priorities=priorities or {},
    )


def _diagnose(inp, allow_backup=False):
    result = solve_allocation(inp, allow_backup=allow_backup, solver="greedy")
    return result, diagnose_unmet(inp, result, allow_backup=allow_backup)


def _route(route_id="RT-1", dest="D-1", cap=100, time_days=1, product_ids=None, backup=False):
    return {
        "id": route_id,
        "warehouse_id": "WH-1",
        "destination_id": dest,
        "capacity": cap,
        "cost_per_unit": 1.0,
        "time_days": time_days,
        "product_ids": product_ids,
        "backup": backup,
    }


def _demand(product="P-1", dest="D-1", qty=10):
    return {"destination_id": dest, "product_id": product, "quantity": qty}


def test_no_lane_to_destination():
    _, diagnoses = _diagnose(_input([], [_demand()], []))
    assert diagnoses[0]["cause"] == "no_route"


def test_product_filter_blocks_every_lane():
    _, diagnoses = _diagnose(
        _input([{"warehouse_id": "WH-1", "product_id": "P-1", "quantity": 10}],
               [_demand()], [_route(product_ids=["P-2"])])
    )
    assert diagnoses[0]["cause"] == "product_not_allowed"


def test_deadline_can_block_every_lane():
    _, diagnoses = _diagnose(
        _input(
            [{"warehouse_id": "WH-1", "product_id": "P-1", "quantity": 10}],
            [_demand()],
            [_route(time_days=5)],
            deadlines={"D-1": 3},
            respect=True,
        )
    )
    assert diagnoses[0]["cause"] == "deadline_blocked"
    assert diagnoses[0]["evidence"]["deadline_blocked_lanes"] == ["RT-1"]


def test_no_reachable_inventory():
    _, diagnoses = _diagnose(
        _input([], [_demand()], [_route()])
    )
    assert diagnoses[0]["cause"] == "no_inventory"


def test_reachable_inventory_below_demand():
    _, diagnoses = _diagnose(
        _input([{"warehouse_id": "WH-1", "product_id": "P-1", "quantity": 5}],
               [_demand()], [_route()])
    )
    assert diagnoses[0]["cause"] == "inventory_short"


def test_lane_capacity_below_demand():
    _, diagnoses = _diagnose(
        _input([{"warehouse_id": "WH-1", "product_id": "P-1", "quantity": 100}],
               [_demand()], [_route(cap=4)])
    )
    assert diagnoses[0]["cause"] == "lane_capacity"


def test_both_stock_and_capacity_short():
    _, diagnoses = _diagnose(
        _input([{"warehouse_id": "WH-1", "product_id": "P-1", "quantity": 5}],
               [_demand()], [_route(cap=4)])
    )
    assert diagnoses[0]["cause"] == "combined"


def test_capacity_shared_with_a_higher_priority_product():
    inp = _input(
        [{"warehouse_id": "WH-1", "product_id": "P-1", "quantity": 100},
         {"warehouse_id": "WH-1", "product_id": "P-2", "quantity": 100}],
        [_demand(product="P-1", qty=9), _demand(product="P-2", qty=8)],
        [_route(cap=10)],
    )
    result, diagnoses = _diagnose(inp)
    assert sum(u.quantity for u in result.unmet) == 7
    assert {d["product_id"]: d["cause"] for d in diagnoses}["P-2"] == "capacity_shared"


def test_inventory_shared_with_a_higher_priority_destination():
    inp = _input(
        [{"warehouse_id": "WH-1", "product_id": "P-1", "quantity": 9}],
        [_demand(dest="D-1", qty=8), _demand(dest="D-2", qty=8)],
        [_route(route_id="RT-1", dest="D-1"), _route(route_id="RT-2", dest="D-2")],
        priorities={"D-1": 1, "D-2": 2},
    )
    result, diagnoses = _diagnose(inp)
    assert {u.destination_id: u.quantity for u in result.unmet} == {"D-2": 7}
    assert diagnoses[0]["cause"] == "inventory_shared"


def test_contingency_only_until_recovery():
    inp = _input(
        [{"warehouse_id": "WH-1", "product_id": "P-1", "quantity": 10}],
        [_demand()],
        [_route(backup=True)],
    )
    _, baseline = _diagnose(inp, allow_backup=False)
    assert baseline[0]["cause"] == "contingency_only"
    assert baseline[0]["evidence"]["contingency_lanes"] == ["RT-1"]

    result, recovery = _diagnose(inp, allow_backup=True)
    assert result.unmet == []
    assert recovery == []


def test_api_plans_and_scenarios_expose_diagnosis(client, baseline):
    assert baseline["unmet_diagnosis"] == []
    fetched = client.get(f"/api/v1/plans/{baseline['id']}").json()
    assert fetched["unmet_diagnosis"] == []

    scen = client.post(
        "/api/v1/scenarios",
        json={"baseline_plan_id": baseline["id"], "disruption": {"type": "route_closure", "params": {"route_id": "RT-03"}}},
    ).json()
    disrupted = scen["disrupted_plan"]
    assert len(disrupted["unmet_diagnosis"]) == len(disrupted["unmet"]) > 0
    for diagnosis in disrupted["unmet_diagnosis"]:
        assert diagnosis["cause"]
        assert diagnosis["explanation"]
        assert diagnosis["evidence"]["unmet"] > 0

    recovered = client.post(f"/api/v1/scenarios/{scen['scenario']['id']}/recover").json()
    assert isinstance(recovered["residual_diagnosis"], list)
    assert len(recovered["residual_diagnosis"]) == len(recovered["residual_unmet"])

    stored = client.get(f"/api/v1/plans/{recovered['recovered_plan']['id']}").json()
    assert isinstance(stored["unmet_diagnosis"], list)
