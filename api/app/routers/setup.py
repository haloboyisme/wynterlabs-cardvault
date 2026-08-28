import hmac

from fastapi import APIRouter, Depends, Header
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.database import get_db
from app.dependencies import get_settings
from app.errors import AppError
from app.models import Role, User
from app.schemas import OwnerSetup, SetupStatus, UserOut
from app.security import hash_password

router = APIRouter(prefix="/api/v1/setup", tags=["setup"])


async def setup_available(database: AsyncSession) -> bool:
    result = await database.execute(select(User.id).where(User.owner_slot == 1))
    return result.scalar_one_or_none() is None


@router.get("/status", response_model=SetupStatus)
async def status(database: AsyncSession = Depends(get_db)) -> SetupStatus:
    return SetupStatus(available=await setup_available(database))


@router.post("/owner", response_model=UserOut, status_code=201)
async def create_owner(
    payload: OwnerSetup,
    x_bootstrap_secret: str = Header(default=""),
    database: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    if not await setup_available(database):
        raise AppError(409, "setup_closed", "Owner setup is already complete.")
    if not hmac.compare_digest(x_bootstrap_secret, settings.bootstrap_secret):
        raise AppError(403, "invalid_bootstrap_secret", "The setup secret is invalid.")

    user = User(
        email=str(payload.email).lower(),
        email_normalized=str(payload.email).lower(),
        display_name=payload.display_name,
        display_name_normalized=payload.display_name.casefold(),
        password_hash=hash_password(payload.password),
        role=Role.OWNER,
        owner_slot=1,
    )
    database.add(user)
    try:
        await database.commit()
    except IntegrityError as exc:
        await database.rollback()
        raise AppError(409, "setup_closed", "Owner setup is already complete.") from exc
    await database.refresh(user)
    return user
