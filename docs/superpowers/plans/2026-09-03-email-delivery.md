# Account email delivery implementation plan

**Goal:** Deliver signup verification and password recovery on the private installation, without changing existing members' access.

**Approved scope:** Gmail for the owner's installation; configurable authenticated SMTP for other installations. Google sign-in is a separate stage; Apple and hardware remain excluded. Reuse the current account forms, roles, encryption library, session revocation, database, and styles. Do not publish until private acceptance.

## Design and constraints

- Owner/superadmin configures TLS SMTP on ports 465 or 587 and a fixed HTTPS site origin. Require their current password. Store the SMTP password encrypted in the database with a domain-separated key derived from the existing protected MFA key. Never return it or log it.
- Mail is disabled by default. Config saving verifies SMTP login before enabling. Test email goes only to the signed-in operator. Gmail is a preset; custom SMTP supports other providers.
- Existing users retain access. New public signups require verification only when mail is enabled; invitation possession continues to be its existing trust path. Unverified accounts receive no session. Verification links expire after 24 hours; reset links expire after 30 minutes.
- Tokens are random, hashed at rest, bound to user/email/password version, and single-use. Successful reset revokes sessions, MFA trust, pending MFA challenges, and other email links; it does not disable MFA or sign the user in.
- Public requests return generic feedback regardless of account existence. Limit requests per IP and email with existing login-attempt records. Run SMTP off the request event loop after commit, without logging recipient/token/provider error text. Failed delivery can be retried with a newly requested link.
- Link secrets use URL fragments, not query strings. Pages remove fragments immediately and require a button press to redeem. Fixed configured origin prevents Host-header injection. SMTP and token responses use no-store.
- Email changes invalidate old links by comparing target email and password version. Reset is allowed only for active, already verified or legacy users.
- Backups require both encrypted database and the separate protected encryption key. No secrets in public artifacts.

## Execution

- [x] Add focused API tests for disabled/enabled configuration, privilege/password checks, secret redaction, signup gating, verification replay/expiry/wrong purpose, generic recovery, session revocation and MFA preservation. Run once to demonstrate missing behavior.
- [x] Add migration 0019 and isolated email schema/service/router modules. Wire signup/login and no-store policies, preserving default-off behavior.
- [x] Reuse auth-card layouts for reset/verification/resend; add a modular admin email panel with Gmail/custom provider selection, TLS settings, fixed site URL and clear feedback.
- [x] Run the focused tests, existing account/registration/MFA tests, frontend checks and production build as a combined gate. Fix failures, not repeat unchanged checks.
- [x] Back up the live installation, deploy only changed files without overwriting unrelated work, migrate, import existing root-only Gmail configuration into encrypted storage, and verify readiness.
- [x] Send one live recovery link to the owner, pause for inbox/browser acceptance: the owner confirmed receipt, password reset and successful sign-in. Google linking and sign-in were subsequently accepted separately.
