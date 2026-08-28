import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.models import Role


class AdminCreateRequest(BaseModel):
    email: EmailStr
    display_name: str = Field(min_length=2, max_length=64)
    temporary_password: str = Field(min_length=12, max_length=256)

    @field_validator("display_name")
    @classmethod
    def clean_display_name(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if len(cleaned) < 2:
            raise ValueError("Display name is too short")
        return cleaned


class AdminStatusRequest(BaseModel):
    is_active: bool


class AdminResetPasswordRequest(BaseModel):
    temporary_password: str = Field(min_length=12, max_length=256)


class AdminUserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    display_name: str
    role: Role
    is_active: bool
    must_change_password: bool
    created_at: datetime
    updated_at: datetime


class CatalogAttemptOut(BaseModel):
    import_id: uuid.UUID
    status: str
    source_updated_at: str
    completed_at: str | None
    total_records: int = Field(ge=0)
    imported_records: int = Field(ge=0)
    rejected_records: int = Field(ge=0)
    set_count: int = Field(ge=0)
    oracle_count: int = Field(ge=0)
    printing_count: int = Field(ge=0)
    error_summary: str | None


class CatalogStatusOut(BaseModel):
    active_catalog: CatalogAttemptOut | None
    latest_attempt: CatalogAttemptOut | None
    games: dict[str, dict[str, CatalogAttemptOut | None]] = Field(default_factory=dict)


class CatalogRefreshOut(BaseModel):
    status: str
    import_id: uuid.UUID | None
    imported_records: int = Field(ge=0)
    rejected_records: int = Field(ge=0)
    skipped: bool
