# Owner Setup Closure and Five-Hour Trusted MFA Design

## Status

Approved for private V2 implementation. Public GitHub V2
must not be updated until the owner tests the private deployment and explicitly
approves publishing it.

## Goals

- Hide the initial owner-setup entry point after an owner exists.
- Keep the backend owner-creation gate one-time and race safe.
- Let normal members opt into MFA without requiring it.
- Require Owner, Super Admin, and Admin accounts to enroll in MFA before using
  the normal signed-in workspace or privileged tools.
- Let a browser that completed MFA sign in again without another MFA challenge
  for exactly five hours, including after an ordinary sign-out.
- Require MFA immediately on another browser/device and after the five-hour
  window expires.

## Non-goals

- Do not add an owner self-delete button.
- Do not identify devices with fingerprinting, IP binding, or invasive browser
  data.
- Do not make the five-hour window sliding or extend it on activity.
- Do not weaken password checks, MFA replay protection, recovery-code
  single-use behavior, or normal session expiration.
- Do not push GitHub V2 as part of the private deployment.

## Owner setup behavior

`GET /api/v1/setup/status` remains the authority for whether setup is open.
Setup is available only when no row owns `owner_slot = 1`. The database unique
owner slot and the existing transactional `POST /api/v1/setup/owner` check
continue preventing a second owner under concurrency.

The unauthenticated login page requests setup status and renders the
"Complete owner setup" link only when the response is explicitly
`{"available": true}`. A failed status request keeps the link hidden rather
than advertising a sensitive initialization route.

When `/setup` loads and setup is closed, it replaces history with `/login` and
shows a short `Setup is already complete` notice. If a controlled recovery
operation removes the only owner so that no owner slot remains, the existing
status endpoint automatically makes the link and setup form available again.

## Privileged MFA enrollment

Normal members may enroll in MFA from Account, but membership does not require
it. Owner, Super Admin, and Admin accounts must have enabled MFA before they
can use the normal protected workspace.

Add `must_setup_mfa` to `users`. It is:

- `true` for a newly bootstrapped Owner;
- `true` for Admin or Super Admin invitation acceptance when no enabled MFA
  credential exists;
- `true` when a member is promoted to a privileged role without enabled MFA;
- `false` for ordinary members;
- cleared only after successful MFA enrollment confirmation;
- restored when privileged MFA is reset through the recovery CLI;
- cleared on demotion to Member.

The authenticated user response exposes `must_setup_mfa` without exposing MFA
secrets. A password-authenticated privileged user with this flag receives a
normal short path to Account so enrollment endpoints remain usable, but other
protected routes redirect to Account and backend ready/privileged dependencies
return `403 mfa_setup_required`. Logout and the MFA enrollment endpoints remain
available during this restricted state. This reuses the existing forced
password onboarding pattern instead of creating a second pre-authentication
protocol.

Once any user has enabled MFA, that user's future password logins require MFA
unless a valid five-hour trusted-browser record is present. Thus optional
member MFA is enforced after the member chooses to enable it.

## Trusted-browser data and cookie

Migration `0016_trusted_mfa_browser` adds `mfa_trusted_browsers` with:

- random UUID primary key;
- `user_id` with cascade delete;
- unique SHA-256 token hash;
- `created_at`;
- fixed `expires_at`;
- nullable `revoked_at`;
- bounded user-agent text for owner-facing recognition and diagnostics.

The raw random token exists only in an HTTP-only cookie named
`wynterlabs_mfa_trust`. The cookie uses `Secure` in production,
`SameSite=Strict`, path `/api/v1/auth`, and `Max-Age=18000`. The database stores
only the peppered token hash. The cookie is not readable by application
JavaScript.

Successful TOTP or recovery-code completion creates a new trusted-browser
record and cookie expiring exactly five hours later. The expiry is absolute:
login and activity never extend it. Ordinary logout revokes the normal session
and deletes only the normal session cookie; it intentionally preserves the
trusted-browser cookie.

## Login flow

After password and account validation:

1. If the account has no enabled MFA credential, continue with the existing
   password-authenticated session. Privileged users remain restricted by
   `must_setup_mfa` until enrollment succeeds.
2. If MFA is enabled, hash the presented trusted-browser cookie and load a
   record belonging to that same user.
3. A matching, unrevoked, unexpired record permits normal session creation
   without a new MFA challenge.
4. A missing, mismatched, revoked, or expired record is treated identically:
   clear the stale trust cookie and return the existing `mfa_required` result.
5. Another browser or private window has no token and therefore requires MFA.

No response reveals whether a trust token belongs to a different account.
Login rate limiting remains based on IP or normalized identity and is checked
before trust evaluation.

## Revocation rules

All trusted-browser records for a user are revoked when:

- the password changes or is administratively reset;
- MFA is reset through owner break-glass recovery;
- the account is deactivated;
- the account's role changes;
- all account sessions are revoked through a security action;
- the account is deleted.

Ordinary logout is the deliberate exception so a same-browser login can use
the remaining five-hour approval. A stale client cookie is harmless after its
server record is revoked or expires and is cleared on the next login attempt.

## Interface behavior

- Login hides owner setup after setup closes.
- Account shows MFA controls to members as optional.
- Account labels MFA as required for Owner, Super Admin, and Admin.
- A privileged account awaiting enrollment sees a focused onboarding panel,
  can enroll or sign out, and receives clear feedback that the rest of the
  workspace unlocks after MFA confirmation.
- Successful MFA states that this browser is trusted for five hours.
- The design adds no device fingerprinting and makes no promise that clearing
  browser data preserves trust.

## Error and security handling

- Database failures never fall back to bypassing MFA.
- Invalid trusted tokens never become authentication errors that disclose
  token state; the server falls back to the normal MFA challenge.
- Trusted-token comparison uses the existing session pepper and constant-time
  digest comparison behavior already used for opaque session tokens.
- Concurrent MFA completions may create more than one valid five-hour token,
  one for each successful browser completion; revocation operations affect all
  of them transactionally.
- Role changes lock and revalidate the actor and target as established by the
  current role-authority implementation.

## Tests and acceptance

Automated tests must prove:

- setup link and form are visible only while setup is available;
- owner creation remains closed after the first owner;
- member MFA is optional before enrollment and required after enrollment;
- privileged users without MFA are limited to enrollment, logout, and allowed
  account setup operations;
- promotion and privileged invitation acceptance require MFA onboarding;
- successful TOTP and recovery completion issue a five-hour trust record;
- same-browser logout/login within five hours skips MFA;
- another browser and an expired/revoked token require MFA;
- the window does not slide;
- password reset/change, role change, deactivation, and break-glass recovery
  revoke trusted-browser records;
- cookie flags are secure in production;
- migration upgrade/downgrade and backup/restore tooling recognize revision
  `0016_trusted_mfa_browser`.

Private acceptance must cover owner setup visibility,
optional member enrollment, mandatory privileged enrollment, same-browser
login within five hours, and another-browser MFA. A fresh backup and isolated
restore verification are required before the private deployment is considered
complete.
