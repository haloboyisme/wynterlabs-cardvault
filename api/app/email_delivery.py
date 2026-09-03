"""TLS-only SMTP and account-link issuance. Never log secrets or message contents."""

import asyncio
import base64
import hashlib
import hmac
import logging
import secrets
import smtplib
import ssl
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import BackgroundTasks
from sqlalchemy import delete

from app.models import EmailActionToken, EmailDeliverySettings
from app.security import hash_token, new_session_token

logger = logging.getLogger(__name__)
AAD = b"cardvault:smtp-password:v1"


def password_key(settings):
    return hmac.new(settings.mfa_encryption_key, AAD, hashlib.sha256).digest()


def encrypt_password(password, settings):
    nonce = secrets.token_bytes(12)
    return base64.urlsafe_b64encode(
        nonce + AESGCM(password_key(settings)).encrypt(nonce, password.encode(), AAD)
    ).decode()


def decrypt_password(ciphertext, settings):
    packed = base64.urlsafe_b64decode(ciphertext)
    return AESGCM(password_key(settings)).decrypt(packed[:12], packed[12:], AAD).decode()


def connection(config):
    context = ssl.create_default_context()
    smtp = (
        smtplib.SMTP_SSL(config["host"], 465, timeout=15, context=context)
        if config["port"] == 465
        else smtplib.SMTP(config["host"], 587, timeout=15)
    )
    try:
        smtp.ehlo()
        if config["port"] == 587:
            smtp.starttls(context=context)
            smtp.ehlo()
        smtp.login(config["username"], config["password"])
        return smtp
    except Exception:
        smtp.close()
        raise


def check_connection(config):
    with connection(config):
        pass


def send_message(config, recipient, subject, body):
    message = EmailMessage()
    message["From"] = f"WynterLabs CardVault <{config['from_address']}>"
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(body)
    with connection(config) as smtp:
        smtp.send_message(message)


async def deliver_safely(config, recipient, subject, body):
    try:
        await asyncio.to_thread(send_message, config, recipient, subject, body)
    except Exception:
        # SMTP exceptions can include addresses or server-supplied sensitive text.
        logger.warning(
            "Account email delivery failed; request a new link or check Admin email settings"
        )


def config_values(row):
    return {
        key: getattr(row, key)
        for key in ("enabled", "host", "port", "username", "from_address", "site_url")
    }


def transport_config(row, settings):
    return {**config_values(row), "password": decrypt_password(row.password_ciphertext, settings)}


async def enabled_config(database):
    row = await database.get(EmailDeliverySettings, 1)
    return row if row and row.enabled else None


def utc(value):
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


async def issue_link(database, user, purpose, row, settings, tasks: BackgroundTasks):
    now = datetime.now(UTC)
    raw = new_session_token()
    await database.execute(
        delete(EmailActionToken).where(EmailActionToken.expires_at < now - timedelta(days=7))
    )
    database.add(
        EmailActionToken(
            user_id=user.id,
            token_hash=hash_token(raw, settings.session_pepper),
            purpose=purpose,
            target_email=user.email_normalized,
            password_version=user.password_changed_at,
            expires_at=now
            + (timedelta(hours=24) if purpose == "verify" else timedelta(minutes=30)),
        )
    )
    page = "verify-email" if purpose == "verify" else "reset-password"
    title = (
        "Verify your CardVault email" if purpose == "verify" else "Reset your CardVault password"
    )
    duration = "24 hours" if purpose == "verify" else "30 minutes"
    body = (
        f"{title}\n\n{row.site_url}/{page}#token={raw}\n\n"
        f"This link expires in {duration} and works once. "
        "Open it on a device that can reach your CardVault server. "
        "If you did not request this, ignore this email. Never share the link."
    )
    tasks.add_task(deliver_safely, transport_config(row, settings), user.email, title, body)
