from typing import Literal

from pydantic import BaseModel, Field, field_validator

INVALID_LOGO_MESSAGE = "Choose a PNG, JPEG, or WebP logo no larger than 512 KB."


class BrandDesign(BaseModel):
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
