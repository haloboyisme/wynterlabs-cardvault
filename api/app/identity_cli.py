"""Local-only privileged owner MFA status and break-glass recovery."""

import argparse
import asyncio
import sys
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TextIO

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.database import create_engine, create_session_factory
from app.identity import revoke_mfa_trust, revoke_user_sessions
from app.mfa_service import AUDIT_OWNER_MFA_BREAK_GLASS, new_security_audit_event
from app.models import MfaCredential, MfaLoginChallenge, MfaRecoveryCode, Role, User


class BreakGlassRejected(Exception):
    pass


@dataclass(frozen=True)
class OwnerMfaStatus:
    owner_id: uuid.UUID
    active: bool
    mfa_enabled: bool
    unused_recovery_codes: int


@dataclass(frozen=True)
class BreakGlassResult:
    revoked_sessions: int


async def owner_mfa_status(database: AsyncSession) -> OwnerMfaStatus:
    owner = await database.scalar(select(User).where(User.owner_slot == 1))
    if owner is None:
        raise BreakGlassRejected("Owner identity did not match")
    credential = await database.scalar(
        select(MfaCredential).where(MfaCredential.user_id == owner.id)
    )
    unused = 0
    if credential and credential.enabled_at:
        unused = int(
            await database.scalar(
                select(func.count(MfaRecoveryCode.id)).where(
                    MfaRecoveryCode.user_id == owner.id,
                    MfaRecoveryCode.used_at.is_(None),
                )
            )
            or 0
        )
    return OwnerMfaStatus(
        owner.id, owner.is_active, bool(credential and credential.enabled_at), unused
    )


async def reset_owner_mfa(
    database: AsyncSession, owner_id: uuid.UUID, confirmation: str, now: datetime
) -> BreakGlassResult:
    if confirmation != "RESET-OWNER-MFA":
        raise BreakGlassRejected("Confirmation did not match")
    owner = await database.scalar(select(User).where(User.owner_slot == 1).with_for_update())
    if owner is None or owner.id != owner_id or owner.role is not Role.OWNER or not owner.is_active:
        raise BreakGlassRejected("Owner identity did not match")
    await database.execute(delete(MfaLoginChallenge).where(MfaLoginChallenge.user_id == owner.id))
    await database.execute(delete(MfaRecoveryCode).where(MfaRecoveryCode.user_id == owner.id))
    await database.execute(delete(MfaCredential).where(MfaCredential.user_id == owner.id))
    revoked = await revoke_user_sessions(database, owner.id, now)
    await revoke_mfa_trust(database, owner.id, now)
    owner.must_setup_mfa = True
    database.add(
        new_security_audit_event(
            user_id=owner.id,
            event_type=AUDIT_OWNER_MFA_BREAK_GLASS,
            actor_type="console",
            details={"revoked_sessions": revoked},
        )
    )
    return BreakGlassResult(revoked_sessions=revoked)


async def _run(
    args: argparse.Namespace, session_factory: async_sessionmaker[AsyncSession], stdout: TextIO
) -> int:
    async with session_factory() as database:
        try:
            if args.command == "owner-mfa-status":
                status = await owner_mfa_status(database)
                print(
                    f"owner_id={status.owner_id} active={status.active} "
                    f"mfa_enabled={status.mfa_enabled} "
                    f"unused_recovery_codes={status.unused_recovery_codes}",
                    file=stdout,
                )
                return 0
            await reset_owner_mfa(database, args.owner_id, args.confirm, datetime.now(UTC))
            await database.commit()
            print("owner_mfa_reset=true", file=stdout)
            return 0
        except BreakGlassRejected as error:
            await database.rollback()
            print(str(error), file=stdout)
            return 2
        except Exception:
            await database.rollback()
            raise


def main(
    argv: Sequence[str] | None = None,
    *,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
    stdout: TextIO = sys.stdout,
) -> int:
    parser = argparse.ArgumentParser(prog="identity_cli")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("owner-mfa-status")
    reset = commands.add_parser("reset-owner-mfa")
    reset.add_argument("--owner-id", type=uuid.UUID, required=True)
    reset.add_argument("--confirm", required=True)
    args = parser.parse_args(argv)
    if session_factory is None:
        settings = Settings()
        session_factory = create_session_factory(create_engine(settings))
    return asyncio.run(_run(args, session_factory, stdout))


if __name__ == "__main__":
    raise SystemExit(main())
