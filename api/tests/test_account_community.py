import asyncio
import uuid
from datetime import UTC, datetime

from sqlalchemy import select

from app.models import MfaCredential, Role, User
from app.security import hash_password

OWNER = {
    "email": "owner-account@example.com",
    "display_name": "Wynter Owner",
    "password": "test-only-credential-9ca6000d783f",
}


def setup_owner(client, bootstrap_secret: str) -> None:
    created = client.post(
        "/api/v1/setup/owner",
        json=OWNER,
        headers={"X-Bootstrap-Secret": bootstrap_secret},
    )
    assert created.status_code == 201, created.json()

    async def ready_owner() -> None:
        async with client.app.state.session_factory() as database:
            owner = await database.scalar(select(User).where(User.owner_slot == 1))
            assert owner is not None
            owner.must_setup_mfa = False
            await database.commit()

    asyncio.run(ready_owner())
    assert client.post(
        "/api/v1/auth/login",
        json={"email": OWNER["email"], "password": OWNER["password"]},
    ).status_code == 200


async def add_member(app, *, email: str = "member-account@example.com") -> uuid.UUID:
    user = User(
        email=email,
        email_normalized=email,
        display_name="Community Member",
        display_name_normalized=f"community-member-{uuid.uuid4()}",
        password_hash=hash_password("member-test-password-123"),
        role=Role.MEMBER,
        is_active=True,
        must_change_password=False,
        must_setup_mfa=False,
        share_activity=True,
    )
    async with app.state.session_factory() as database:
        database.add(user)
        await database.commit()
        await database.refresh(user)
        return user.id


def test_account_preferences_and_email_change(client, app, bootstrap_secret: str) -> None:
    setup_owner(client, bootstrap_secret)

    assert client.get("/api/v1/account/preferences").json() == {"share_activity": False}
    changed = client.put("/api/v1/account/preferences", json={"share_activity": True})
    assert changed.status_code == 200
    assert changed.json() == {"share_activity": True}

    response = client.put(
        "/api/v1/account/email",
        json={"new_email": "new-owner@example.com", "current_password": OWNER["password"]},
    )
    assert response.status_code == 204
    assert client.get("/api/v1/auth/me").status_code == 401


def test_member_can_request_and_cancel_deletion(client, app, bootstrap_secret: str) -> None:
    setup_owner(client, bootstrap_secret)
    asyncio.run(add_member(app))
    client.post("/api/v1/auth/logout")
    assert client.post(
        "/api/v1/auth/login",
        json={"email": "member-account@example.com", "password": "member-test-password-123"},
    ).status_code == 200

    requested = client.post(
        "/api/v1/account/deletion",
        json={"current_password": "member-test-password-123", "confirmation": "DELETE MY ACCOUNT"},
    )
    assert requested.status_code == 201
    assert requested.json()["status"] == "pending"
    assert client.delete("/api/v1/account/deletion").status_code == 204
    assert client.get("/api/v1/account/deletion").json() is None


def test_owner_can_reset_mfa_and_delete_non_owner(client, app, bootstrap_secret: str) -> None:
    setup_owner(client, bootstrap_secret)
    member_id = asyncio.run(add_member(app))

    async def enable_mfa() -> None:
        async with app.state.session_factory() as database:
            database.add(MfaCredential(
                user_id=member_id,
                encrypted_totp_secret="test-secret",
                enabled_at=datetime.now(UTC),
                pending_expires_at=None,
            ))
            await database.commit()

    asyncio.run(enable_mfa())
    reset = client.post(f"/api/v1/admin/users/{member_id}/reset-mfa")
    assert reset.status_code == 200
    deleted = client.request(
        "DELETE",
        f"/api/v1/admin/users/{member_id}",
        json={"confirmation": "DELETE ACCOUNT"},
    )
    assert deleted.status_code == 204

    async def missing() -> bool:
        async with app.state.session_factory() as database:
            return await database.scalar(select(User).where(User.id == member_id)) is None

    assert asyncio.run(missing())


def test_community_feed_is_private_and_opt_in(client, app, bootstrap_secret: str) -> None:
    assert client.get("/api/v1/community/activity").status_code == 401
    setup_owner(client, bootstrap_secret)
    hidden = client.get("/api/v1/community/activity")
    assert hidden.status_code == 200
    assert hidden.json()["items"] == []
    client.put("/api/v1/account/preferences", json={"share_activity": True})
    visible = client.get("/api/v1/community/activity")
    assert visible.status_code == 200
    assert any(item["kind"] == "new_member" for item in visible.json()["items"])
