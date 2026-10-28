"""Hard deadline planning: opt-in, explicit, and inherited by scenarios."""

from __future__ import annotations

import uuid

import pytest

from app.domain.schemas import AllocationInput, Demand, Inventory, Route
from app.services.allocation import solve_allocation


def _network(respect: bool, transit_days: float = 5.0, deadline: float = 3.0) -> AllocationInput:
    return AllocationInput(
        inventory=[Inventory(warehouse_id="WH-1", product_id="P-1", quantity=100)],
        demand=[Demand(destination_id="D-1", product_id="P-1", quantity=10)],
        routes=[
            Route(
                id="RT-1",
                warehouse_id="WH-1",
                destination_id="D-1",
                capacity=100,
                cost_per_unit=2.0,
                time_days=transit_days,
            )
        ],
        priorities={"D-1": 1},
        deadlines={"D-1": deadline},
        respect_deadlines=respect,
    )


def test_deadline_is_advisory_by_default():
    result = solve_allocation(_network(respect=False), solver="greedy")
    assert result.fulfillment_rate == pytest.approx(1.0)
    assert result.unmet == []
    assert "deadline_enforced" not in result.diagnostics


def test_deadline_hard_constraint_leaves_demand_unmet():
    result = solve_allocation(_network(respect=True), solver="greedy")
    assert result.fulfillment_rate == pytest.approx(0.0)
    assert sum(u.quantity for u in result.unmet) == pytest.approx(10.0)
    assert result.diagnostics["deadline_enforced"] is True
    assert result.diagnostics["lanes_excluded_by_deadline"] == ["RT-1"]


def test_lane_that_meets_the_deadline_is_used():
    result = solve_allocation(_network(respect=True, transit_days=2.0), solver="greedy")
    assert result.fulfillment_rate == pytest.approx(1.0)
    assert [a.route_id for a in result.allocations] == ["RT-1"]


def _save_dataset() -> str:
    from app.repo import database as db

    dataset_id = f"deadline-{uuid.uuid4().hex[:8]}"
    db.save_dataset(
        dataset_id,
        name="deadline-fixture",
        created_at="2026-01-01T00:00:00+00:00",
        meta={
            "warehouses": [{"id": "WH-1", "name": "Hub", "region": "North"}],
            "destinations": [
                {"id": "D-1", "name": "Clinic", "priority": 1, "region": "North", "deadline_days": 3}
            ],
            "products": [{"id": "P-1", "name": "Sensor", "unit": "units"}],
            "routes": [
                {
                    "id": "RT-1", "warehouse_id": "WH-1", "destination_id": "D-1",
                    "capacity": 100, "cost_per_unit": 2, "time_days": 5,
                    "available": True, "product_ids": None, "backup": False,
                },
                {
                    "id": "RT-9", "warehouse_id": "WH-1", "destination_id": "D-1",
                    "capacity": 100, "cost_per_unit": 4, "time_days": 5,
                    "available": True, "product_ids": None, "backup": True,
                },
            ],
            "inventory": [{"warehouse_id": "WH-1", "product_id": "P-1", "quantity": 100}],
            "demand": [{"destination_id": "D-1", "product_id": "P-1", "quantity": 10}],
        },
    )
    return dataset_id


def test_plan_endpoint_enforces_and_scenarios_inherit_the_policy(client):
    dataset_id = _save_dataset()

    # Default: deadlines stay a KPI, the slow lane is usable.
    relaxed = client.post("/api/v1/plans", json={"dataset_id": dataset_id}).json()
    assert relaxed["kpis"]["fulfillment_rate"] == pytest.approx(1.0)
    assert relaxed["constraints"] == {"respect_deadlines": False}

    enforced = client.post(
        "/api/v1/plans",
        json={"dataset_id": dataset_id, "respect_deadlines": True},
    )
    assert enforced.status_code == 200, enforced.text
    body = enforced.json()
    assert body["kpis"]["unmet"] == pytest.approx(10.0)
    assert body["constraints"] == {"respect_deadlines": True}
    assert body["diagnostics"]["deadline_enforced"] is True

    fetched = client.get(f"/api/v1/plans/{body['id']}").json()
    assert fetched["constraints"] == {"respect_deadlines": True}

    scen = client.post(
        "/api/v1/scenarios",
        json={
            "baseline_plan_id": body["id"],
            "disruption": {"type": "route_closure", "params": {"route_id": "RT-1"}},
        },
    ).json()
    disrupted = scen["disrupted_plan"]
    assert disrupted["kpis"]["unmet"] == pytest.approx(10.0)
    disrupted_plan = client.get(f"/api/v1/plans/{disrupted['id']}").json()
    assert disrupted_plan["constraints"] == {"respect_deadlines": True}
    assert disrupted_plan["diagnostics"]["deadline_enforced"] is True

    # Recovery may use contingency lanes, but not ones that still miss the deadline.
    recovered = client.post(f"/api/v1/scenarios/{scen['scenario']['id']}/recover").json()
    assert recovered["recovered_plan"]["kpis"]["unmet"] == pytest.approx(10.0)
    assert any(a["type"] == "residual_unmet" for a in recovered["recovery_actions"])
    recovered_plan = client.get(f"/api/v1/plans/{recovered['recovered_plan']['id']}").json()
    assert recovered_plan["constraints"] == {"respect_deadlines": True}
