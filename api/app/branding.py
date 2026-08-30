import base64
import binascii
import hashlib

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.branding_schemas import BrandingOut, INVALID_LOGO_MESSAGE
from app.errors import AppError
from app.models import SiteBranding

DEFAULT_SITE_NAME = "WynterLabs"
DEFAULT_PRODUCT_NAME = "CardVault"
DEFAULT_TAGLINE = "Scan it. Sort it. Own your collection."
ALLOWED_LOGOS = {
    "image/png": b"\x89PNG\r\n\x1a\n",
    "image/jpeg": b"\xff\xd8\xff",
    "image/webp": b"RIFF",
}
MAX_LOGO_BYTES = 524_288


def branding_out(branding: SiteBranding | None) -> BrandingOut:
    if branding is None:
        return BrandingOut(
            site_name=DEFAULT_SITE_NAME,
            product_name=DEFAULT_PRODUCT_NAME,
            tagline=DEFAULT_TAGLINE,
            has_custom_logo=False,
            logo_revision=None,
        )
    return BrandingOut(
        site_name=branding.site_name,
        product_name=branding.product_name,
        tagline=branding.tagline,
        has_custom_logo=branding.logo_bytes is not None,
        logo_revision=branding.logo_sha256,
    )


async def read_branding(database: AsyncSession) -> SiteBranding | None:
    return await database.get(SiteBranding, 1)


async def read_branding_for_update(database: AsyncSession) -> SiteBranding | None:
    return await database.scalar(select(SiteBranding).where(SiteBranding.id == 1).with_for_update())


def _has_animated_png_chunks(value: bytes) -> bool:
    offset = len(ALLOWED_LOGOS["image/png"])
    while offset + 12 <= len(value):
        size = int.from_bytes(value[offset : offset + 4], "big")
        chunk_end = offset + 12 + size
        if chunk_end > len(value):
            return False
        if value[offset + 4 : offset + 8] == b"acTL":
            return True
        offset = chunk_end
    return False


def _has_animated_webp_chunks(value: bytes) -> bool:
    offset = 12
    while offset + 8 <= len(value):
        chunk_type = value[offset : offset + 4]
        size = int.from_bytes(value[offset + 4 : offset + 8], "little")
        chunk_end = offset + 8 + size
        if chunk_end > len(value):
            return False
        if chunk_type == b"ANIM":
            return True
        if chunk_type == b"VP8X" and size >= 1 and value[offset + 8] & 0x02:
            return True
        offset = chunk_end + (size % 2)
    return False


def validate_logo_data_url(value: object) -> tuple[str, bytes, str]:
    try:
        if not isinstance(value, str):
            raise ValueError
        prefix, payload = value.split(",", 1)
        if not prefix.startswith("data:") or not prefix.endswith(";base64"):
            raise ValueError
        media_type = prefix[5:-7]
        signature = ALLOWED_LOGOS[media_type]
        decoded = base64.b64decode(payload, validate=True)
        if len(decoded) > MAX_LOGO_BYTES or not decoded.startswith(signature):
            raise ValueError
        if media_type == "image/png" and _has_animated_png_chunks(decoded):
            raise ValueError
        if media_type == "image/webp" and decoded[8:12] != b"WEBP":
            raise ValueError
        if media_type == "image/webp" and _has_animated_webp_chunks(decoded):
            raise ValueError
    except (KeyError, ValueError, binascii.Error) as exc:
        raise AppError(422, "invalid_brand_logo", INVALID_LOGO_MESSAGE) from exc
    return media_type, decoded, hashlib.sha256(decoded).hexdigest()
