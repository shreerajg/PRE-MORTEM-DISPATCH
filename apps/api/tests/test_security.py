"""Access gate, trace headers and defence-in-depth headers."""

from __future__ import annotations

import re

TOKEN = "s3cret-operator-token"


def test_auth_is_open_by_default(client):
    status = client.get("/api/v1/auth/status")
    assert status.status_code == 200
    assert status.json() == {"required": False, "scheme": "none"}

    assert client.get("/api/v1/datasets/").status_code == 200
    assert client.get("/api/v1/auth/check").json()["ok"] is True


def test_operator_token_gates_the_api_but_not_health(client, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "api_token", TOKEN)

    assert client.get("/api/v1/auth/status").json()["required"] is True

    denied = client.get("/api/v1/datasets/")
    assert denied.status_code == 401
    assert denied.json()["code"] == "unauthorized"
    assert denied.json()["request_id"] == denied.headers["X-Request-ID"]
    assert denied.headers["WWW-Authenticate"] == "Bearer"

    # Probes and discovery stay reachable so orchestration and the login page work.
    assert client.get("/api/v1/health").status_code == 200
    assert client.get("/api/v1/health/live").status_code == 200
    assert client.get("/api/v1/health/ready").status_code == 200
    assert client.get("/api/v1/auth/status").status_code == 200

    assert client.get("/api/v1/auth/check").status_code == 401
    assert client.get("/api/v1/auth/check", headers={"Authorization": f"Bearer {TOKEN}"}).status_code == 200

    bearer = client.get("/api/v1/datasets/", headers={"Authorization": f"Bearer {TOKEN}"})
    assert bearer.status_code == 200
    key = client.get("/api/v1/datasets/", headers={"X-API-Key": TOKEN})
    assert key.status_code == 200

    wrong = client.get("/api/v1/datasets/", headers={"Authorization": "Bearer nope"})
    assert wrong.status_code == 401


def test_request_ids_are_bounded_and_safe(client):
    supplied = "trace-abc_1.2:3"
    res = client.get("/api/v1/health/live", headers={"X-Request-ID": supplied})
    assert res.headers["X-Request-ID"] == supplied

    unsafe = "x" * 200
    res = client.get("/api/v1/health/live", headers={"X-Request-ID": unsafe})
    echoed = res.headers["X-Request-ID"]
    assert echoed != unsafe
    assert len(echoed) <= 64
    assert re.fullmatch(r"[A-Za-z0-9._:-]+", echoed)


def test_security_headers_and_no_store(client):
    res = client.get("/api/v1/health")
    assert res.headers["X-Content-Type-Options"] == "nosniff"
    assert res.headers["X-Frame-Options"] == "DENY"
    assert res.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert res.headers["Cache-Control"] == "no-store"
    assert res.headers["X-Request-ID"]


def test_liveness_survives_a_dead_database(client, monkeypatch):
    import app.routers.health as health

    def dead_connect():
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(health, "_connect", dead_connect)

    live = client.get("/api/v1/health/live")
    assert live.status_code == 200
    assert live.json()["status"] == "ok"

    ready = client.get("/api/v1/health/ready")
    assert ready.status_code == 503
    assert ready.json()["status"] == "degraded"
    assert ready.json()["db"] == "error"

    # The UI alias stays 200 so it can render the degraded state itself.
    alias = client.get("/api/v1/health")
    assert alias.status_code == 200
    assert alias.json()["db"] == "error"
