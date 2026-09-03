import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field


class AccountEmailUpdate(BaseModel):
    new_email: EmailStr
    current_password: str = Field(min_length=1, max_length=256)


class AccountPreferencesOut(BaseModel):
    share_activity: bool


class AccountPreferencesUpdate(BaseModel):
    share_activity: bool


class AccountDeletionCreate(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    confirmation: Literal["DELETE MY ACCOUNT"]


class AccountDeletionOut(BaseModel):
    id: uuid.UUID
    status: Literal["pending", "rejected", "canceled"]
    requested_at: datetime
    updated_at: datetime
