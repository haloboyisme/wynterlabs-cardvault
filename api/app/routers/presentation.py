"""Bounded, account-owned presentation; overlay credentials never authorize writes."""

import copy
import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Literal
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Header, Query, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.branding import validate_logo_data_url
from app.database import get_db
from app.dependencies import CurrentAuth, require_ready_auth
from app.errors import AppError
from app.models import Presentation, User

router = APIRouter(prefix="/api/v1/presentation", tags=["presentation"])


class RewardTier(BaseModel):
    threshold: Literal[5, 10, 20, 50, 100]
    label: str = Field(min_length=1, max_length=40)
    enabled: bool = True
    sound: Literal["off", "chime", "arcade", "fanfare"] = "chime"
    effect: Literal["none", "confetti", "sparks", "burst"] = "confetti"


def default_rewards():
    return [
        RewardTier(threshold=t, label=label, sound=sound, effect=effect)
        for t, label, sound, effect in [
            (5, "Nice pull!", "chime", "sparks"),
            (10, "Great pull!", "arcade", "confetti"),
            (20, "Epic pull!", "fanfare", "burst"),
            (50, "Jackpot!", "fanfare", "confetti"),
            (100, "Legendary!", "fanfare", "burst"),
        ]
    ]


class Preferences(BaseModel):
    enabled: bool = False
    reveal: Literal["instant", "fade", "flip", "slide", "zoom", "pop", "tilt"] = "instant"
    background: Literal[
        "transparent", "green", "blue", "solid", "gradient", "spotlight", "grid", "stars"
    ] = "solid"
    color: str = Field(default="#121826", pattern=r"^#[0-9a-fA-F]{6}$")
    accent: str = Field(default="#a78bfa", pattern=r"^#[0-9a-fA-F]{6}$")
    layout: Literal["landscape", "portrait", "square", "reverse"] = "landscape"
    duration: float = Field(default=0.7, ge=0.1, le=3)
    hold: float = Field(default=3, ge=1, le=10)
    scale: float = Field(default=1, ge=0.5, le=1.5)
    glow: bool = False
    pack: bool = False
    details: bool = True
    prices: bool = True
    muted: bool = False
    volume: float = Field(default=0.35, ge=0, le=1)
    audio: Literal["scanner", "overlay"] = "scanner"
    confirm: Literal["off", "chime", "arcade"] = "chime"
    reject: Literal["off", "chime", "arcade"] = "chime"
    complete: Literal["off", "chime", "arcade"] = "arcade"
    found: Literal["off", "chime", "arcade"] = "chime"
    rewards: bool = True
    particles: bool = True
    reward_tiers: list[RewardTier] = Field(
        default_factory=default_rewards, min_length=5, max_length=5
    )

    @field_validator("reward_tiers")
    @classmethod
    def unique_tiers(cls, value):
        if {tier.threshold for tier in value} != {5, 10, 20, 50, 100}:
            raise ValueError("Provide each prize tier exactly once")
        return value

    highlights: bool = False
    card_back: str = Field(default="", max_length=350000)

    @field_validator("card_back")
    @classmethod
    def safe_card_back(cls, value):
        if value:
            validate_logo_data_url(value)
        return value


class Pull(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    printing_id: str = Field(default="", max_length=50)
    image: str = Field(default="", max_length=1500)
    set: str = Field(default="", max_length=200)
    number: str = Field(default="", max_length=50)
    language: str = Field(default="", max_length=20)
    finish: str = Field(default="", max_length=50)
    price: str = Field(default="", max_length=60)
    rarity: str = Field(default="", max_length=40)
    quantity: int = Field(default=1, ge=1, le=9999)
    highlight: bool = False

    @field_validator("image")
    @classmethod
    def safe_image(cls, value):
        if value and not (value.startswith("/api/") or urlparse(value).scheme == "https"):
            raise ValueError("Image must use HTTPS or a local API path")
        return value


class Event(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    kind: Literal["confirm", "found", "reject", "finish", "replay", "new", "remove", "highlight"]
    card: Pull | None = None
    target: str = Field(default="", max_length=80)


def initial():
    return {
        "settings": Preferences().model_dump(),
        "cards": [],
        "seen": [],
        "revision": 0,
        "finished": False,
        "event": None,
    }


async def owned(db, auth):
    row = (
        await db.execute(
            select(Presentation).where(Presentation.user_id == auth.user.id).with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        row = Presentation(user_id=auth.user.id, document=initial())
        db.add(row)
        try:
            await db.flush()
        except IntegrityError:
            await db.rollback()
            row = (
                await db.execute(
                    select(Presentation)
                    .where(Presentation.user_id == auth.user.id)
                    .with_for_update()
                )
            ).scalar_one()
    return row


def public(doc):
    return {k: v for k, v in doc.items() if k != "seen"}


def no_cache(response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"


@router.get("")
async def state(
    response: Response,
    auth: CurrentAuth = Depends(require_ready_auth),
    db: AsyncSession = Depends(get_db),
):
    no_cache(response)
    row = await owned(db, auth)
    result = public(row.document)
    await db.commit()
    return result


@router.put("/settings")
async def settings(
    body: Preferences,
    response: Response,
    auth: CurrentAuth = Depends(require_ready_auth),
    db: AsyncSession = Depends(get_db),
):
    no_cache(response)
    row = await owned(db, auth)
    doc = copy.deepcopy(row.document)
    doc["settings"] = body.model_dump()
    row.document = doc
    await db.commit()
    return public(doc)


@router.post("/events")
async def event(
    body: Event,
    response: Response,
    auth: CurrentAuth = Depends(require_ready_auth),
    db: AsyncSession = Depends(get_db),
):
    no_cache(response)
    row = await owned(db, auth)
    doc = copy.deepcopy(row.document)
    if body.id in doc["seen"]:
        await db.commit()
        return public(doc)
    if body.kind == "found":
        if body.card is None:
            raise AppError(422, "preview_card_required", "A found card is required.")
        doc["preview"] = {**body.card.model_dump(), "id": body.id}
    if body.kind == "confirm":
        if doc["finished"]:
            raise AppError(409, "pack_finished", "Start a new pack before adding another pull.")
        if body.card is None or len(doc["cards"]) >= 100:
            raise AppError(
                422,
                "pack_limit",
                "A pack supports up to 100 saved pulls. Finish it and start a new pack.",
            )
        doc["cards"].append({**body.card.model_dump(), "id": body.id})
        doc["preview"] = None
    if body.kind in ("remove", "highlight"):
        if body.kind == "remove":
            doc["cards"] = [c for c in doc["cards"] if c["id"] != body.target]
        else:
            for card in doc["cards"]:
                if card["id"] == body.target:
                    card["highlight"] = not card["highlight"]
    if body.kind == "finish":
        doc["finished"] = True
    if body.kind == "new":
        doc = {**initial(), "settings": doc["settings"], "revision": doc["revision"]}
        row.token_hash = None
        row.token_expires = None
    doc["revision"] += 1
    doc["seen"] = (doc["seen"] + [body.id])[-400:]
    doc["event"] = {"id": body.id, "kind": body.kind}
    row.document = doc
    await db.commit()
    return public(doc)


@router.post("/link")
async def link(
    response: Response,
    auth: CurrentAuth = Depends(require_ready_auth),
    db: AsyncSession = Depends(get_db),
):
    no_cache(response)
    row = await owned(db, auth)
    token = secrets.token_urlsafe(32)
    row.token_hash = hashlib.sha256(token.encode()).hexdigest()
    row.token_expires = datetime.now(UTC) + timedelta(days=7)
    await db.commit()
    return {"token": token, "expires_in_days": 7}


@router.delete("/link", status_code=204)
async def revoke(
    auth: CurrentAuth = Depends(require_ready_auth), db: AsyncSession = Depends(get_db)
):
    row = await owned(db, auth)
    row.token_hash = None
    row.token_expires = None
    await db.commit()


@router.get("/overlay")
async def overlay(
    response: Response,
    authorization: str = Header(default=""),
    db: AsyncSession = Depends(get_db),
    after_revision: int | None = Query(default=None, ge=0),
):
    no_cache(response)
    if not authorization.startswith("Bearer ") or len(authorization) > 100:
        raise AppError(404, "overlay_unavailable", "This preview link is unavailable or expired.")
    hashed = hashlib.sha256(authorization[7:].encode()).hexdigest()
    if after_revision is not None:
        current_revision = await db.scalar(
            select(Presentation.document["revision"].as_integer())
            .join(User)
            .where(
                Presentation.token_hash == hashed,
                Presentation.token_expires > datetime.now(UTC),
                User.is_active.is_(True),
            )
        )
        if current_revision is None:
            raise AppError(
                404, "overlay_unavailable", "This preview link is unavailable or expired."
            )
        if current_revision == after_revision:
            response.status_code = 204
            return response

    row = (
        await db.execute(
            select(Presentation)
            .join(User)
            .where(
                Presentation.token_hash == hashed,
                Presentation.token_expires > datetime.now(UTC),
                User.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise AppError(404, "overlay_unavailable", "This preview link is unavailable or expired.")
    return public(row.document)
