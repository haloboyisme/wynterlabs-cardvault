import uuid
from contextlib import suppress
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin_schemas import (
    AdminCreateRequest,
    AdminResetPasswordRequest,
    AdminStatusRequest,
    AdminUserOut,
    CatalogRefreshOut,
    CatalogStatusOut,
)
from app.branding import branding_out, read_branding_for_update, validate_logo_data_url
from app.branding_schemas import BrandingOut, BrandingUpdate
from app.catalog.importer import CatalogImporter
from app.catalog.status import read_catalog_status
from app.collection_value import capture_collection_price_snapshots
from app.database import get_db
from app.dependencies import CurrentAuth, require_catalog_operator, require_owner
from app.errors import AppError
from app.identity import revoke_user_sessions
from app.invitation_schemas import (
    InvitationCreateOut,
    InvitationOut,
    InvitationRevokeRequest,
)
from app.invitations import invitation_status, no_store
from app.models import AccountInvitation, Role, SiteBranding, User
from app.security import hash_invitation_token, hash_password, new_invitation_token

router = APIRouter(prefix="/api/v1/admin", tags=["administration"])


@router.put("/branding", response_model=BrandingOut)
async def update_branding(
    payload: BrandingUpdate,
    _operator: CurrentAuth = Depends(require_catalog_operator),
    database: AsyncSession = Depends(get_db),
) -> BrandingOut:
    logo = (
        validate_logo_data_url(payload.logo_data_url) if payload.logo_data_url is not None else None
    )
    async with database.begin():
        branding = await read_branding_for_update(database)
        if branding is None:
            branding = SiteBranding(
                id=1,
                site_name=payload.site_name,
                product_name=payload.product_name,
                tagline=payload.tagline,
            )
            database.add(branding)
        else:
            branding.site_name = payload.site_name
            branding.product_name = payload.product_name
            branding.tagline = payload.tagline
        if logo is not None:
            branding.logo_media_type, branding.logo_bytes, branding.logo_sha256 = logo
    return branding_out(branding)


@router.delete("/branding/logo", response_model=BrandingOut)
async def delete_branding_logo(
    _operator: CurrentAuth = Depends(require_catalog_operator),
    database: AsyncSession = Depends(get_db),
) -> BrandingOut:
    async with database.begin():
        branding = await read_branding_for_update(database)
        if branding is not None:
            branding.logo_media_type = None
            branding.logo_bytes = None
            branding.logo_sha256 = None
    return branding_out(branding)


@router.post("/branding/reset", response_model=BrandingOut)
async def reset_branding(
    _operator: CurrentAuth = Depends(require_catalog_operator),
    database: AsyncSession = Depends(get_db),
) -> BrandingOut:
    async with database.begin():
        branding = await read_branding_for_update(database)
        if branding is not None:
            await database.delete(branding)
    return branding_out(None)


def get_catalog_importer(request: Request) -> CatalogImporter:
    return CatalogImporter(
        request.app.state.settings,
        request.app.state.session_factory,
    )


@router.get("/catalog/status", response_model=CatalogStatusOut)
async def catalog_status(
    request: Request,
    _operator: CurrentAuth = Depends(require_catalog_operator),
):
    return await read_catalog_status(request.app.state.session_factory)


@router.post("/catalog/refresh", response_model=CatalogRefreshOut)
async def refresh_catalog(
    request: Request,
    game: str | None = Query(default=None, pattern="^(mtg|pokemon|yugioh|onepiece|all)$"),
    _operator: CurrentAuth = Depends(require_catalog_operator),
    importer: CatalogImporter = Depends(get_catalog_importer),
) -> CatalogRefreshOut:
    try:
        outcome = await importer.refresh() if game is None else await importer.refresh(game=game)
    except Exception as exc:
        raise AppError(
            503,
            "catalog_refresh_failed",
            "Catalog refresh failed; the previous active catalog was preserved.",
        ) from exc
    if outcome.status == "busy":
        raise AppError(
            409,
            "catalog_refresh_busy",
            "A catalog refresh is already running.",
        )
    if outcome.status == "complete":
        with suppress(Exception):
            await capture_collection_price_snapshots(request.app.state.session_factory)
    return CatalogRefreshOut(
        status=outcome.status,
        import_id=outcome.import_id,
        imported_records=outcome.imported_records,
        rejected_records=outcome.rejected_records,
        skipped=outcome.skipped,
    )


async def _get_admin(database: AsyncSession, user_id: uuid.UUID) -> User:
    admin = await database.scalar(
        select(User)
        .where(
            User.id == user_id,
            User.role == Role.ADMIN,
        )
        .with_for_update()
    )
    if admin is None:
        raise AppError(404, "admin_not_found", "Administrator was not found.")
    return admin


@router.get("/users", response_model=list[AdminUserOut])
async def list_administrators(
    _owner: CurrentAuth = Depends(require_owner),
    database: AsyncSession = Depends(get_db),
) -> list[User]:
    result = await database.scalars(
        select(User).where(User.role == Role.ADMIN).order_by(User.created_at, User.id)
    )
    return list(result.all())


@router.post("/users", response_model=AdminUserOut, status_code=201)
async def create_administrator(
    payload: AdminCreateRequest,
    _owner: CurrentAuth = Depends(require_owner),
    database: AsyncSession = Depends(get_db),
) -> User:
    email = str(payload.email).lower()
    user = User(
        email=email,
        email_normalized=email,
        display_name=payload.display_name,
        display_name_normalized=payload.display_name.casefold(),
        password_hash=hash_password(payload.temporary_password),
        role=Role.ADMIN,
        owner_slot=None,
        is_active=True,
        must_change_password=True,
    )
    database.add(user)
    try:
        await database.commit()
    except IntegrityError as exc:
        await database.rollback()
        raise AppError(
            409,
            "admin_identity_conflict",
            "An administrator with that identity already exists.",
        ) from exc
    await database.refresh(user)
    return user


@router.patch("/users/{user_id}/status", response_model=AdminUserOut)
async def update_administrator_status(
    user_id: uuid.UUID,
    payload: AdminStatusRequest,
    _owner: CurrentAuth = Depends(require_owner),
    database: AsyncSession = Depends(get_db),
) -> User:
    admin = await _get_admin(database, user_id)
    admin.is_active = payload.is_active
    if not payload.is_active:
        await revoke_user_sessions(database, admin.id, datetime.now(UTC))
    await database.commit()
    await database.refresh(admin)
    return admin


@router.post("/users/{user_id}/reset-password", response_model=AdminUserOut)
async def reset_administrator_password(
    user_id: uuid.UUID,
    payload: AdminResetPasswordRequest,
    _owner: CurrentAuth = Depends(require_owner),
    database: AsyncSession = Depends(get_db),
) -> User:
    admin = await _get_admin(database, user_id)
    now = datetime.now(UTC)
    admin.password_hash = hash_password(payload.temporary_password)
    admin.must_change_password = True
    admin.password_changed_at = now
    await revoke_user_sessions(database, admin.id, now)
    await database.commit()
    await database.refresh(admin)
    return admin


def _invitation_view(invitation: AccountInvitation) -> dict[str, object]:
    return {
        "id": invitation.id,
        "expires_at": invitation.expires_at,
        "revoked_at": invitation.revoked_at,
        "used_at": invitation.used_at,
        "used_by_user_id": invitation.used_by_user_id,
        "revision": invitation.revision,
        "created_at": invitation.created_at,
        "status": invitation_status(invitation),
    }


@router.post(
    "/invitations",
    response_model=InvitationCreateOut,
    status_code=201,
)
async def create_invitation(
    request: Request,
    response: Response,
    owner: CurrentAuth = Depends(require_owner),
    database: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    no_store(response)
    raw_token = new_invitation_token()
    now = datetime.now(UTC)
    invitation = AccountInvitation(
        token_hash=hash_invitation_token(
            raw_token,
            request.app.state.settings.session_pepper,
        ),
        created_by_user_id=owner.user.id,
        expires_at=now + timedelta(days=7),
        created_at=now,
        updated_at=now,
    )
    database.add(invitation)
    await database.commit()
    await database.refresh(invitation)
    return {**_invitation_view(invitation), "raw_token": raw_token}


@router.get("/invitations", response_model=list[InvitationOut])
async def list_invitations(
    response: Response,
    _owner: CurrentAuth = Depends(require_owner),
    database: AsyncSession = Depends(get_db),
) -> list[dict[str, object]]:
    no_store(response)
    result = await database.scalars(
        select(AccountInvitation).order_by(
            AccountInvitation.created_at.desc(),
            AccountInvitation.id.desc(),
        )
    )
    return [_invitation_view(invitation) for invitation in result.all()]


@router.post(
    "/invitations/{invitation_id}/revoke",
    response_model=InvitationOut,
)
async def revoke_invitation(
    invitation_id: uuid.UUID,
    payload: InvitationRevokeRequest,
    response: Response,
    _owner: CurrentAuth = Depends(require_owner),
    database: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    no_store(response)
    invitation = await database.scalar(
        select(AccountInvitation)
        .where(AccountInvitation.id == invitation_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if invitation is None:
        raise AppError(404, "invitation_not_found", "Invitation was not found.")
    if invitation.revision != payload.expected_revision:
        raise AppError(
            409,
            "invitation_revision_conflict",
            "Invitation changed; refresh and try again.",
        )
    if invitation_status(invitation) != "active":
        raise AppError(
            409,
            "invitation_not_active",
            "Invitation is no longer active.",
        )
    invitation.revoked_at = datetime.now(UTC)
    invitation.revision += 1
    await database.commit()
    await database.refresh(invitation)
    return _invitation_view(invitation)
