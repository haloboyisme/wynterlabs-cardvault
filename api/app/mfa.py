"""Cryptographic primitives for privileged-account MFA.

This module intentionally has no database or HTTP dependencies so its RFC 6238
and authenticated-encryption behavior can be tested independently.
"""

import base64
import hashlib
import hmac
import secrets
import struct

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

TOTP_PERIOD = 30
TOTP_DIGITS = 6
TOTP_AAD = b"wynterlabs-cards:mfa-totp:v1"
_RECOVERY_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"


def generate_totp_secret() -> bytes:
    """Return the RFC 6238 seed used for an enrolled credential."""
    return secrets.token_bytes(20)


def totp_at(
    secret: bytes,
    unix_time: int,
    *,
    digits: int = TOTP_DIGITS,
    period: int = TOTP_PERIOD,
) -> str:
    """Calculate the SHA-1 TOTP value for an exact Unix timestamp."""
    counter = unix_time // period
    digest = hmac.new(secret, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    binary = int.from_bytes(digest[offset : offset + 4], "big") & 0x7FFFFFFF
    return str(binary % (10**digits)).zfill(digits)


def matching_totp_counter(
    secret: bytes,
    code: str,
    unix_time: int,
    *,
    window: int = 1,
) -> int | None:
    """Return a matching counter, checking current, previous, then next."""
    if not code.isascii() or not code.isdecimal() or len(code) != TOTP_DIGITS:
        return None
    current = unix_time // TOTP_PERIOD
    for counter in (
        current,
        *range(current - 1, current - window - 1, -1),
        *range(current + 1, current + window + 1),
    ):
        if counter >= 0 and hmac.compare_digest(code, totp_at(secret, counter * TOTP_PERIOD)):
            return counter
    return None


def _validate_key(key: bytes) -> None:
    if len(key) != 32:
        raise ValueError("MFA encryption key must contain exactly 32 bytes")


def encrypt_totp_secret(secret: bytes, key: bytes) -> str:
    """Encrypt a TOTP seed using a new AES-GCM nonce and fixed AAD."""
    _validate_key(key)
    nonce = secrets.token_bytes(12)
    packed = nonce + AESGCM(key).encrypt(nonce, secret, TOTP_AAD)
    return base64.urlsafe_b64encode(packed).decode().rstrip("=")


def decrypt_totp_secret(encoded: str, key: bytes) -> bytes:
    """Decrypt a URL-safe, padding-free nonce/ciphertext/tag value."""
    _validate_key(key)
    packed = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
    if len(packed) < 12 + 16:
        raise ValueError("Encrypted MFA secret is malformed")
    return AESGCM(key).decrypt(packed[:12], packed[12:], TOTP_AAD)


def normalize_recovery_code(value: str) -> str:
    """Normalize the human-friendly grouped recovery-code spelling."""
    return value.replace("-", "").upper()


def new_recovery_codes(count: int = 10) -> list[str]:
    """Generate distinct 20-character Base32 recovery codes in groups of five."""
    codes: set[str] = set()
    while len(codes) < count:
        normalized = "".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(20))
        codes.add("-".join(normalized[index : index + 5] for index in range(0, 20, 5)))
    return list(codes)
