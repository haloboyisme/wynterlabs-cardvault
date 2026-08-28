import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4)
_dummy_hash = _hasher.hash("not-a-real-wynterlabs-password")


def hash_password(plain: str) -> str:
    return _hasher.hash(plain)


def verify_password(plain: str, encoded: str | None) -> bool:
    candidate = encoded or _dummy_hash
    try:
        return _hasher.verify(candidate, plain)
    except (InvalidHashError, VerificationError, VerifyMismatchError):
        return False


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def new_invitation_token() -> str:
    return secrets.token_urlsafe(32)


def new_mfa_challenge_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(raw: str, pepper: str) -> str:
    return hmac.new(pepper.encode(), raw.encode(), hashlib.sha256).hexdigest()


def hash_invitation_token(raw: str, pepper: str) -> str:
    payload = f"wynterlabs-invitation-v1:{raw}"
    return hmac.new(pepper.encode(), payload.encode(), hashlib.sha256).hexdigest()


def hash_mfa_challenge_token(raw: str, pepper: str) -> str:
    return hash_token(f"wynterlabs-mfa-challenge-v1:{raw}", pepper)


def expires_at(hours: int) -> datetime:
    return datetime.now(UTC) + timedelta(hours=hours)


def identifier_hash(identifier: str, pepper: str) -> str:
    return hash_token(identifier.strip().lower(), pepper)
