"""Complete the real MFA enrollment flow for authenticated test-only users."""

import base64
from datetime import UTC, datetime

from app.mfa import totp_at


def enroll_current_user(client, password: str) -> None:
    response = client.post(
        "/api/v1/account/mfa/enrollment", json={"current_password": password}
    )
    assert response.status_code == 200
    encoded = response.json()["secret"]
    secret = base64.b32decode(encoded + "=" * (-len(encoded) % 8))
    response = client.post(
        "/api/v1/account/mfa/enrollment/confirm",
        json={"code": totp_at(secret, int(datetime.now(UTC).timestamp()))},
    )
    assert response.status_code == 200

