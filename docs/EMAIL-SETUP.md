# Verification and password recovery email

V2.5 development feature. Email is optional and off on new installations until an
owner or superadmin configures it in **Admin → Verification & recovery**.

## Configure

1. Pick Gmail / Google Workspace or Other provider (SMTP).
2. Enter the provider's SMTP hostname and username, an authorized From address,
   and its app password or SMTP password. Gmail uses `smtp.gmail.com`, port 587,
   and an app password from a Google account with 2-Step Verification enabled.
3. Choose 587 (STARTTLS) or 465 (TLS). Plaintext SMTP and disabling certificate
   verification are not supported. Some providers require OAuth rather than
   SMTP passwords; use a provider supporting this authentication method.
4. Enter the fixed HTTPS address members use for this CardVault installation.
   A private/LAN address works only from that network. This setting does not
   expose the server to the Internet and does not configure Google sign-in.
5. Enable email and enter your **CardVault** password to save. CardVault checks
   secure SMTP authentication before saving enabled settings.
6. Enter your CardVault password again and send a test using saved settings.
   It goes to your account's email. Provider acceptance is not proof of inbox
   delivery; check your inbox and spam folder.

Saved provider passwords are never returned to the browser. Leave the password
field blank to keep the saved value; entering a new one replaces it.

## Member experience

- New public signups receive a verification link valid for 24 hours and cannot
  sign in until it is confirmed. Existing accounts retain access. Owner setup
  and private invitation acceptance retain their existing trusted setup flows.
- Sign in includes **Forgot password?** and **Resend verification**. Requests
  have generic responses to avoid exposing whether an account exists. An owner
  must enable email before messages can be sent.
- Reset links expire in 30 minutes, are single-use, and never contain a
  temporary password. Resetting revokes sessions, trusted MFA browsers and
  pending MFA challenges. It does not disable MFA or automatically sign in.
- Email/password changes invalidate outstanding links. Inactive users cannot
  redeem links. Link secrets live in URL fragments and are removed from the
  address bar when the page opens; a button press is required to redeem them.
- Delivery failures do not undo account creation. Members can request another
  verification link. If email is disabled after signup, already-unverified
  accounts remain gated; re-enable delivery to resend links.
- Requests are limited per address and IP. The current count-based throttle is
  a best-effort limit under concurrent requests, not a distributed quota.

## Security, backup and recovery

SMTP credentials are encrypted in PostgreSQL with AES-GCM using a separate
purpose-derived key from the installation's protected MFA encryption key.
Keep both the encrypted database backup and that key in protected recovery
storage. Restoring the database without the key cannot recover SMTP passwords
or MFA secrets. Never publish either, or include real credentials in docs.

SMTP works after the HTTP response on a background task. Delivery is not a
durable queued service; a restart or provider outage may require a new link.
The server logs a generic delivery warning without recipient, link, password
or provider response details. This avoids adding a new queue service and cost.

If a provider credential was exposed, revoke it at the provider and save a new
one in Admin. This does not require changing members' CardVault passwords.

Google sign-in requires separate OAuth configuration and a supported HTTPS
hostname; Gmail SMTP does not enable the Google sign-in button. Apple and
physical scanner control are separate projects.
