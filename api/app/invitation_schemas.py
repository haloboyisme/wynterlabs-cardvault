import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.models import Role


class InvitationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    expires_at: datetime
    revoked_at: datetime | None
    used_at: datetime | None
    used_by_user_id: uuid.UUID | None
    revision: int
    created_at: datetime
    status: str


class InvitationCreateOut(InvitationOut):
    raw_token: str


class InvitationRevokeRequest(BaseModel):
    expected_revision: int = Field(ge=1)


class InvitationAcceptRequest(BaseModel):
    token: str = Field(min_length=20, max_length=256)
    email: EmailStr
    display_name: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=12, max_length=256)

    @field_validator("display_name")
    @classmethod
    def clean_display_name(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if len(cleaned) < 2:
            raise ValueError("Display name is too short")
        return cleaned


class InvitationAcceptedOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    display_name: str
    role: Role
    must_change_password: bool
    created_at: datetime
