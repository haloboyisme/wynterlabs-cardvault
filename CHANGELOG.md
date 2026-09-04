# Changelog

## 2.5.1 - Final Version 2 maintenance release

- Present Version 2.5 as complete on Home, remove unsupported-provider plans
  from current user-facing material, and consolidate remaining ideas into a
  staged Version 3 roadmap.
- Update the immutable Docker installation command and release version guard.

## 2.5.0 - Email recovery and Google sign-in

- Add optional Google sign-in and explicit account linking, configured privately
  by the owner/superadmin in Admin. Password sign-in remains available; existing
  MFA requirements still apply. See [Google setup](docs/GOOGLE-SIGN-IN.md).

- Add optional owner/superadmin-configured TLS SMTP for signup verification and
  single-use password recovery, encrypted provider credentials, resend forms,
  and session/MFA-trust revocation after password recovery. Existing accounts
  retain access. See [Email setup](docs/EMAIL-SETUP.md).

- Repair standalone upgrades to use the included `verify-backup.sh` instead of
  a private deployment helper absent from public releases. Restore validation
  runs in a disposable PostgreSQL container with no network or published ports.
- Add an explicitly opt-in disposable upgrade smoke check and upgrade guidance.
- Fix the older-install migration path comparing a newly added PostgreSQL role
  enum value before its transaction commits; compare the stored role as text.

## 2.0.1 - Account and community release

- Added password-confirmed email changes with session revocation, owner-reviewed
  account deletion, role-safe MFA reset controls, and an opt-in private Home feed.
- Repaired legacy test identities, MFA enrollment fixtures, provider-response
  fixtures, and Home branding mocks without weakening authentication rules.
- Updated the standalone installer and installation guide for the new immutable
  release; retained the original `v2.0.0` tag unchanged.
- Release verification evidence is recorded in `docs/v2-release-readiness.md`.

## 2.0.0

- Expanded the catalog and collection foundation across nine supported games.
- Added responsive single-card, multi-card, and simulation-only automatic
  scanner workspaces with correction, exact-printing confirmation, configurable
  countdowns, and clearer match feedback.
- Added game-level collection totals, advanced collection sorting, bulk deck
  and removal workflows, pricing coverage, and private value-history charts.
- Added safe exact-printing TCGplayer and eBay research links without internal
  selling, payments, messaging, shipping, or marketplace accounts.
- Added searchable account administration, role-controlled signup and
  invitations, privileged MFA requirements, trusted-browser handling, and
  scheduled catalog refresh controls.
- Kept one-command Docker installation, generated installation secrets,
  backup/recovery tools, and private-by-default service boundaries.

## 1.0.1

- Completed the first reliable self-hosted collector release and Magic image
  cache hotfix.
