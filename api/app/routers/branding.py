from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.branding import branding_out, read_branding
from app.branding_schemas import BrandingOut
from app.database import get_db
from app.dependencies import CurrentAuth, require_ready_auth
from app.errors import AppError

router = APIRouter(prefix="/api/v1/branding", tags=["branding"])


@router.get("", response_model=BrandingOut)
async def get_branding(
    _auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> BrandingOut:
    return branding_out(await read_branding(database))


@router.get("/logo")
async def get_branding_logo(
    _auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> Response:
    branding = await read_branding(database)
    if branding is None or branding.logo_bytes is None or branding.logo_media_type is None:
        raise AppError(404, "brand_logo_not_found", "A custom logo has not been set.")
    return Response(
        content=branding.logo_bytes,
        media_type=branding.logo_media_type,
        headers={
            "ETag": branding.logo_sha256 or "",
            "Cache-Control": "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
        },
    )
