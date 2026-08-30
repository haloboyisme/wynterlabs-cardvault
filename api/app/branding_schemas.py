from pydantic import BaseModel, Field, field_validator

INVALID_LOGO_MESSAGE = "Choose a PNG, JPEG, or WebP logo no larger than 512 KB."


class BrandingOut(BaseModel):
    site_name: str
    product_name: str
    tagline: str
    has_custom_logo: bool
    logo_revision: str | None


class BrandingUpdate(BaseModel):
    site_name: str = Field(min_length=2, max_length=48)
    product_name: str = Field(min_length=2, max_length=48)
    tagline: str = Field(max_length=100)
    logo_data_url: str | None = None

    @field_validator("site_name", "product_name", "tagline", mode="before")
    @classmethod
    def strip_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("logo_data_url", mode="before")
    @classmethod
    def defer_non_string_logo_rejection(cls, value: object) -> object:
        if value is not None and not isinstance(value, str):
            return "data:invalid;base64,"
        return value
