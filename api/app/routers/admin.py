import uuid
from contextlib import suppress
from datetime import UTC, datetime, time, timedelta

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin_schemas import (
    AdminCreateRequest,
    AdminDeleteRequest,
    AdminDeletionDecision,
    AdminDeletionRequestOut,
    AdminResetPasswordRequest,
    AdminRoleRequest,
    AdminStatusRequest,
    AdminUserOut,
    CatalogRefreshOut,
    CatalogScheduleOut,
    CatalogScheduleUpdate,
    CatalogStatusOut,
)
from app.branding import branding_out, read_branding_for_update, validate_logo_data_url
from app.branding_schemas import BrandingOut, BrandingUpdate
from app.catalog.importer import CatalogImporter
from app.catalog.scheduler import CatalogScheduleSpec, next_catalog_run
from app.catalog.status import read_catalog_status
from app.collection_value import capture_collection_price_snapshots
from app.database import get_db
from app.dependencies import (
    CurrentAuth,
    require_catalog_operator,
    require_owner,
    require_ready_auth,
    require_role_manager,
)
from app.errors import AppError
from app.identity import revoke_mfa_trust, revoke_user_sessions
from app.invitation_schemas import (
    InvitationCreateOut,
    InvitationCreateRequest,
    InvitationOut,
    InvitationRevokeRequest,
)
from app.invitations import invitation_status, no_store
from app.models import (
    AccountDeletionRequest,
    AccountInvitation,
    CatalogRefreshSchedule,
    MfaCredential,
    MfaLoginChallenge,
    MfaRecoveryCode,
    Role,
    SecurityAuditEvent,
    SiteBranding,
    User,
)
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


def _schedule_out(row: CatalogRefreshSchedule | None) -> CatalogScheduleOut:
    if row is None:
        return CatalogScheduleOut(
            enabled=False, cadence="weekly", interval_hours=24, weekday=6,
            time_24h="03:00", timezone="UTC", game="all", next_run_at=None,
            last_started_at=None, last_finished_at=None, last_status=None,
            last_error_summary=None, updated_at=None,
        )
    return CatalogScheduleOut(
        enabled=row.enabled, cadence=row.cadence, interval_hours=row.interval_hours,
        weekday=row.weekday, time_24h=row.time_of_day.strftime("%H:%M"),
        timezone=row.timezone, game=row.game, next_run_at=row.next_run_at,
        last_started_at=row.last_started_at, last_finished_at=row.last_finished_at,
        last_status=row.last_status, last_error_summary=row.last_error_summary,
        updated_at=row.updated_at,
    )


@router.get("/catalog/schedule", response_model=CatalogScheduleOut)
async def get_catalog_schedule(
    _operator: CurrentAuth = Depends(require_catalog_operator),
    database: AsyncSession = Depends(get_db),
) -> CatalogScheduleOut:
    return _schedule_out(await database.get(CatalogRefreshSchedule, 1))


@router.put("/catalog/schedule", response_model=CatalogScheduleOut)
async def update_catalog_schedule(
    payload: CatalogScheduleUpdate,
    operator: CurrentAuth = Depends(require_catalog_operator),
    database: AsyncSession = Depends(get_db),
) -> CatalogScheduleOut:
    spec = CatalogScheduleSpec(
        cadence=payload.cadence, interval_hours=payload.interval_hours,
        weekday=payload.weekday, time_24h=payload.time_24h, timezone=payload.timezone,
    )
    try:
        next_run = next_catalog_run(spec, datetime.now(UTC)) if payload.enabled else None
    except ValueError as exc:
        raise AppError(422, "catalog_schedule_invalid", str(exc)) from exc
    hour, minute = (int(part) for part in payload.time_24h.split(":"))
    async with database.begin():
        row = await database.get(CatalogRefreshSchedule, 1, with_for_update=True)
        if row is None:
            row = CatalogRefreshSchedule(id=1)
            database.add(row)
        row.enabled = payload.enabled
        row.cadence = payload.cadence
        row.interval_hours = payload.interval_hours
        row.weekday = payload.weekday
        row.time_of_day = time(hour, minute)
        row.timezone = payload.timezone
        row.game = payload.game
        row.next_run_at = next_run
        row.updated_by_user_id = operator.user.id
    await database.refresh(row)
    return _schedule_out(row)


@router.post("/catalog/refresh", response_model=CatalogRefreshOut)
async def refresh_catalog(
    request: Request,
    game: str | None = Query(
        default=None,
        pattern="^(mtg|pokemon|yugioh|onepiece|digimon|starwars|unionarena|lorcana|riftbound|all)$",
    ),
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


async def _managed_user(
    database: AsyncSession,
    actor: User,
    user_id: uuid.UUID,
) -> User:
    user = await database.scalar(
        select(User)
        .where(User.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if user is None:
        raise AppError(404, "user_not_found", "User was not found.")
    if user.role is Role.OWNER:
        raise AppError(403, "owner_target_protected", "The owner account is protected.")
    if actor.role is Role.SUPER_ADMIN and user.role is Role.SUPER_ADMIN:
        raise AppError(403, "role_target_protected", "Super administrators cannot manage peers.")
    return user


@router.get("/users", response_model=list[AdminUserOut])
async def list_administrators(
    _manager: CurrentAuth = Depends(require_role_manager),
    database: AsyncSession = Depends(get_db),
) -> list[User]:
    result = await database.scalars(
        select(User).where(User.role != Role.OWNER).order_by(User.created_at, User.id)
    )
    return list(result.all())


@router.get("/deletion-requests", response_model=list[AdminDeletionRequestOut])
async def list_deletion_requests(
    _owner: CurrentAuth = Depends(require_owner),
    database: AsyncSession = Depends(get_db),
) -> list[AdminDeletionRequestOut]:
    rows = (
        await database.execute(
            select(AccountDeletionRequest, User)
            .join(User, User.id == AccountDeletionRequest.user_id)
            .where(AccountDeletionRequest.status == "pending")
            .order_by(AccountDeletionRequest.requested_at)
        )
    ).all()
    return [
        AdminDeletionRequestOut(
            id=request.id,
            user_id=user.id,
            display_name=user.display_name,
            email=user.email,
            role=user.role,
            requested_at=request.requested_at,
        )
        for request, user in rows
    ]


@router.post("/deletion-requests/{request_id}/approve", status_code=204)
async def approve_deletion_request(
    request_id: uuid.UUID,
    payload: AdminDeletionDecision,
    owner: CurrentAuth = Depends(require_owner),
    database: AsyncSession = Depends(get_db),
) -> None:
    if payload.confirmation != "DELETE ACCOUNT":
        raise AppError(422, "deletion_confirmation_required", "Type DELETE ACCOUNT to continue.")
    row = await database.scalar(
        select(AccountDeletionRequest)
        .where(AccountDeletionRequest.id == request_id, AccountDeletionRequest.status == "pending")
        .with_for_update()
    )
    if row is None:
        raise AppError(404, "deletion_request_not_found", "Deletion request was not found.")
    user = await _managed_user(database, owner.user, row.user_id)
    database.add(SecurityAuditEvent(
        subject_user_id=user.id, event_type="account_deleted", actor_type="owner",
        details={"request_id": str(row.id)},
    ))
    await database.delete(user)
    await database.commit()


@router.post("/deletion-requests/{request_id}/reject", status_code=204)
async def reject_deletion_request(
    request_id: uuid.UUID,
    owner: CurrentAuth = Depends(require_owner),
    database: AsyncSession = Depends(get_db),
) -> None:
    row = await database.scalar(
        select(AccountDeletionRequest)
        .where(AccountDeletionRequest.id == request_id, AccountDeletionRequest.status == "pending")
        .with_for_update()
    )
    if row is None:
        raise AppError(404, "deletion_request_not_found", "Deletion request was not found.")
    row.status = "rejected"
    row.decided_at = datetime.now(UTC)
    row.decided_by_user_id = owner.user.id
    row.revision += 1
    database.add(SecurityAuditEvent(
        subject_user_id=row.user_id, event_type="deletion_rejected", actor_type="owner",
        details={"request_id": str(row.id)},
    ))
    await database.commit()


@router.post("/users/{user_id}/reset-mfa", response_model=AdminUserOut)
async def reset_user_mfa(
    user_id: uuid.UUID,
    manager: CurrentAuth = Depends(require_role_manager),
    database: AsyncSession = Depends(get_db),
) -> User:
    now = datetime.now(UTC)
    actor = await database.scalar(select(User).where(User.id == manager.user.id).with_for_update())
    if actor is None:
        raise AppError(401, "not_authenticated", "Sign in to continue.")
    user = await _managed_user(database, actor, user_id)
    await database.execute(delete(MfaRecoveryCode).where(MfaRecoveryCode.user_id == user.id))
    await database.execute(delete(MfaLoginChallenge).where(MfaLoginChallenge.user_id == user.id))
    await database.execute(delete(MfaCredential).where(MfaCredential.user_id == user.id))
    await revoke_user_sessions(database, user.id, now)
    await revoke_mfa_trust(database, user.id, now)
    user.must_setup_mfa = user.role in (Role.SUPER_ADMIN, Role.ADMIN)
    database.add(SecurityAuditEvent(
        subject_user_id=user.id, event_type="mfa_admin_reset", actor_type=actor.role.value,
        details={},
    ))
    await database.commit()
    await database.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(
    user_id: uuid.UUID,
    payload: AdminDeleteRequest,
    owner: CurrentAuth = Depends(require_owner),
    database: AsyncSession = Depends(get_db),
) -> None:
    user = await _managed_user(database, owner.user, user_id)
    database.add(SecurityAuditEvent(
        subject_user_id=user.id, event_type="account_deleted", actor_type="owner", details={},
    ))
    await database.delete(user)
    await database.commit()


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
        must_setup_mfa=True,
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


@router.patch("/users/{user_id}/role", response_model=AdminUserOut)
async def update_user_role(
    user_id: uuid.UUID,
    payload: AdminRoleRequest,
    manager: CurrentAuth = Depends(require_role_manager),
    database: AsyncSession = Depends(get_db),
) -> User:
    async with database.begin():
        actor = await database.scalar(
            select(User)
            .where(User.id == manager.user.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if actor is None or not actor.is_active:
            raise AppError(401, "not_authenticated", "Sign in to continue.")
        if actor.must_change_password:
            raise AppError(
                403,
                "password_change_required",
                "Change your temporary password to continue.",
            )
        if actor.role not in (Role.OWNER, Role.SUPER_ADMIN):
            raise AppError(
                403,
                "role_manager_required",
                "Owner or super administrator access is required.",
            )
        user = await database.scalar(
            select(User)
            .where(User.id == user_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if user is None:
            raise AppError(404, "user_not_found", "User was not found.")
        if user.role is Role.OWNER:
            raise AppError(403, "role_target_protected", "The owner role cannot be changed.")
        if actor.role is Role.SUPER_ADMIN and (
            user.role is Role.SUPER_ADMIN or payload.role is Role.SUPER_ADMIN
        ):
            raise AppError(
                403,
                "role_transition_forbidden",
                "Super administrators can manage only member and administrator roles.",
            )
        if user.role is not payload.role:
            user.role = payload.role
            now = datetime.now(UTC)
            credential = await database.scalar(
                select(MfaCredential).where(
                    MfaCredential.user_id == user.id,
                    MfaCredential.enabled_at.is_not(None),
                )
            )
            user.must_setup_mfa = bool(
                payload.role in (Role.SUPER_ADMIN, Role.ADMIN) and credential is None
            )
            await revoke_user_sessions(database, user.id, now)
            await revoke_mfa_trust(database, user.id, now)
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
        now = datetime.now(UTC)
        await revoke_user_sessions(database, admin.id, now)
        await revoke_mfa_trust(database, admin.id, now)
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
    await revoke_mfa_trust(database, admin.id, now)
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
        "target_role": invitation.target_role,
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
    payload: InvitationCreateRequest | None = None,
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    no_store(response)
    target_role = payload.target_role if payload is not None else Role.MEMBER
    if target_role is Role.ADMIN:
        await require_role_manager(auth)
    else:
        await require_owner(auth)
    raw_token = new_invitation_token()
    now = datetime.now(UTC)
    invitation = AccountInvitation(
        token_hash=hash_invitation_token(
            raw_token,
            request.app.state.settings.session_pepper,
        ),
        created_by_user_id=auth.user.id,
        target_role=target_role,
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
