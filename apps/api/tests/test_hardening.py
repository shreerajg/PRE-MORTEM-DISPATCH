"""Robustness regressions: request tracing, pagination, SQLite settings, uploads,
numeric sanity and deterministic lane choice."""

from __future__ import annotations

import importlib.util
import uuid

import pytest

from app.domain.schemas import AllocationInput, Demand, Inventory, Route
from app.services.allocation import solve_allocation
from app.services.normalize import as_float, as_optional_float
from app.services.validation import validate_dataset


def test_requests_carry_a_traceable_id(client):
    res = client.get("/api/v1/health")
    assert res.status_code == 200
    assert res.headers["X-Request-ID"]
    assert float(res.headers["X-Process-Time-Ms"]) >= 0.0

    # A caller-supplied id is preserved, and quoted back in the error envelope.
    res = client.get("/api/v1/plans/does-not-exist", headers={"X-Request-ID": "trace-me-123"})
    assert res.status_code == 404
    assert res.headers["X-Request-ID"] == "trace-me-123"
    assert res.json()["request_id"] == "trace-me-123"


def test_health_reports_solver_availability(client):
    body = client.get("/api/v1/health").json()
    assert body["status"] == "ok"
    assert body["db"] == "ok"
    assert isinstance(body["solver_available"], bool)
    # OR-Tools is optional; the flag must reflect reality either way.
    assert body["solver_available"] == (importlib.util.find_spec("ortools") is not None)


def test_sqlite_runs_with_wal_and_busy_timeout(client):
    from app.repo.database import _connect

    conn = _connect()
    try:
        assert conn.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
        assert conn.execute("PRAGMA busy_timeout").fetchone()[0] >= 5000
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    finally:
        conn.close()


def test_list_totals_reflect_the_table_not_the_page(client, dataset):
    first = client.post("/api/v1/plans", json={"dataset_id": dataset["dataset_id"]}).json()
    second = client.post("/api/v1/plans", json={"dataset_id": dataset["dataset_id"]}).json()

    page = client.get("/api/v1/plans/", params={"limit": 1, "offset": 0}).json()
    assert page["total"] >= 2
    assert len(page["plans"]) == 1
    assert page["limit"] == 1 and page["offset"] == 0

    next_page = client.get("/api/v1/plans/", params={"limit": 1, "offset": 1}).json()
    assert len(next_page["plans"]) == 1
    assert next_page["plans"][0]["id"] != page["plans"][0]["id"]
    assert {page["plans"][0]["id"], next_page["plans"][0]["id"]} <= {first["id"], second["id"]}

    filtered = client.get("/api/v1/plans/", params={"limit": 1, "plan_type": "baseline"}).json()
    assert filtered["total"] >= 2
    assert filtered["plans"][0]["type"] == "baseline"

    scenarios = client.get("/api/v1/scenarios/", params={"limit": 1}).json()
    assert scenarios["total"] >= 0
    assert len(scenarios["scenarios"]) <= 1


def test_corrupt_stored_json_does_not_500(client):
    from app.repo import database as db

    plan_id = f"corrupt-{uuid.uuid4().hex[:8]}"
    db.save_plan(plan_id, "ds-x", type="recovered", status="completed", solver="greedy",
                 created_at="2026-01-01T00:00:00+00:00", data={"kpis": {}})
    conn = db._connect()
    try:
        conn.execute("UPDATE plans SET data = ? WHERE id = ?", ("{not-json", plan_id))
        conn.commit()
    finally:
        conn.close()

    assert db.get_plan(plan_id)["data"] == {}
    res = client.get(f"/api/v1/plans/{plan_id}")
    assert res.status_code == 200
    assert res.json()["allocations"] == []


def test_empty_and_oversized_uploads_are_rejected(client):
    def files(payload: bytes):
        return {
            name: (f"{name}.csv", payload, "text/csv")
            for name in ("warehouses", "destinations", "products", "routes", "inventory", "demand")
        }

    empty = client.post("/api/v1/datasets/import", files=files(b""))
    assert empty.status_code == 400
    assert "empty" in empty.json()["detail"].lower()

    from app.core.config import settings

    original = settings.max_upload_bytes
    settings.max_upload_bytes = 64
    try:
        oversized = client.post("/api/v1/datasets/import", files=files(b"id,name\n" + b"x" * 200))
    finally:
        settings.max_upload_bytes = original
    assert oversized.status_code == 413
    assert oversized.json()["code"] == "payload_too_large"


def test_scenario_csv_escapes_spreadsheet_formulas_without_changing_numbers():
    import csv
    import io

    from app.services.reporting import export_scenario_csv

    payload = export_scenario_csv(
        {"id": "scenario-1", "name": '=HYPERLINK("https://example.com")'},
        [
            {
                "id": "plan-1",
                "type": "baseline",
                "allocations": [
                    {
                        "warehouse_id": "+WH-1",
                        "destination_id": " \t@SUM(1,1)",
                        "product_id": "-PRODUCT",
                        "route_id": "=CMD()",
                        "quantity": 3,
                    }
                ],
                "unmet": [],
                "kpis": {"cost_delta": -12.5},
            }
        ],
    )
    rows = list(csv.reader(io.StringIO(payload.decode("utf-8"))))
    assert rows[0][0] == "Scenario: '=HYPERLINK(\"https://example.com\") (scenario-1)"
    allocation = rows[rows.index(["warehouse_id", "destination_id", "product_id", "route_id", "quantity"]) + 1]
    assert allocation[:4] == ["'+WH-1", "' \t@SUM(1,1)", "'-PRODUCT", "'=CMD()"]
    assert ["cost_delta", "-12.5"] in rows


def test_csv_parser_preserves_utf8_headers_and_rejects_ambiguous_files():
    from app.services.validation import parse_csv

    assert parse_csv(b"\xef\xbb\xbfname,quantity\nCaf\xc3\xa9,2\n") == [
        {"name": "Caf\N{LATIN SMALL LETTER E WITH ACUTE}", "quantity": "2"}
    ]
    assert parse_csv(b'name,notes\nWidget,"one, two"\n') == [
        {"name": "Widget", "notes": "one, two"}
    ]

    for content, expected_error in (
        (b"id,id\n1,2\n", "duplicate column"),
        (b"name,quantity\nWidget,1,unexpected\n", "more values"),
        (b"name,quantity\nWidget\n", "missing one or more fields"),
        (b'name,quantity\nWidget,"unterminated\n', "Invalid CSV"),
        (b"name,quantity\n\xff,1\n", "UTF-8"),
    ):
        with pytest.raises(ValueError, match=expected_error):
            parse_csv(content)


def test_non_finite_numbers_are_rejected_not_propagated():
    assert as_float("nan") == 0.0
    assert as_float("inf") == 0.0
    assert as_optional_float("-inf") is None

    report = validate_dataset(
        warehouses=[{"id": "WH-1", "name": "Hub", "region": "North"}],
        destinations=[{"id": "D-1", "name": "Clinic", "priority": 1, "region": "North"}],
        products=[{"id": "P-1", "name": "Sensor", "unit": "units"}],
        routes=[
            {
                "id": "RT-1",
                "warehouse_id": "WH-1",
                "destination_id": "D-1",
                "capacity": "inf",
                "cost_per_unit": 1,
                "time_days": 1,
            }
        ],
        inventory=[{"warehouse_id": "WH-1", "product_id": "P-1", "quantity": "nan"}],
        demand=[{"destination_id": "D-1", "product_id": "P-1", "quantity": "inf"}],
    )
    assert report.valid is False
    messages = " ".join(issue.message for issue in report.issues)
    assert "finite" in messages


def _tie_input(route_order: list[str]) -> AllocationInput:
    routes = {
        "RT-B": Route(
            id="RT-B", warehouse_id="WH-1", destination_id="D-1",
            capacity=10, cost_per_unit=2.0, time_days=1,
        ),
        "RT-A": Route(
            id="RT-A", warehouse_id="WH-1", destination_id="D-1",
            capacity=10, cost_per_unit=2.0, time_days=1,
        ),
    }
    return AllocationInput(
        inventory=[Inventory(warehouse_id="WH-1", product_id="P-1", quantity=10)],
        demand=[Demand(destination_id="D-1", product_id="P-1", quantity=5)],
        routes=[routes[rid] for rid in route_order],
        priorities={"D-1": 1},
    )


def test_equal_cost_lanes_are_chosen_deterministically():
    forward = solve_allocation(_tie_input(["RT-B", "RT-A"]), solver="greedy")
    reverse = solve_allocation(_tie_input(["RT-A", "RT-B"]), solver="greedy")
    assert [a.route_id for a in forward.allocations] == ["RT-A"]
    assert [a.route_id for a in reverse.allocations] == ["RT-A"]


def test_ortools_fallback_reports_a_reason():
    if importlib.util.find_spec("ortools") is not None:
        pytest.skip("OR-Tools is installed; the fallback path is not exercised")

    result = solve_allocation(_tie_input(["RT-A"]), solver="ortools")
    assert result.solver == "greedy"
    assert result.diagnostics.get("fallback") == "greedy"
    assert result.diagnostics.get("fallback_reason") == "ortools_not_installed"


def test_dataset_list_returns_counts_not_full_networks(client, dataset):
    listed = client.get("/api/v1/datasets/").json()
    row = next(d for d in listed["datasets"] if d["id"] == dataset["dataset_id"])

    # List rows must not ship every warehouse/route/demand row in the workspace.
    assert "meta" not in row

    detail = client.get(f"/api/v1/datasets/{dataset['dataset_id']}").json()
    for table in ("warehouses", "destinations", "products", "routes", "inventory", "demand"):
        assert row["counts"][table] == len(detail["meta"][table])
    assert row["counts"]["warehouses"] == 4
    assert row["counts"]["routes"] == 20


def test_scenario_list_batches_plan_reads(client, baseline, monkeypatch):
    created = client.post(
        "/api/v1/scenarios",
        json={
            "baseline_plan_id": baseline["id"],
            "disruption": {"type": "route_closure", "params": {"route_id": "RT-03"}},
            "name": "batch-check",
        },
    ).json()

    from app.repo import database as db

    def fail_on_single_read(*args, **kwargs):
        raise AssertionError("scenario list must not fetch plans one at a time")

    monkeypatch.setattr(db, "get_plan", fail_on_single_read)

    res = client.get("/api/v1/scenarios/", params={"limit": 10})
    assert res.status_code == 200, res.text
    row = next(s for s in res.json()["scenarios"] if s["id"] == created["scenario"]["id"])
    assert row["kpis"]["baseline"]["fulfillment_rate"] == 1.0
    assert row["kpis"]["disrupted"]["unmet"] == 500
