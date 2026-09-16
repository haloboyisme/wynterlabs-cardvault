import base64
import binascii
import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

INVALID_LOGO_MESSAGE = "Choose a PNG, JPEG, or WebP logo no larger than 512 KB."


class BackgroundDesign(BaseModel):
    preset: Literal["none", "pokemon", "magic", "anime"] = "none"
    upload: str = Field(default="", max_length=1400000)
    still: str = Field(default="", max_length=1400000)
    opacity: float = Field(default=0.35, ge=0, le=0.8)
    position: Literal["top", "center", "bottom"] = "center"
    size: Literal["cover", "contain"] = "cover"

    @field_validator("upload", "still")
    @classmethod
    def validate_image(cls, value):
        if not value:
            return value
        match = re.fullmatch(r"data:image/(png|jpeg|gif);base64,([A-Za-z0-9+/=]+)", value)
        if not match:
            raise ValueError("Choose a PNG, JPEG or GIF background")
        try:
            data = base64.b64decode(match[2], validate=True)
        except binascii.Error as exc:
            raise ValueError("Invalid image encoding") from exc
        signatures = {"png": b"\x89PNG\r\n\x1a\n", "jpeg": b"\xff\xd8\xff", "gif": b"GIF8"}
        if len(data) > 1048576 or not data.startswith(signatures[match[1]]):
            raise ValueError("Invalid image or image larger than 1 MB")
        if match[1] == "png":
            if len(data) < 24 or b"acTL" in data:
                raise ValueError("Use GIF for animated backgrounds")
            width, height = int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
        elif match[1] == "gif":
            if len(data) < 10:
                raise ValueError("Invalid GIF")
            width, height = (
                int.from_bytes(data[6:8], "little"),
                int.from_bytes(data[8:10], "little"),
            )
        else:
            # JPEG dimensions are carried by a start-of-frame segment.
            width = height = 0
            offset = 2
            while offset + 4 <= len(data):
                if data[offset] != 255:
                    break
                marker = data[offset + 1]
                offset += 2
                if marker in (0xD8, 0xD9):
                    continue
                size = int.from_bytes(data[offset : offset + 2], "big")
                if size < 2 or offset + size > len(data):
                    break
                if marker in (0xC0, 0xC1, 0xC2) and size >= 8:
                    height = int.from_bytes(data[offset + 3 : offset + 5], "big")
                    width = int.from_bytes(data[offset + 5 : offset + 7], "big")
                    break
                offset += size
        if not width or not height or width * height > 4000000 or max(width, height) > 4096:
            raise ValueError("Background dimensions exceed the supported limit")
        return value

    @model_validator(mode="after")
    def require_static_fallback(self):
        if self.still.startswith("data:image/gif"):
            raise ValueError("The fallback must be a still PNG or JPEG")
        if self.upload.startswith("data:image/gif") and not self.still:
            raise ValueError("Animated backgrounds require a still fallback")
        return self


class BrandDesign(BaseModel):
    background: BackgroundDesign = Field(default_factory=BackgroundDesign)
    accent: str = Field(default="#5BE7E7", pattern=r"^#[0-9a-fA-F]{6}$")
    secondary: str = Field(default="#8BA9FF", pattern=r"^#[0-9a-fA-F]{6}$")
    surface: Literal["navy", "charcoal", "light"] = "navy"
    typography: Literal["modern", "rounded", "editorial"] = "modern"
    corners: Literal["soft", "rounded", "square"] = "soft"
    finish: Literal["glow", "outline", "plain"] = "glow"
    width: Literal["comfortable", "wide", "full"] = "comfortable"
    navigation: Literal["side", "top", "hidden"] = "side"
    hero_art: bool = True
    home_explore: bool = True
    home_updates: bool = True
    home_community: bool = True
    home_roadmap: bool = True
    dashboard_history: bool = True
    dashboard_recent: bool = True
    dashboard_decks: bool = True
    dashboard_sets: bool = True
    dashboard_attention: bool = True
    home_eyebrow: str = Field(default="The WynterLabs collection experience", max_length=120)
    home_description: str = Field(
        default=(
            "Your collection. Beautifully in focus. Scan, discover, "
            "and organize your cards in a workspace made for collectors."
        ),
        max_length=400,
    )
    dashboard_eyebrow: str = Field(default="Your collection, in focus", max_length=100)
    footer_text: str = Field(
        default="Designed for collectors. Built by WynterLabs.", max_length=180
    )
    announcement: str = Field(default="", max_length=200)


class BrandingOut(BaseModel):
    site_name: str
    product_name: str
    tagline: str
    has_custom_logo: bool
    logo_revision: str | None
    design: BrandDesign = Field(default_factory=BrandDesign)


class BrandingUpdate(BaseModel):
    site_name: str = Field(min_length=2, max_length=48)
    product_name: str = Field(min_length=2, max_length=48)
    tagline: str = Field(max_length=100)
    logo_data_url: str | None = None
    design: BrandDesign | None = None

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
