from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class CollectionImportRowOut(BaseModel):
    source_row: int = Field(ge=2)
    printing_id: uuid.UUID
    card_name: str
    finish: str
    condition: str
    quantity: int = Field(ge=1, le=9999)
    classification: Literal["addition", "increment", "error"]
    existing_quantity: int = Field(ge=0)
    resulting_quantity: int = Field(ge=0)
    error_code: str | None = None
    error_message: str | None = None
    warnings: list[str] = Field(default_factory=list)


class CollectionImportSummaryOut(BaseModel):
    additions: int = Field(ge=0)
    increments: int = Field(ge=0)
    errors: int = Field(ge=0)
    total_rows: int = Field(ge=0)


class CollectionImportPreviewOut(BaseModel):
    id: uuid.UUID
    rows: list[CollectionImportRowOut]
    summary: CollectionImportSummaryOut
    revision: int = Field(ge=1)
    expires_at: datetime
    confirmed_at: datetime | None


class CollectionImportConfirmOut(BaseModel):
    preview_id: uuid.UUID
    applied_rows: int = Field(ge=0)
