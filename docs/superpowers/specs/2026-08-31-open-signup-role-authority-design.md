# Open Signup and Role Authority Design

## Goal

Allow anyone who can reach the CardVault server to create a normal member account while ensuring that self-registration can never grant administrative authority. Add a separate super-admin role so the owner can delegate ordinary administrator management without delegating ownership.

## Account creation

- `GET /signup` shows the account form whether or not an invitation token is present.
- Submitting the form without a token creates an active `member` account and signs it in.
- Submitting a valid invitation creates the role recorded when the invitation was issued and signs the account in.
- Existing `/accept-invitation#token=...` links remain supported.
- Email and display-name uniqueness, password rules, normalized identities, session cookies, and rate limiting reuse the current identity system.
- Registration responses never reveal whether an email or display name belongs to an elevated account beyond the existing conflict message.

## Roles and authority

The role hierarchy is:

1. `owner`: permanent highest authority and the only role that can grant or remove `super_admin`.
2. `super_admin`: can promote or demote members and regular administrators, and can issue administrator invitations.
3. `admin`: retains current catalog, branding, moderation, and operational tools but cannot grant roles or issue elevated invitations.
4. `member`: normal collection, scanner, deck, and account access.

No endpoint may change the owner's role, deactivate the owner, or create a second owner. A super admin cannot create, promote, demote, or deactivate another super admin.

## Invitations

- Invitations store a target role of `member` or `admin`.
- Owner and super admins may create admin invitations.
- Owner may continue creating member invitations for private onboarding.
- Links remain random, single-use, revocable, and expire after seven days.
- The role is read from the server-side invitation record, never from browser input.
- Existing invitation rows migrate to target role `member`.

## Administration interface

- The Admin page includes an account-access section visible only to the owner and super admins.
- It lists members and administrators with their current status.
- The owner can change a member or administrator to `admin` or `super_admin`.
- A super admin can change a member to `admin` and an admin back to `member`.
- The invitation panel offers Member or Administrator as the target account type, constrained by the signed-in operator's authority.
- Every successful role change or invitation creation shows immediate feedback.

## Data and API changes

- Add `SUPER_ADMIN` to the database and application role enums.
- Add `target_role` to `account_invitations`, defaulting existing and new rows to `MEMBER`.
- Add a rate-limited public registration endpoint that accepts email, display name, and password but no role.
- Replace owner-only user-management dependencies with an explicit role-manager dependency while retaining owner-only checks for super-admin operations.
- Return the new role through the existing authenticated-user and administrator schemas.

## Security and failure behavior

- Public registration has an IP and normalized-identity attempt limit using the existing login-attempt table.
- Password hashing and secure session creation reuse the existing invitation acceptance path.
- Role mutations lock the target row and validate the acting user again inside the transaction.
- Role changes revoke the target user's active sessions so new permissions take effect only after a fresh sign-in.
- Duplicate identities return a conflict without partially creating an account or session.

## Verification and release

- Add focused tests for member-only self-registration, rate limiting, duplicate identities, admin-invite role assignment, and every role-authority boundary.
- Add UI tests for open signup, role controls, and invitation type selection.
- Run one combined focused test and production-build gate.
- Create and verify a host backup, deploy privately, and check signup plus readiness.
- Do not update the public GitHub V2 branch until the owner tests and approves the private deployment.

## Budget boundary

Reuse the existing invitation, identity, session, password, administrator, feedback, and deployment code. Stop before public GitHub publishing or unrelated account-interface redesign. The implementation hard cap is $8.
