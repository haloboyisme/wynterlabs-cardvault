import base64
import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode, urlsplit

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field, SecretStr, field_validator
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import google_service as service
from app.config import Settings
from app.database import get_db
from app.dependencies import CurrentAuth, get_settings, require_ready_auth, require_role_manager
from app.errors import AppError
from app.identity import lock_user_credentials
from app.mfa_service import create_full_session, create_mfa_challenge
from app.models import (
    GoogleFlow,
    GoogleIdentity,
    GoogleSettings,
    MfaCredential,
    MfaTrustedBrowser,
    UserSession,
)
from app.routers.auth import _set_pre_auth_cookie, _set_session_cookie, client_ip
from app.security import hash_token, verify_password

router = APIRouter(tags=["Google sign-in"])
COOKIE = "cardvault_google_flow"
PATH = "/api/v1/auth/google"


def utc(value):
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


class Password(BaseModel):
    current_password: SecretStr = Field(min_length=1, max_length=1024)


class Configuration(Password):
    enabled: bool
    client_id: str = Field(
        pattern=r"^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$", max_length=256
    )
    client_secret: SecretStr | None = Field(default=None, max_length=512)
    site_url: str = Field(max_length=512)

    @field_validator("site_url")
    @classmethod
    def origin(cls, value):
        value = value.rstrip("/")
        parts = urlsplit(value)
        if (
            parts.scheme != "https"
            or not parts.hostname
            or "." not in parts.hostname
            or parts.username
            or parts.password
            or parts.path
            or parts.query
            or parts.fragment
        ):
            raise ValueError("Use your HTTPS site origin without a path or query.")
        return value


def view(row):
    return {
        "enabled": bool(row and row.enabled),
        "client_id": row.client_id if row else "",
        "site_url": row.site_url if row else "",
        "has_secret": bool(row and row.secret_ciphertext),
        "callback_path": service.CALLBACK,
    }


@router.get("/api/v1/admin/google")
async def configuration(
    auth: CurrentAuth = Depends(require_role_manager), database: AsyncSession = Depends(get_db)
):
    return view(await database.get(GoogleSettings, 1))


@router.put("/api/v1/admin/google")
async def configure(
    payload: Configuration,
    auth: CurrentAuth = Depends(require_role_manager),
    database: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    user = await lock_user_credentials(database, auth.user.id)
    if not user or not verify_password(
        payload.current_password.get_secret_value(), user.password_hash
    ):
        raise AppError(400, "current_password_invalid", "Current password is incorrect.")
    row = await database.scalar(
        select(GoogleSettings).where(GoogleSettings.id == 1).with_for_update()
    )
    secret = payload.client_secret.get_secret_value() if payload.client_secret else ""
    if not row and not secret:
        raise AppError(400, "google_secret_required", "Enter the Google client secret.")
    if row and row.client_id != payload.client_id and not secret:
        raise AppError(
            400, "google_secret_required", "A changed client ID needs its client secret."
        )
    if row is None:
        row = GoogleSettings(id=1)
        database.add(row)
    row.enabled, row.client_id, row.site_url = payload.enabled, payload.client_id, payload.site_url
    row.revision = secrets.token_hex(16)
    if secret:
        row.secret_ciphertext = service.encrypt(secret, settings)
    await database.commit()
    return view(row)


@router.get(PATH + "/status")
async def status(database: AsyncSession = Depends(get_db)):
    row = await database.get(GoogleSettings, 1)
    return {"enabled": bool(row and row.enabled)}


async def start_flow(request, response, database, settings, auth=None):
    config = await database.get(GoogleSettings, 1)
    if not config or not config.enabled:
        raise AppError(503, "google_disabled", "Google sign-in is not enabled on this server.")
    # JSON POST plus strict origin protects login/link initiation; callback uses bound state.
    if settings.environment == "production" and request.headers.get("origin") != config.site_url:
        raise AppError(400, "google_origin", f"Open {config.site_url} to use Google sign-in.")
    now = datetime.now(UTC)
    await database.execute(
        delete(GoogleFlow).where(GoogleFlow.expires_at < now - timedelta(days=1))
    )
    count = await database.scalar(
        select(func.count())
        .select_from(GoogleFlow)
        .where(
            GoogleFlow.client_ip == client_ip(request),
            GoogleFlow.created_at > now - timedelta(minutes=5),
        )
    )
    if count >= 10:
        raise AppError(429, "rate_limited", "Too many sign-in attempts. Try again in five minutes.")
    state, browser, verifier, nonce = (secrets.token_urlsafe(32) for _ in range(4))
    database.add(
        GoogleFlow(
            state_hash=hash_token(state, settings.session_pepper),
            browser_hash=hash_token(browser, settings.session_pepper),
            trust_token_hash=hash_token(
                request.cookies["wynterlabs_mfa_trust"], settings.session_pepper
            )
            if request.cookies.get("wynterlabs_mfa_trust")
            else None,
            verifier_ciphertext=service.encrypt(verifier, settings),
            nonce=nonce,
            revision=config.revision,
            user_id=auth.user.id if auth else None,
            session_id=auth.session.id if auth else None,
            password_version=auth.user.password_changed_at if auth else None,
            created_at=now,
            expires_at=now + timedelta(minutes=10),
            client_ip=client_ip(request),
        )
    )
    await database.commit()
    response.set_cookie(
        COOKIE,
        browser,
        max_age=600,
        httponly=True,
        secure=settings.environment == "production",
        samesite="lax",
        path=PATH,
    )
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    )
    return {
        "url": "https://accounts.google.com/o/oauth2/v2/auth?"
        + urlencode(
            {
                "client_id": config.client_id,
                "redirect_uri": config.site_url + service.CALLBACK,
                "response_type": "code",
                "scope": "openid email",
                "state": state,
                "nonce": nonce,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "prompt": "select_account",
            }
        )
    }


@router.post(PATH + "/start")
async def start(
    request: Request,
    response: Response,
    database: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    return await start_flow(request, response, database, settings)


@router.get("/api/v1/account/google")
async def linked(
    auth: CurrentAuth = Depends(require_ready_auth), database: AsyncSession = Depends(get_db)
):
    row = await database.get(GoogleSettings, 1)
    identity = await database.scalar(
        select(GoogleIdentity).where(GoogleIdentity.user_id == auth.user.id)
    )
    return {"enabled": bool(row and row.enabled), "linked": identity is not None}


@router.post(PATH + "/link")
async def link(
    payload: Password,
    request: Request,
    response: Response,
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    user = await lock_user_credentials(database, auth.user.id)
    if not user or not verify_password(
        payload.current_password.get_secret_value(), user.password_hash
    ):
        raise AppError(400, "current_password_invalid", "Current password is incorrect.")
    auth.user = user
    return await start_flow(request, response, database, settings, auth)


@router.post("/api/v1/account/google/unlink", status_code=204)
async def unlink(
    payload: Password,
    auth: CurrentAuth = Depends(require_ready_auth),
    database: AsyncSession = Depends(get_db),
):
    user = await lock_user_credentials(database, auth.user.id)
    if not user or not verify_password(
        payload.current_password.get_secret_value(), user.password_hash
    ):
        raise AppError(400, "current_password_invalid", "Current password is incorrect.")
    await database.execute(delete(GoogleIdentity).where(GoogleIdentity.user_id == user.id))
    await database.execute(delete(GoogleFlow).where(GoogleFlow.user_id == user.id))
    await database.commit()


def redirect(path):
    response = RedirectResponse(path, status_code=303)
    response.delete_cookie(COOKIE, path=PATH)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@router.get(service.CALLBACK)
async def callback(
    request: Request,
    state: str = "",
    code: str = "",
    database: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    failed = redirect("/login?google=failed")
    if len(state) > 128 or not state:
        return failed
    now = datetime.now(UTC)
    flow = await database.get(GoogleFlow, hash_token(state, settings.session_pepper))
    config = await database.get(GoogleSettings, 1)
    raw = request.cookies.get(COOKIE, "")
    if (
        not flow
        or flow.consumed_at
        or utc(flow.expires_at) <= now
        or not config
        or not config.enabled
        or config.revision != flow.revision
        or not secrets.compare_digest(flow.browser_hash, hash_token(raw, settings.session_pepper))
    ):
        return failed
    # Atomic claim before network I/O prevents concurrent replay, including on SQLite tests.
    claimed = await database.execute(
        update(GoogleFlow)
        .where(GoogleFlow.state_hash == flow.state_hash, GoogleFlow.consumed_at.is_(None))
        .values(consumed_at=now)
    )
    await database.commit()
    if claimed.rowcount != 1 or not code or len(code) > 4096:
        return failed
    try:
        subject = await service.exchange(
            config, code, service.decrypt(flow.verifier_ciphertext, settings), flow.nonce, settings
        )
    except Exception:
        return failed
    now = datetime.now(UTC)
    if utc(flow.expires_at) <= now:
        return failed
    # Recheck settings after the provider round trip; disabling invalidates in-flight attempts.
    await database.refresh(config)
    if not config.enabled or config.revision != flow.revision:
        return failed
    identity = await database.get(GoogleIdentity, subject)
    if flow.user_id:
        user = await lock_user_credentials(database, flow.user_id)
        session = await database.get(UserSession, flow.session_id)
        cookie = request.cookies.get(settings.cookie_name, "")
        if (
            not user
            or not user.is_active
            or user.must_change_password
            or user.must_setup_mfa
            or user.email_verification_required
            or utc(user.password_changed_at) != utc(flow.password_version)
            or not session
            or session.revoked_at
            or utc(session.expires_at) <= now
            or not secrets.compare_digest(
                session.token_hash, hash_token(cookie, settings.session_pepper)
            )
        ):
            return failed
        existing = await database.scalar(
            select(GoogleIdentity).where(GoogleIdentity.user_id == user.id)
        )
        if (identity and identity.user_id != user.id) or (existing and existing.subject != subject):
            return redirect("/account?google=conflict")
        if not identity:
            database.add(GoogleIdentity(subject=subject, user_id=user.id))
        try:
            await database.commit()
        except IntegrityError:
            await database.rollback()
            return redirect("/account?google=conflict")
        return redirect("/account?google=linked")
    if not identity:
        # Never attach a provider identity to an existing account by email alone.
        return redirect("/login?google=unlinked")
    user = await lock_user_credentials(database, identity.user_id)
    if not user or not user.is_active or user.email_verification_required:
        return failed
    # Recheck link after locking the user to serialize against unlink.
    current = await database.get(GoogleIdentity, subject, populate_existing=True)
    if not current or current.user_id != user.id:
        return failed
    credential = await database.scalar(
        select(MfaCredential).where(
            MfaCredential.user_id == user.id, MfaCredential.enabled_at.is_not(None)
        )
    )
    # Strict cookies do not accompany Google's cross-site redirect. Use only the
    # digest captured on the same-origin start request; revalidate its owner and
    # current expiry/revocation, never carry forward a boolean trust decision.
    trust = (
        await database.scalar(
            select(MfaTrustedBrowser).where(
                MfaTrustedBrowser.token_hash == flow.trust_token_hash,
                MfaTrustedBrowser.user_id == user.id,
                MfaTrustedBrowser.revoked_at.is_(None),
                MfaTrustedBrowser.expires_at > now,
            )
        )
        if flow.trust_token_hash
        else None
    )
    if credential and not trust:
        challenge, raw_challenge = create_mfa_challenge(
            user, settings, now, client_ip(request), request.headers.get("user-agent", "unknown")
        )
        database.add(challenge)
        await database.commit()
        response = redirect("/mfa-challenge")
        response.delete_cookie(settings.cookie_name, path="/")
        _set_pre_auth_cookie(response, settings, raw_challenge)
        return response
    session, raw_session = create_full_session(
        user, settings, now, client_ip(request), request.headers.get("user-agent", "unknown")
    )
    database.add(session)
    await database.commit()
    response = redirect("/dashboard")
    _set_session_cookie(response, settings, raw_session)
    return response
