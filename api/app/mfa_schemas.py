from datetime import datetime

from pydantic import BaseModel, Field


class MfaStatusOut(BaseModel):
    eligible: bool
    enabled: bool
    recovery_codes_remaining: int


class MfaEnrollmentRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)


class MfaEnrollmentOut(BaseModel):
    secret: str
    otpauth_uri: str
    expires_at: datetime


class MfaTotpRequest(BaseModel):
    code: str = Field(min_length=1, max_length=32)


class MfaRecoveryCodesOut(BaseModel):
    recovery_codes: list[str]


class MfaRecoveryRegenerateRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    code: str = Field(min_length=1, max_length=32)
