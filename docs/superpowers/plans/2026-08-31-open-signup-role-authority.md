# Open Signup and Role Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure open member registration and let only the owner or super admins grant regular administrator access.

**Architecture:** Extend the existing role enum and invitation record, then reuse the current password hashing, normalized identity, login-attempt, session-cookie, invitation, and administrator flows. Public registration has no role input and always creates a member; elevated roles come only from server-side role mutations or invitation records.

**Tech Stack:** FastAPI, SQLAlchemy async, Alembic, PostgreSQL, React 19, TypeScript, Vitest, Docker Compose

**Spec:** `docs/superpowers/specs/2026-08-31-open-signup-role-authority-design.md`

## Global Constraints

- Self-registration always creates `member`.
- Only the owner can grant or remove `super_admin`.
- Owner and super admins can grant or remove `admin` and issue admin invitations.
- Regular admins retain operational tools but cannot manage roles or elevated invitations.
- The owner cannot be changed, deactivated, or duplicated.
- Existing invitations migrate to target role `member` and remain compatible.
- Invitation links stay single-use, revocable, and valid for seven days.
- Deploy to the private installation first; leave public GitHub V2 unchanged.
- Hard cap: $8.

---

### Task 1: Role and invitation persistence

**Files:**
- Create: `api/migrations/versions/0015_open_signup_role_authority.py`
- Modify: `api/app/models.py`
- Modify: `api/app/dependencies.py`
- Modify: `api/app/mfa_service.py`
- Modify: `api/app/routers/auth.py`
- Test: `api/tests/test_identity_api.py`
- Test: `api/tests/test_invitation_models.py`

**Interfaces:**
- Produces: `Role.SUPER_ADMIN`, `AccountInvitation.target_role`, `require_role_manager()`.
- `require_catalog_operator()` accepts owner, super admin, and admin.
- Privileged MFA treats super admins like owners and admins.

- [ ] **Step 1: Write failing role-boundary tests**

```python
assert Role.SUPER_ADMIN.value == "super_admin"
assert asyncio.run(require_role_manager(_auth_for_role(Role.SUPER_ADMIN))).user.role is Role.SUPER_ADMIN
with pytest.raises(AppError):
    asyncio.run(require_role_manager(_auth_for_role(Role.ADMIN)))
```

Add an invitation-model assertion that a new invitation defaults `target_role` to `Role.MEMBER`.

- [ ] **Step 2: Run the focused tests and verify the missing enum/dependency failure**

Run: `pytest -q api/tests/test_identity_api.py api/tests/test_invitation_models.py`

- [ ] **Step 3: Add the migration and minimal model/dependency changes**

The migration adds PostgreSQL enum value `SUPER_ADMIN`, adds non-null `target_role` to `account_invitations` with existing rows backfilled to `MEMBER`, and preserves downgrade safety. Add:

```python
class Role(str, enum.Enum):
    OWNER = "owner"
    SUPER_ADMIN = "super_admin"
    ADMIN = "admin"
    MEMBER = "member"

async def require_role_manager(auth: CurrentAuth = Depends(require_ready_auth)) -> CurrentAuth:
    if auth.user.role not in (Role.OWNER, Role.SUPER_ADMIN):
        raise AppError(403, "role_manager_required", "Owner or super administrator access is required.")
    return auth
```

- [ ] **Step 4: Run the focused tests and commit**

Run: `pytest -q api/tests/test_identity_api.py api/tests/test_invitation_models.py`

Commit: `feat(v2): add super admin role authority`

### Task 2: Secure public registration and role-bearing invitations

**Files:**
- Create: `api/app/registration.py`
- Create: `api/app/registration_schemas.py`
- Modify: `api/app/main.py`
- Modify: `api/app/invitation_schemas.py`
- Modify: `api/app/routers/invitations.py`
- Modify: `api/app/routers/admin.py`
- Test: `api/tests/test_registration_api.py`
- Test: `api/tests/test_invitation_api.py`

**Interfaces:**
- Produces: `POST /api/v1/registration`, `InvitationCreateRequest.target_role: Role`.
- Registration accepts only `email`, `display_name`, and `password`.
- Invitation acceptance derives the new user's role only from `AccountInvitation.target_role`.

- [ ] **Step 1: Write failing registration and invitation-role tests**

```python
response = client.post("/api/v1/registration", json={
    "email": "member@example.test",
    "display_name": "New Member",
    "password": "a long private password",
})
assert response.status_code == 201
assert response.json()["role"] == "member"
assert "role" not in response.request.content.decode()
```

Cover duplicate identity rollback, the ten-attempt window, secure session cookie, admin invitation acceptance, and rejection when a regular admin tries to issue an elevated invitation.

- [ ] **Step 2: Run the focused tests and verify route/schema failures**

Run: `pytest -q api/tests/test_registration_api.py api/tests/test_invitation_api.py`

- [ ] **Step 3: Implement registration by extracting the current invitation account/session creation path**

Use one private helper in `registration.py` to normalize identities, check conflicts, hash the password, create the user and session, and set the cookie. Record attempts with keys prefixed `registration:`. Do not accept a role field in `RegistrationRequest`.

Update invitation creation to validate `target_role in {MEMBER, ADMIN}` and require `require_role_manager` for `ADMIN`; member invitations may remain owner-managed. Read the accepted role from the locked invitation row.

- [ ] **Step 4: Run the focused tests and commit**

Run: `pytest -q api/tests/test_registration_api.py api/tests/test_invitation_api.py`

Commit: `feat(v2): add secure member registration`

### Task 3: Owner and super-admin user management

**Files:**
- Modify: `api/app/admin_schemas.py`
- Modify: `api/app/routers/admin.py`
- Modify: `web/src/lib/admin.ts`
- Modify: `web/src/lib/invitations.ts`
- Modify: `web/src/pages/AdminPage.tsx`
- Modify: `web/src/pages/AdminPage.test.tsx`
- Modify: `web/src/pages/InvitationPanel.test.tsx`
- Test: `api/tests/test_admin_api.py`

**Interfaces:**
- Produces: `PATCH /api/v1/admin/users/{user_id}/role` with `{role: "member" | "admin" | "super_admin"}`.
- Produces: managed-user list containing members, admins, and super admins but not the owner.
- The response uses the existing `AdminUserOut` shape with expanded `Role`.

- [ ] **Step 1: Write failing authority-matrix tests**

Test these exact outcomes: owner can grant/remove super admin; super admin can promote member to admin and demote admin to member; super admin cannot alter a super admin; regular admin receives 403; no route accepts `owner`; every role change revokes target sessions.

Add UI tests asserting owner sees Super Admin and Admin actions, super admin sees only Admin actions, and regular admin sees no account-access controls.

- [ ] **Step 2: Run focused API and UI tests and verify failures**

Run API: `pytest -q api/tests/test_admin_api.py`

Run web: `vitest run src/pages/AdminPage.test.tsx src/pages/InvitationPanel.test.tsx`

- [ ] **Step 3: Implement locked role mutation and reuse the existing Admin page panels**

Add `AdminRoleRequest(role: Role)`, lock the target user, reject owner targets and illegal transitions, update `role`, revoke sessions, and commit atomically. Expand the existing administrator panel into Account access with role/status badges and authority-filtered actions. Add Member/Administrator selection to invitation creation; never expose Super Admin as an invitation choice.

- [ ] **Step 4: Run focused tests and commit**

Run API: `pytest -q api/tests/test_admin_api.py`

Run web: `vitest run src/pages/AdminPage.test.tsx src/pages/InvitationPanel.test.tsx`

Commit: `feat(v2): add delegated account role controls`

### Task 4: Open signup UI, combined verification, and private deployment

**Files:**
- Modify: `web/src/pages/AcceptInvitationPage.tsx`
- Modify: `web/src/pages/AcceptInvitationPage.test.tsx`
- Modify: `web/src/lib/invitations.ts`
- Modify: `web/src/lib/types.ts`
- Modify: `web/src/app/App.tsx`
- Modify: `web/src/components/AppShell.tsx`
- Modify: `web/src/components/MfaSettings.tsx`
- Modify: role unions in affected web tests

**Interfaces:**
- `/signup` submits public registration when no fragment token exists.
- `/signup#token=...` and `/accept-invitation#token=...` submit invitation acceptance.
- Both successful paths refresh authentication and continue to `/dashboard`.

- [ ] **Step 1: Write failing signup-mode tests**

Assert that `/signup` renders enabled fields and `Create member account`, submits no role, and shows success. Assert that token mode uses invitation acceptance and clears the fragment. Assert Super Admin receives Admin navigation and privileged MFA handling.

- [ ] **Step 2: Run focused web tests and verify failures**

Run: `vitest run src/pages/AcceptInvitationPage.test.tsx src/app/App.test.tsx src/components/MfaSettings.test.tsx`

- [ ] **Step 3: Implement the two signup modes and expanded role unions**

Keep one form and choose the API operation from the token captured at mount. Replace the missing-token warning with open-member copy. Preserve the token clearing and AbortController behavior.

- [ ] **Step 4: Run one combined release gate**

Run API: `pytest -q api/tests/test_registration_api.py api/tests/test_invitation_api.py api/tests/test_admin_api.py api/tests/test_identity_api.py`

Run web: `vitest run src/pages/AcceptInvitationPage.test.tsx src/pages/AdminPage.test.tsx src/pages/InvitationPanel.test.tsx src/app/App.test.tsx src/components/MfaSettings.test.tsx`

Run build: `tsc --noEmit && vite build`

- [ ] **Step 5: Commit, back up, deploy, and verify private live**

Commit: `feat(v2): open member signup`

Create and checksum a CT 102 backup, run `deploy/verify-restore.sh`, deploy with `deploy/deploy.sh`, then verify:

```text
GET https://cardvault.example.invalid/signup -> 200
GET https://cardvault.example.invalid/api/health/ready -> {"status":"ready"}
```

Do not push the V2 branch to GitHub until the owner tests the live result and explicitly approves publishing.
