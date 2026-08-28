from datetime import UTC, datetime

from fastapi import Response

from app.models import AccountInvitation


def normalized_datetime(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def invitation_status(
    invitation: AccountInvitation,
    now: datetime | None = None,
) -> str:
    current = now or datetime.now(UTC)
    if invitation.used_at is not None:
        return "used"
    if invitation.revoked_at is not None:
        return "revoked"
    if normalized_datetime(invitation.expires_at) <= current:
        return "expired"
    return "active"


def no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
