"""Access gate, trace headers and defence-in-depth headers."""

from __future__ import annotations

import re

import pytest
from pydantic import ValidationError

TOKEN = "s3cret-operator-token-value-is-long-enough"


def test_auth_is_open_by_default(client):
    from app.core.config import settings

    assert settings.auth_required is False
    status = client.get("/api/v1/auth/status")
    assert status.status_code == 200
    assert status.json() == {"required": False, "scheme": "none"}

    assert client.get("/api/v1/datasets/").status_code == 200
    assert client.get("/api/v1/auth/check").json()["ok"] is True


def test_api_documents_can_be_disabled(monkeypatch):
    from fastapi.testclient import TestClient

    from app.core.config import settings
    from app.main import create_app

    monkeypatch.setattr(settings, "docs_enabled", False)
    with TestClient(create_app()) as docs_disabled_client:
        assert docs_disabled_client.get("/docs").status_code == 404
        assert docs_disabled_client.get("/redoc").status_code == 404
        assert docs_disabled_client.get("/openapi.json").status_code == 404


def test_api_token_requires_a_minimum_length():
    from app.core.config import Settings

    with pytest.raises(ValidationError, match="at least 32 characters"):
        Settings(api_token="too-short")

    assert len(Settings(api_token="x" * 32).api_token) == 32


def test_production_auth_mode_fails_closed_without_a_token(client, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "api_token", "")
    monkeypatch.setattr(settings, "auth_required", True)

    denied = client.get("/api/v1/datasets/")
    assert denied.status_code == 503
    assert denied.json()["code"] == "authentication_not_configured"
    assert denied.json()["request_id"]
    assert denied.headers["Cache-Control"] == "no-store"

    # Readiness, liveness, and auth discovery remain available to orchestration/login.
    assert client.get("/api/v1/auth/status").status_code == 200
    assert client.get("/api/v1/health/live").status_code == 200


def test_bearer_token_comparison_is_timing_safe_for_unequal_lengths(client, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "api_token", TOKEN)
    for supplied in ("", "x", "x" * 4096):
        response = client.get(
            "/api/v1/auth/check",
            headers={"Authorization": f"Bearer {supplied}"},
        )
        assert response.status_code == 401
        assert response.json()["code"] == "unauthorized"


def test_malformed_host_cannot_bypass_operator_gate(client, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "api_token", TOKEN)
    monkeypatch.setattr(settings, "auth_required", True)
    response = client.get(
        "/api/v1/datasets/",
        headers={"Host": "example.test/api/v1/auth/status"},
    )
    assert response.status_code == 401
    assert response.json()["code"] == "unauthorized"


def test_repeated_bad_tokens_are_rate_limited(client, monkeypatch):
    from app.core.config import settings
    from app.main import _AUTH_FAILURES

    monkeypatch.setattr(settings, "api_token", TOKEN)
    _AUTH_FAILURES.clear()
    headers = {"Authorization": "Bearer wrong"}

    for _ in range(5):
        assert client.get("/api/v1/auth/check", headers=headers).status_code == 401

    limited = client.get("/api/v1/auth/check", headers=headers)
    assert limited.status_code == 429
    assert limited.json()["code"] == "rate_limited"
    assert limited.headers["Retry-After"] == "300"
    assert client.get("/api/v1/auth/status").status_code == 200
    assert client.get("/api/v1/health/live").status_code == 200


def test_operator_token_gates_the_api_but_not_health(client, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "api_token", TOKEN)
    monkeypatch.setattr(settings, "auth_required", True)

    assert client.get("/api/v1/auth/status").json()["required"] is True

    denied = client.get("/api/v1/datasets/", headers={"X-Request-ID": "caller-chosen-id"})
    assert denied.status_code == 401
    assert denied.json()["code"] == "unauthorized"
    assert denied.json()["request_id"] != "caller-chosen-id"
    assert re.fullmatch(r"[a-f0-9]{12}", denied.json()["request_id"])
    assert denied.headers["X-Request-ID"] == "caller-chosen-id"
    assert denied.headers["WWW-Authenticate"] == "Bearer"
    assert denied.headers["Cache-Control"] == "no-store"

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
    assert res.headers["Content-Security-Policy"] == "default-src 'none'; frame-ancestors 'none'"
    assert res.headers["X-Request-ID"]


def test_cors_preflight_disallows_cookie_credentials_and_unapproved_headers(client):
    accepted = client.options(
        "/api/v1/datasets/",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type,x-request-id",
        },
    )
    assert accepted.status_code == 200
    assert accepted.headers.get("Access-Control-Allow-Origin") == "http://localhost:5173"
    assert "Access-Control-Allow-Credentials" not in accepted.headers

    rejected = client.options(
        "/api/v1/datasets/",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "x-untrusted-header",
        },
    )
    assert rejected.status_code == 400


def test_health_does_not_expose_database_error_details(client, monkeypatch):
    import app.routers.health as health

    def dead_connect():
        raise RuntimeError("sqlite path C:/sensitive/production.db secret-value")

    monkeypatch.setattr(health, "_connect", dead_connect)

    ready = client.get("/api/v1/health/ready")
    assert ready.status_code == 503
    assert ready.json()["db_error"] == "Database probe failed"
    assert "production.db" not in ready.text
    assert "secret-value" not in ready.text


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
