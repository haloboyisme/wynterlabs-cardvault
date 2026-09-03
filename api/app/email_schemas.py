import re
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, EmailStr, Field, SecretStr, field_validator


class EmailConfiguration(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = False
    host: str = Field(max_length=253)
    port: Literal[465, 587] = 587
    username: str = Field(min_length=1, max_length=320)
    from_address: EmailStr
    site_url: str = Field(max_length=512)

    @field_validator("host")
    @classmethod
    def hostname(cls, value):
        if not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?", value):
            raise ValueError("Enter an SMTP hostname without a scheme or port")
        return value.lower()

    @field_validator("site_url")
    @classmethod
    def origin(cls, value):
        parts = urlsplit(value)
        if (
            parts.scheme != "https"
            or not parts.hostname
            or parts.username
            or parts.password
            or parts.path not in ("", "/")
            or parts.query
            or parts.fragment
            or any(char.isspace() for char in value)
        ):
            raise ValueError("Use the HTTPS site origin only, without a path or credentials")
        return value.rstrip("/")


class EmailConfigurationUpdate(EmailConfiguration):
    password: SecretStr = Field(default=SecretStr(""), max_length=512)
    current_password: SecretStr = Field(min_length=1, max_length=256)


class EmailConfigurationOut(EmailConfiguration):
    has_password: bool


class EmailRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailStr


class EmailTokenRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(min_length=20, max_length=256)


class EmailResetRequest(EmailTokenRequest):
    password: str = Field(min_length=12, max_length=256)


class EmailTestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_password: SecretStr = Field(min_length=1, max_length=256)
