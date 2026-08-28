from datetime import UTC, datetime

from fastapi import APIRouter, Cookie, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.database import get_db
from app.dependencies import CurrentAuth, get_settings, require_ready_auth
from app.errors import AppError
from app.mfa_schemas import (
    MfaEnrollmentOut,
    MfaEnrollmentRequest,
    MfaRecoveryCodesOut,
    MfaRecoveryRegenerateRequest,
    MfaStatusOut,
    MfaTotpRequest,
)
from app.mfa_service import (
    begin_enrollment,
    complete_recovery_challenge,
    complete_totp_challenge,
    confirm_enrollment,
    mfa_status,
    regenerate_recovery_codes,
)
from app.schemas import UserOut

router = APIRouter(prefix="/api/v1", tags=["mfa"])


def _set_session_cookie(response: Response, settings: Settings, raw: str) -> None:
    response.set_cookie(
        settings.cookie_name,
        raw,
        max_age=settings.session_hours * 3600,
        httponly=True,
        secure=settings.environment == "production",
        samesite="lax",
        path="/",
    )


def _set_pre_auth_cookie(response: Response, settings: Settings, raw: str) -> None:
    response.set_cookie(
        "wynterlabs_pre_auth",
        raw,
        max_age=settings.mfa_challenge_minutes * 60,
        httponly=True,
        secure=settings.environment == "production",
        samesite="strict",
        path="/api/v1/auth/mfa",
    )


def clear_pre_auth_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        "wynterlabs_pre_auth",
        path="/api/v1/auth/mfa",
        secure=settings.environment == "production",
        httponly=True,
        samesite="strict",
    )


@router.get("/account/mfa", response_model=MfaStatusOut)
async def status(
    auth: CurrentAuth = Depends(require_ready_auth), database: AsyncSession = Depends(get_db)
) -> MfaStatusOut:
    eligible, enabled, remaining = await mfa_status(database, auth.user)
    return MfaStatusOut(eligible=eligible, enabled=enabled, recovery_codes_remaining=remaining)


@router.post("/account/mfa/enrollment", response_model=MfaEnrollmentOut)
async def begin(
    payload: MfaEnrollmentRequest,
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> MfaEnrollmentOut:
    material = await begin_enrollment(
        database, auth.user, payload.current_password, settings, datetime.now(UTC)
    )
    await database.commit()
    return MfaEnrollmentOut(**material.__dict__)


@router.post("/account/mfa/enrollment/confirm", response_model=MfaRecoveryCodesOut)
async def confirm(
    payload: MfaTotpRequest,
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> MfaRecoveryCodesOut:
    codes = await confirm_enrollment(database, auth.user, payload.code, settings, datetime.now(UTC))
    await database.commit()
    return MfaRecoveryCodesOut(recovery_codes=codes)


@router.post("/account/mfa/recovery-codes", response_model=MfaRecoveryCodesOut)
async def regenerate(
    payload: MfaRecoveryRegenerateRequest,
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> MfaRecoveryCodesOut:
    codes = await regenerate_recovery_codes(
        database, auth.user, payload.current_password, payload.code, settings, datetime.now(UTC)
    )
    await database.commit()
    return MfaRecoveryCodesOut(recovery_codes=codes)


async def _complete(
    completion,
    payload: MfaTotpRequest,
    request: Request,
    response: Response,
    raw: str | None,
    database: AsyncSession,
    settings: Settings,
) -> UserOut:
    try:
        user, session_raw = await completion(
            database,
            raw,
            payload.code,
            settings,
            datetime.now(UTC),
            request.client.host if request.client else "unknown",
            request.headers.get("user-agent", "unknown"),
        )
        await database.commit()
    except AppError:
        # The service attaches deletion only to consumed, expired, disabled, or
        # exhausted challenge errors. A retryable wrong code keeps the cookie.
        await database.commit()
        raise
    clear_pre_auth_cookie(response, settings)
    _set_session_cookie(response, settings, session_raw)
    return UserOut.model_validate(user)


@router.post("/auth/mfa/totp", response_model=UserOut)
async def challenge_totp(
    payload: MfaTotpRequest,
    request: Request,
    response: Response,
    wynterlabs_pre_auth: str | None = Cookie(default=None),
    database: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> UserOut:
    return await _complete(
        complete_totp_challenge, payload, request, response, wynterlabs_pre_auth, database, settings
    )


@router.post("/auth/mfa/recovery", response_model=UserOut)
async def challenge_recovery(
    payload: MfaTotpRequest,
    request: Request,
    response: Response,
    wynterlabs_pre_auth: str | None = Cookie(default=None),
    database: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> UserOut:
    return await _complete(
        complete_recovery_challenge,
        payload,
        request,
        response,
        wynterlabs_pre_auth,
        database,
        settings,
    )
