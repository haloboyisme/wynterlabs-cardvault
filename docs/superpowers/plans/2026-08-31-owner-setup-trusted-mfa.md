# Owner Setup Closure and Five-Hour Trusted MFA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the owner bootstrap UI after first setup, make MFA optional for members and mandatory for privileged roles, and trust a browser for exactly five hours after a successful MFA challenge.

**Architecture:** Extend the existing identity tables with one onboarding flag and a hashed opaque trusted-browser token. Reuse the current session pepper, MFA challenge, forced-onboarding dependency, and React authentication routing patterns; preserve the trust cookie on ordinary logout but revoke its server record for security-sensitive account changes.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, PostgreSQL/SQLite tests, React 18, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-31-owner-setup-trusted-mfa-design.md`

## Global Constraints

- Private V2 at `LAN_HOST` is deployed and verified before GitHub V2 is updated.
- Public GitHub V2 is pushed only after the private deployment passes the focused acceptance check.
- The trusted-browser duration is a fixed, non-sliding 18,000 seconds.
- Normal members may enroll in MFA; Owner, Super Admin, and Admin must enroll.
- No browser fingerprinting, IP binding, owner self-delete UI, or new external dependency.
- Keep total Codex usage within the user-approved $4 hard cap.

---

### Task 1: Identity schema and trusted-browser service

**Files:**
- Create: `api/migrations/versions/0016_trusted_mfa_browser.py`
- Modify: `api/app/models.py`
- Modify: `api/app/security.py`
- Modify: `api/app/identity.py`
- Test: `api/tests/test_mfa.py`

**Interfaces:**
- Produces: `User.must_setup_mfa: bool`, `MfaTrustedBrowser`, `create_mfa_trust(user, settings, now, user_agent) -> tuple[MfaTrustedBrowser, str]`, `trusted_mfa_user(database, raw, user_id, settings, now) -> bool`, and `revoke_mfa_trust(database, user_id, revoked_at) -> int`.

- [ ] **Step 1: Write failing model/service tests** proving a token is stored only as a hash, expires at `now + timedelta(hours=5)`, validates only for its own user, and stops validating after expiry or revocation.
- [ ] **Step 2: Run the focused tests** with `PYTHONPATH=api:api/.test-deps python3.13 -m pytest api/tests/test_mfa.py -q`; expect failures for missing schema and service interfaces.
- [ ] **Step 3: Implement the migration, model, and service** using `hash_token(raw, settings.session_pepper)`, a 32-byte URL-safe opaque token, fixed expiry, and transactional bulk revocation.
- [ ] **Step 4: Re-run the focused tests** and expect all Task 1 tests to pass.

### Task 2: MFA policy, login trust, and revocation

**Files:**
- Modify: `api/app/mfa_service.py`
- Modify: `api/app/routers/mfa.py`
- Modify: `api/app/routers/auth.py`
- Modify: `api/app/dependencies.py`
- Modify: `api/app/routers/setup.py`
- Modify: `api/app/registration.py`
- Modify: `api/app/routers/admin.py`
- Modify: `api/app/routers/invitations.py`
- Modify: `api/app/identity_cli.py`
- Modify: `api/app/schemas.py`
- Modify: `api/app/registration_schemas.py`
- Modify: `api/app/admin_schemas.py`
- Modify: `api/app/invitation_schemas.py`
- Test: `api/tests/test_mfa.py`
- Test: `api/tests/test_admin_api.py`
- Test: `api/tests/test_registration_api.py`

**Interfaces:**
- Consumes: Task 1 trusted-browser helpers and `User.must_setup_mfa`.
- Produces: `require_ready_auth` returning `403 mfa_setup_required` for privileged incomplete enrollment, `UserOut.must_setup_mfa`, and the HTTP-only `wynterlabs_mfa_trust` cookie at `/api/v1/auth` with `SameSite=Strict` and `Max-Age=18000`.

- [ ] **Step 1: Write failing API tests** for optional member enrollment, mandatory privileged enrollment, trusted same-browser re-login, five-hour expiry, other-browser challenge, preserved trust on logout, and revocation on password/role/deactivation/break-glass changes.
- [ ] **Step 2: Run the focused API tests** and verify they fail because policy and trusted-cookie behavior do not exist.
- [ ] **Step 3: Implement minimal policy changes**: permit every active user to enroll, set/clear `must_setup_mfa` on role and enrollment transitions, issue trust after TOTP/recovery completion, consult trust after password validation, and revoke trust on all specified security actions.
- [ ] **Step 4: Re-run the focused API tests** and expect them to pass without weakening current challenge replay and recovery-code tests.

### Task 3: Setup visibility and account onboarding UI

**Files:**
- Modify: `web/src/lib/types.ts`
- Modify: `web/src/pages/LoginPage.tsx`
- Modify: `web/src/pages/SetupPage.tsx`
- Modify: `web/src/components/ProtectedRoute.tsx`
- Modify: `web/src/components/MfaSettings.tsx`
- Modify: `web/src/pages/AccountPage.tsx`
- Test: `web/src/app/App.test.tsx`
- Test: `web/src/components/MfaSettings.test.tsx`
- Test: `web/src/pages/AccountPage.test.tsx`

**Interfaces:**
- Consumes: `User.must_setup_mfa` and setup-status API.
- Produces: hidden setup link after bootstrap, `/setup` redirect with notice when closed, optional/required MFA labels, and Account-only privileged onboarding until MFA confirmation.

- [ ] **Step 1: Write failing component tests** for conditional setup UI, member-visible optional MFA, privileged required MFA copy, and route redirection to Account while `must_setup_mfa` is true.
- [ ] **Step 2: Run the focused Vitest files** and verify expected failures.
- [ ] **Step 3: Implement minimal React changes** with setup status failing closed and `auth.refresh()` after successful enrollment so the workspace unlocks immediately.
- [ ] **Step 4: Re-run focused Vitest files** and expect all new UI behavior to pass.

### Task 4: One final verification, private deployment, and GitHub V2 publication

**Files:**
- Modify: `docs/superpowers/plans/2026-08-31-owner-setup-trusted-mfa.md` (mark completed steps)
- Modify: deployment migration/backup documentation only if revision references require it.

**Interfaces:**
- Consumes: Tasks 1-3 complete implementation.
- Produces: verified private V2 deployment and the same commit on `origin/v2`.

- [ ] **Step 1: Run one combined final verification**: focused API tests, focused web tests, TypeScript check/build, migration upgrade/downgrade smoke, and `git diff --check` in a single command group.
- [ ] **Step 2: Commit the complete feature** without dependency caches or secrets.
- [ ] **Step 3: Take and verify a pre-deploy backup**, deploy the exact commit to `LAN_HOST`, apply migration `0016_trusted_mfa_browser`, and perform one private smoke check covering setup status, login page, and health.
- [ ] **Step 4: Push the exact tested feature commit to public GitHub branch `v2`**, then verify the remote branch head and report the private and public commit IDs.
