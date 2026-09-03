# V2 Account and Community Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure email-free account completion and a private-by-default Home activity feed, then close the local V2 release record.

**Architecture:** Add one additive migration, keep self-service mutations in the Account router, privileged actions in Admin, and expose a bounded derived community feed through its own router. Reuse existing identity locks, password checks, role hierarchy, session/MFA revocation, collection/catalog records, UI cards, and release checks.

**Tech Stack:** FastAPI, SQLAlchemy async, Alembic, PostgreSQL/SQLite tests, React, TypeScript, Vitest, Testing Library, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-02-v2-account-community-completion-design.md`

## Global Constraints

- No SMTP, external identity provider, new external service, or paid API.
- Activity sharing defaults off and exposes no email, price, condition, note, session, IP, or scanner-photo data.
- Owner deletion is not exposed in the web interface.
- GitHub remains unchanged until the owner approves the private live result.
- Run one combined final verification after focused red-green cycles.

---

### Task 1: Account data and self-service API

**Files:**
- Create: `api/migrations/versions/0018_account_community_controls.py`
- Modify: `api/app/models.py`
- Modify: `api/app/schemas.py`
- Modify: `api/app/routers/account.py`
- Test: `api/tests/test_identity_api.py`
- Test: `api/tests/postgres_identity_concurrency_smoke.py`

**Interfaces:**
- Produces: `AccountPreferencesOut`, `AccountEmailUpdate`, `AccountDeletionRequestOut`; `/api/v1/account/email`, `/api/v1/account/preferences`, and `/api/v1/account/deletion`.

- [ ] Write API tests for password-confirmed unique email change, full session/trust revocation, private-default preference updates, deletion request creation, duplicate prevention, and cancellation.
- [ ] Run the focused tests and verify failures come from missing schema/routes.
- [ ] Add migration, models, schemas, and minimal account endpoints using existing identity helpers.
- [ ] Re-run the focused tests and PostgreSQL identity smoke until green.

### Task 2: Privileged deletion and MFA recovery

**Files:**
- Modify: `api/app/admin_schemas.py`
- Modify: `api/app/routers/admin.py`
- Modify: `api/app/mfa_service.py`
- Test: `api/tests/test_admin_api.py`
- Test: `api/tests/test_mfa.py`

**Interfaces:**
- Produces: `/api/v1/admin/deletion-requests`, decision endpoints, direct non-owner deletion, and `/api/v1/admin/users/{user_id}/reset-mfa`.

- [ ] Write tests for owner-only deletion decisions, typed confirmation, target locking, direct deletion, owner protection, Super Admin MFA hierarchy, credential/code removal, and session/trust revocation.
- [ ] Run the focused tests and verify the intended missing-endpoint failures.
- [ ] Implement the smallest transactional privileged actions and sanitized audit events.
- [ ] Re-run the focused tests until green.

### Task 3: Private derived community feed

**Files:**
- Create: `api/app/community_schemas.py`
- Create: `api/app/routers/community.py`
- Modify: `api/app/main.py`
- Test: `api/tests/test_community_api.py`

**Interfaces:**
- Produces: `GET /api/v1/community/activity?limit=20` returning bounded `card_added`, `member_joined`, and `catalog_updated` entries.

- [ ] Write tests proving authentication, opt-in filtering, sensitive-field omission, newest-first ordering, catalog entries, and limit bounds.
- [ ] Run the focused test and verify the missing-route failure.
- [ ] Implement the bounded derived queries and register the router.
- [ ] Re-run the focused test until green.

### Task 4: Account and Admin controls

**Files:**
- Modify: `web/src/lib/types.ts`
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/lib/admin.ts`
- Modify: `web/src/pages/AccountPage.tsx`
- Modify: `web/src/pages/AdminPage.tsx`
- Modify: `web/src/pages/AccountPage.test.tsx`
- Modify: `web/src/pages/AdminPage.test.tsx`
- Modify: `web/src/styles/global.css`

**Interfaces:**
- Consumes: Tasks 1-2 APIs.
- Produces: accessible Account email/privacy/deletion cards and Admin deletion/MFA-reset controls.

- [ ] Add failing component tests for password/confirmation requirements, sign-out feedback, preference state, deletion request state, owner warnings, and role-scoped MFA reset.
- [ ] Run both focused files and verify expected failures.
- [ ] Add typed client calls and reuse existing panel, notice, dialog, and managed-account patterns.
- [ ] Re-run both focused files until green.

### Task 5: Authenticated Home activity

**Files:**
- Create: `web/src/lib/community.ts`
- Modify: `web/src/pages/HomePage.tsx`
- Create: `web/src/pages/HomePage.test.tsx`
- Modify: `web/src/styles/global.css`

**Interfaces:**
- Consumes: Task 3 activity endpoint.
- Produces: signed-in activity feed with retry/empty states while preserving unsigned Home privacy.

- [ ] Add failing Home tests for recent cards, member joins, catalog updates, retry behavior, and no signed-out member activity request.
- [ ] Run the focused file and verify expected failures.
- [ ] Implement the typed client and responsive feed using existing Home cards and card-image fallback.
- [ ] Re-run the focused file until green.

### Task 6: Documentation and one final gate

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/v2-release-readiness.md`
- Modify: `docs/api-reference.md`
- Modify: `docs/security.md`
- Modify: `docs/operations.md`

**Interfaces:**
- Consumes: all preceding behavior and verification evidence.
- Produces: current V2 feature boundaries and one consolidated verification record.

- [ ] Update product, privacy, account-recovery, community, API, and operations documentation without private identities or deployment secrets.
- [ ] Run one combined final command covering focused API/web tests, migration upgrade/downgrade smoke, TypeScript, production build, document links, diff checks, and tracked-file secret scanning.
- [ ] Record only observed results and remaining private-deployment/owner-review steps.
- [ ] Prepare the private deployment using the existing backup-first rollback workflow; do not push GitHub.
