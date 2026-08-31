import asyncio

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.models import LoginAttempt, User, UserSession


def _payload(marker: str) -> dict[str, str]:
    return {
        "email": f"{marker}@example.com",
        "display_name": f"{marker.title()} Member",
        "password": "a long private password",
    }


def _error(response, status: int, code: str) -> None:
    assert response.status_code == status
    assert response.json()["error"]["code"] == code


def test_public_registration_creates_member_and_secure_session(app) -> None:
    with TestClient(app) as client:
        response = client.post("/api/v1/registration", json=_payload("newmember"))

        assert response.status_code == 201
        assert response.json()["role"] == "member"
        assert "role" not in response.request.content.decode()
        cookie = response.headers["set-cookie"].lower()
        assert "httponly" in cookie
        assert "samesite=lax" in cookie
        assert "path=/" in cookie
        assert client.get("/api/v1/auth/me").status_code == 200


def test_public_registration_rejects_role_input(app) -> None:
    response = TestClient(app).post(
        "/api/v1/registration",
        json={**_payload("noelevation"), "role": "admin"},
    )

    _error(response, 422, "validation_error")


def test_public_registration_uses_secure_cookie_in_production(app) -> None:
    app.state.settings.environment = "production"
    response = TestClient(app).post("/api/v1/registration", json=_payload("productionmember"))

    assert response.status_code == 201
    cookie = response.headers["set-cookie"].lower()
    assert "secure" in cookie
    assert "httponly" in cookie
    assert "samesite=lax" in cookie
    assert "path=/" in cookie


def test_duplicate_registration_preserves_existing_account_and_session(app) -> None:
    with TestClient(app) as client:
        created = client.post("/api/v1/registration", json=_payload("duplicate"))
        assert created.status_code == 201

    duplicate = TestClient(app).post(
        "/api/v1/registration",
        json={**_payload("duplicate"), "display_name": "A Different Name"},
    )
    _error(duplicate, 409, "registration_identity_conflict")

    async def state() -> tuple[int, int]:
        async with app.state.session_factory() as database:
            users = await database.scalar(
                select(func.count(User.id)).where(User.email_normalized == "duplicate@example.com")
            )
            sessions = await database.scalar(
                select(func.count(UserSession.id))
                .join(User)
                .where(User.email_normalized == "duplicate@example.com")
            )
            return users or 0, sessions or 0

    assert asyncio.run(state()) == (1, 1)


def test_public_registration_rate_limits_the_eleventh_attempt(app) -> None:
    with TestClient(app) as client:
        assert client.post("/api/v1/registration", json=_payload("limited")).status_code == 201
        for _ in range(9):
            conflict = client.post(
                "/api/v1/registration",
                json={**_payload("limited"), "display_name": "Another Member"},
            )
            _error(conflict, 409, "registration_identity_conflict")
        _error(
            client.post(
                "/api/v1/registration",
                json={**_payload("limited"), "display_name": "Final Member"},
            ),
            429,
            "rate_limited",
        )

    async def attempts() -> int:
        async with app.state.session_factory() as database:
            return (
                await database.scalar(
                    select(func.count(LoginAttempt.id)).where(
                        LoginAttempt.client_ip == "registration:testclient"
                    )
                )
                or 0
            )

    assert asyncio.run(attempts()) == 10
