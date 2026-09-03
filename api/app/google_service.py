"""Fixed-provider OIDC verification. Never log codes, ID tokens, or secrets."""

import base64
import hashlib
import hmac
import secrets

import httpx
import jwt
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

AAD = b"cardvault:google:v1"
CALLBACK = "/api/v1/auth/google/callback"


def encrypt(value, settings):
    key = hmac.new(settings.mfa_encryption_key, AAD, hashlib.sha256).digest()
    nonce = secrets.token_bytes(12)
    return base64.urlsafe_b64encode(
        nonce + AESGCM(key).encrypt(nonce, value.encode(), AAD)
    ).decode()


def decrypt(value, settings):
    key = hmac.new(settings.mfa_encryption_key, AAD, hashlib.sha256).digest()
    packed = base64.urlsafe_b64decode(value)
    return AESGCM(key).decrypt(packed[:12], packed[12:], AAD).decode()


def validate_id_token(token, jwks, client_id, nonce):
    header = jwt.get_unverified_header(token)
    if header.get("alg") != "RS256":
        raise ValueError("Invalid algorithm")
    key_data = next(k for k in jwks["keys"] if k.get("kid") == header.get("kid"))
    key = jwt.PyJWK.from_dict(key_data, algorithm="RS256").key
    claims = jwt.decode(
        token,
        key,
        algorithms=["RS256"],
        audience=client_id,
        issuer=["https://accounts.google.com", "accounts.google.com"],
        options={"require": ["exp", "iat", "iss", "aud", "sub", "nonce", "email_verified"]},
    )
    if (
        claims.get("nonce") != nonce
        or claims.get("email_verified") is not True
        or not isinstance(claims["sub"], str)
        or not 1 <= len(claims["sub"]) <= 255
        or (claims.get("azp") is not None and claims["azp"] != client_id)
    ):
        raise ValueError("Invalid identity")
    return claims["sub"]


async def exchange(config, code, verifier, nonce, settings):
    async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
        result = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": config.client_id,
                "client_secret": decrypt(config.secret_ciphertext, settings),
                "redirect_uri": config.site_url + CALLBACK,
                "code_verifier": verifier,
            },
        )
        result.raise_for_status()
        token = result.json()["id_token"]
        keys = await client.get("https://www.googleapis.com/oauth2/v3/certs")
        keys.raise_for_status()
        return validate_id_token(token, keys.json(), config.client_id, nonce)
