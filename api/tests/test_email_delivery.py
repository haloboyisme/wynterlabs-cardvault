import asyncio
import re
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from test_account_community import OWNER, setup_owner

from app.models import User

CONFIG = {
    "enabled": True,
    "host": "smtp.gmail.com",
    "port": 587,
    "username": "sender@example.com",
    "password": "test-smtp-secret",
    "from_address": "sender@example.com",
    "site_url": "https://cards.example.com",
    "current_password": OWNER["password"],
}
MEMBER = {
    "email": "new@example.com",
    "display_name": "New Member",
    "password": "test-member-password-123",
}


def configure(client, bootstrap_secret, monkeypatch):
    from app import email_delivery

    messages = []
    monkeypatch.setattr(email_delivery, "check_connection", lambda config: None)
    monkeypatch.setattr(
        email_delivery,
        "send_message",
        lambda config, to, subject, body: messages.append((to, subject, body)),
    )
    setup_owner(client, bootstrap_secret)
    result = client.put("/api/v1/admin/email", json=CONFIG)
    assert result.status_code == 200, result.text
    assert "test-smtp-secret" not in result.text
    assert result.json()["has_password"] is True
    return messages


def token(messages):
    return re.search(r"#token=([A-Za-z0-9_-]+)", messages[-1][2]).group(1)


def test_email_disabled_by_default(client):
    response = client.get("/api/v1/email/status")
    assert response.status_code == 200
    assert response.json() == {"enabled": False}


def test_config_security_and_redaction(client, app, bootstrap_secret, monkeypatch):
    assert client.get("/api/v1/admin/email").status_code == 401
    messages = configure(client, bootstrap_secret, monkeypatch)
    bad = client.put("/api/v1/admin/email", json={**CONFIG, "current_password": "wrong"})
    assert bad.status_code == 400
    assert (
        client.put(
            "/api/v1/admin/email", json={**CONFIG, "site_url": "http://evil.test"}
        ).status_code
        == 422
    )
    assert client.put("/api/v1/admin/email", json={**CONFIG, "port": 80}).status_code == 422
    assert client.get("/api/v1/admin/email").headers["cache-control"] == "no-store"
    assert (
        client.post(
            "/api/v1/admin/email/test", json={"current_password": OWNER["password"]}
        ).status_code
        == 200
    )
    assert messages[-1][0] == OWNER["email"]
    from app.models import EmailDeliverySettings

    async def ciphertext():
        async with app.state.session_factory() as db:
            return (await db.get(EmailDeliverySettings, 1)).password_ciphertext

    assert "test-smtp-secret" not in asyncio.run(ciphertext())


def test_signup_verification_is_required_and_single_use(client, app, bootstrap_secret, monkeypatch):
    messages = configure(client, bootstrap_secret, monkeypatch)
    client.post("/api/v1/auth/logout")
    result = client.post("/api/v1/registration", json=MEMBER)
    assert result.status_code == 201, result.text
    assert result.json()["email_verification_required"] is True
    assert client.get("/api/v1/auth/me").status_code == 401
    login = {"email": MEMBER["email"], "password": MEMBER["password"]}
    assert client.post("/api/v1/auth/login", json=login).status_code == 403
    raw = token(messages)
    assert (
        client.post(
            "/api/v1/email/reset", json={"token": raw, "password": "replacement-password-123"}
        ).status_code
        == 400
    )
    assert client.post("/api/v1/email/verify", json={"token": raw}).status_code == 200
    assert client.post("/api/v1/email/verify", json={"token": raw}).status_code == 400
    assert client.post("/api/v1/auth/login", json=login).status_code == 200
    assert client.get("/api/v1/admin/email").status_code == 403


def test_recovery_revokes_sessions_and_is_generic(client, app, bootstrap_secret, monkeypatch):
    messages = configure(client, bootstrap_secret, monkeypatch)
    known = client.post("/api/v1/email/request-reset", json={"email": OWNER["email"]})
    unknown = client.post("/api/v1/email/request-reset", json={"email": "absent@example.com"})
    assert known.status_code == unknown.status_code == 200
    assert known.json() == unknown.json()
    assert len(messages) == 1
    assert "https://cards.example.com/reset-password#token=" in messages[0][2]
    raw = token(messages)
    payload = {"token": raw, "password": "replacement-password-123"}
    assert client.post("/api/v1/email/reset", json=payload).status_code == 200
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.post("/api/v1/email/reset", json=payload).status_code == 400
    assert (
        client.post(
            "/api/v1/auth/login", json={"email": OWNER["email"], "password": OWNER["password"]}
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/api/v1/auth/login", json={"email": OWNER["email"], "password": payload["password"]}
        ).status_code
        == 200
    )


def test_expired_and_changed_email_links_rejected(client, app, bootstrap_secret, monkeypatch):
    from app.models import EmailActionToken

    messages = configure(client, bootstrap_secret, monkeypatch)
    client.post("/api/v1/email/request-reset", json={"email": OWNER["email"]})

    async def expire():
        async with app.state.session_factory() as db:
            row = await db.scalar(select(EmailActionToken))
            row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
            await db.commit()

    asyncio.run(expire())
    assert (
        client.post(
            "/api/v1/email/reset",
            json={"token": token(messages), "password": "replacement-password-123"},
        ).status_code
        == 400
    )
    client.post("/api/v1/email/request-reset", json={"email": OWNER["email"]})

    async def change_address():
        async with app.state.session_factory() as db:
            user = await db.scalar(select(User).where(User.owner_slot == 1))
            user.email_normalized = "different@example.com"
            await db.commit()

    asyncio.run(change_address())
    assert (
        client.post(
            "/api/v1/email/reset",
            json={"token": token(messages), "password": "replacement-password-123"},
        ).status_code
        == 400
    )


def test_reset_preserves_mfa_and_consumes_pending_challenges(
    client, app, bootstrap_secret, monkeypatch
):
    from mfa_helpers import enroll_current_user

    from app.models import MfaLoginChallenge

    messages = configure(client, bootstrap_secret, monkeypatch)
    enroll_current_user(client, OWNER["password"])
    client.cookies.clear()
    login = client.post(
        "/api/v1/auth/login", json={"email": OWNER["email"], "password": OWNER["password"]}
    )
    assert login.json()["status"] == "mfa_required"
    client.post("/api/v1/email/request-reset", json={"email": OWNER["email"]})
    result = client.post(
        "/api/v1/email/reset",
        json={"token": token(messages), "password": "replacement-password-123"},
    )
    assert result.status_code == 200

    async def consumed():
        async with app.state.session_factory() as db:
            return (await db.scalar(select(MfaLoginChallenge))).consumed_at is not None

    assert asyncio.run(consumed())
    assert (
        client.post(
            "/api/v1/auth/login",
            json={"email": OWNER["email"], "password": "replacement-password-123"},
        ).json()["status"]
        == "mfa_required"
    )


def test_resend_rate_limit_and_delivery_failure_are_safe(
    client, app, bootstrap_secret, monkeypatch
):
    from app import email_delivery

    messages = configure(client, bootstrap_secret, monkeypatch)
    client.post("/api/v1/auth/logout")
    client.post("/api/v1/registration", json=MEMBER)
    assert messages

    def fail(*args):
        raise RuntimeError("provider error with sensitive material")

    monkeypatch.setattr(email_delivery, "send_message", fail)
    for _ in range(3):
        assert (
            client.post(
                "/api/v1/email/request-verification", json={"email": MEMBER["email"]}
            ).status_code
            == 200
        )
    assert (
        client.post(
            "/api/v1/email/request-verification", json={"email": MEMBER["email"]}
        ).status_code
        == 429
    )
    assert (
        client.post(
            "/api/v1/auth/login", json={"email": MEMBER["email"], "password": MEMBER["password"]}
        ).status_code
        == 403
    )


def test_invalid_smtp_does_not_replace_working_settings(client, bootstrap_secret, monkeypatch):
    from app import email_delivery

    configure(client, bootstrap_secret, monkeypatch)

    def fail(*args):
        raise RuntimeError("private-provider-response")

    monkeypatch.setattr(email_delivery, "check_connection", fail)
    response = client.put("/api/v1/admin/email", json={**CONFIG, "host": "smtp.example.net"})
    assert response.status_code == 400
    assert "private-provider-response" not in response.text
    assert client.get("/api/v1/admin/email").json()["host"] == "smtp.gmail.com"
