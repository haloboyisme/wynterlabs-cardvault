import asyncio
import json
import time
from urllib.parse import parse_qs, urlparse

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import select
from test_account_community import OWNER, setup_owner

CONFIG = {
    "enabled": True,
    "client_id": "test.apps.googleusercontent.com",
    "client_secret": "test-client-secret",
    "site_url": "https://cards.example.com",
    "current_password": OWNER["password"],
}


def configure(client, bootstrap_secret):
    setup_owner(client, bootstrap_secret)
    result = client.put("/api/v1/admin/google", json=CONFIG)
    assert result.status_code == 200, result.text
    assert "test-client-secret" not in result.text


def test_google_disabled_default(client):
    assert client.get("/api/v1/auth/google/status").json() == {"enabled": False}
    assert client.post("/api/v1/auth/google/start").status_code == 503


def test_google_owner_configuration(client, bootstrap_secret):
    assert client.get("/api/v1/admin/google").status_code == 401
    configure(client, bootstrap_secret)
    assert (
        client.put("/api/v1/admin/google", json={**CONFIG, "current_password": "bad"}).status_code
        == 400
    )
    assert (
        client.put(
            "/api/v1/admin/google", json={**CONFIG, "site_url": "http://bad.test"}
        ).status_code
        == 422
    )
    assert client.get("/api/v1/admin/google").headers["cache-control"] == "no-store"


def test_google_state_rejects_wrong_browser_and_replay(client, bootstrap_secret, monkeypatch):
    configure(client, bootstrap_secret)
    result = client.post("/api/v1/auth/google/start")
    assert result.status_code == 200
    params = parse_qs(urlparse(result.json()["url"]).query)
    assert params["scope"] == ["openid email"]
    assert params["code_challenge_method"] == ["S256"]
    client.cookies.clear()
    response = client.get(
        "/api/v1/auth/google/callback",
        params={"state": params["state"][0], "code": "bad"},
        follow_redirects=False,
    )
    assert response.status_code == 303
    assert "google=failed" in response.headers["location"]


def flow(client, link=False):
    r = client.post(
        "/api/v1/auth/google/link" if link else "/api/v1/auth/google/start",
        json={"current_password": OWNER["password"]} if link else None,
    )
    assert r.status_code == 200, r.text
    return parse_qs(urlparse(r.json()["url"]).query)["state"][0]


def finish(client, state):
    return client.get(
        "/api/v1/auth/google/callback",
        params={"state": state, "code": "provider-code"},
        follow_redirects=False,
    )


def test_explicit_link_login_mfa_and_unlink(client, app, bootstrap_secret, monkeypatch):
    from app import google_service

    configure(client, bootstrap_secret)

    async def exchange(*args):
        return "google-test-subject"

    monkeypatch.setattr(google_service, "exchange", exchange)
    state = flow(client, True)
    assert finish(client, state).headers["location"] == "/account?google=linked"
    assert "failed" in finish(client, state).headers["location"]
    assert client.get("/api/v1/account/google").json()["linked"] is True
    client.post("/api/v1/auth/logout")
    r = finish(client, flow(client))
    assert r.headers["location"] == "/dashboard"
    assert client.get("/api/v1/auth/me").status_code == 200
    from datetime import UTC, datetime

    from app.models import MfaCredential, User

    async def enable_mfa():
        async with app.state.session_factory() as db:
            user = await db.scalar(select(User).where(User.email == OWNER["email"]))
            db.add(
                MfaCredential(
                    user_id=user.id, encrypted_totp_secret="unused", enabled_at=datetime.now(UTC)
                )
            )
            await db.commit()

    asyncio.run(enable_mfa())
    client.post("/api/v1/auth/logout")
    r = finish(client, flow(client))
    assert r.headers["location"] == "/mfa-challenge"
    assert client.get("/api/v1/auth/me").status_code == 401


def test_unknown_identity_never_auto_links(client, bootstrap_secret, monkeypatch):
    from app import google_service

    configure(client, bootstrap_secret)

    async def exchange(*args):
        return "unknown-subject"

    monkeypatch.setattr(google_service, "exchange", exchange)
    client.post("/api/v1/auth/logout")
    assert finish(client, flow(client)).headers["location"] == "/login?google=unlinked"
    assert client.get("/api/v1/auth/me").status_code == 401


def test_link_requires_same_live_session_and_config(client, bootstrap_secret, monkeypatch):
    from app import google_service

    configure(client, bootstrap_secret)

    async def exchange(*args):
        return "unknown-subject"

    monkeypatch.setattr(google_service, "exchange", exchange)
    state = flow(client, True)
    client.post("/api/v1/auth/logout")
    assert finish(client, state).headers["location"] == "/login?google=failed"


def test_google_token_signature_and_claims():
    from app.google_service import validate_id_token

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key()))
    jwk["kid"] = "key1"
    claims = {
        "sub": "subject",
        "aud": CONFIG["client_id"],
        "iss": "https://accounts.google.com",
        "exp": int(time.time()) + 300,
        "iat": int(time.time()),
        "nonce": "nonce",
        "email_verified": True,
    }

    def token(values):
        return jwt.encode(values, key, algorithm="RS256", headers={"kid": "key1"})

    assert (
        validate_id_token(token(claims), {"keys": [jwk]}, CONFIG["client_id"], "nonce") == "subject"
    )
    for changes in (
        {"aud": "other"},
        {"iss": "https://evil.test"},
        {"exp": 1},
        {"nonce": "other"},
        {"email_verified": False},
    ):
        with pytest.raises((ValueError, jwt.PyJWTError)):
            validate_id_token(
                token({**claims, **changes}), {"keys": [jwk]}, CONFIG["client_id"], "nonce"
            )


def test_callback_failure_does_not_leave_query_in_access_log_scope(app, monkeypatch):
    from fastapi.testclient import TestClient
    from sqlalchemy.ext.asyncio import AsyncSession

    recorded = []

    async def broken(*args, **kwargs):
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(AsyncSession, "get", broken)

    async def wrapper(scope, receive, send):
        try:
            await app(scope, receive, send)
        finally:
            recorded.append(scope.get("query_string"))

    with TestClient(wrapper, raise_server_exceptions=False) as c:
        assert c.get("/api/v1/auth/google/callback?state=test&code=private").status_code == 500
    assert b"" in recorded
    assert all(not q or b"private" not in q for q in recorded)


def test_google_uses_start_request_trust_but_rechecks_revocation(
    client, app, bootstrap_secret, monkeypatch
):
    from datetime import UTC, datetime, timedelta

    from app import google_service
    from app.models import MfaCredential, MfaTrustedBrowser, User
    from app.security import hash_token

    configure(client, bootstrap_secret)

    async def exchange(*args):
        return "trusted-subject"

    monkeypatch.setattr(google_service, "exchange", exchange)
    assert finish(client, flow(client, True)).headers["location"] == "/account?google=linked"

    async def trust(revoke=False):
        async with app.state.session_factory() as db:
            user = await db.scalar(select(User).where(User.email == OWNER["email"]))
            if not revoke:
                db.add(
                    MfaCredential(
                        user_id=user.id,
                        encrypted_totp_secret="unused",
                        enabled_at=datetime.now(UTC),
                    )
                )
                db.add(
                    MfaTrustedBrowser(
                        user_id=user.id,
                        token_hash=hash_token("trusted-token", app.state.settings.session_pepper),
                        expires_at=datetime.now(UTC) + timedelta(hours=5),
                        user_agent="test",
                    )
                )
            else:
                record = await db.scalar(
                    select(MfaTrustedBrowser).where(MfaTrustedBrowser.user_id == user.id)
                )
                record.revoked_at = datetime.now(UTC)
            await db.commit()

    asyncio.run(trust())
    client.post("/api/v1/auth/logout")
    client.cookies.set("wynterlabs_mfa_trust", "trusted-token", path="/api/v1/auth")
    state = flow(client)
    client.cookies.delete("wynterlabs_mfa_trust", path="/api/v1/auth")
    assert finish(client, state).headers["location"] == "/dashboard"
    client.post("/api/v1/auth/logout")
    client.cookies.set("wynterlabs_mfa_trust", "trusted-token", path="/api/v1/auth")
    state = flow(client)
    asyncio.run(trust(True))
    assert finish(client, state).headers["location"] == "/mfa-challenge"
