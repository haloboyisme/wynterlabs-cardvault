import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.models import Role


class OwnerSetup(BaseModel):
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


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=12, max_length=256)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    display_name: str
    role: Role
    must_change_password: bool
    must_setup_mfa: bool
    created_at: datetime


class LoginResult(BaseModel):
    status: Literal["authenticated", "mfa_required"]
    user: UserOut | None = None
    challenge_expires_at: datetime | None = None


class SessionOut(BaseModel):
    id: uuid.UUID
    created_at: datetime
    expires_at: datetime
    last_seen_at: datetime
    client_ip: str
    user_agent: str
    current: bool


class SetupStatus(BaseModel):
    available: bool
