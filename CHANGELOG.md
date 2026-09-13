# Changelog

## Scanner set-loading fix — after V2.7.5

- Request the selected game or brand’s catalog sets and reload when it changes.
- Show loading, retry and empty-catalog feedback instead of silently leaving only Auto.
- Preserve remembered set selections and ignore responses from cancelled loads.

## Documentation follow-up — September 12, 2026

- Refresh contributing and security guidance for the V2.7.5 release line.
- Document the current private-reporting gap, OBS-link exposure and shared branding/media boundaries.
- Clarify third-party assets and original theme inspiration in NOTICE.
- Keep the license terms, application version and existing release tags unchanged.

## 2.7.5 — streamer, personalization and shared design

- Add configurable reveals, backgrounds, layouts, custom flip backs and pack video.
- Add private revocable OBS links, found/accepted sounds and five prize tiers.
- Add 42 Base Modes, dynamic looks, optional interface sounds and low-power controls.
- Refresh Account, Admin, Home and Dashboard; close extra collection stats by default.
- Extend Brand Studio with shared design and page controls.
- Add presentation/branding migrations; reduce idle overlay payload and rendering.
- See [release notes](docs/v2.7.5-release.md) for upgrade, verification and limits.

## 2.6.0 — scanner preferences, pricing and history

- Remember scan game/set per account and game on the current browser.
- Add daily TCGCSV pricing, per-card comparisons and sales-based collection totals with coverage.
- Add interactive numeric dashboard history and snapshot exploration.
- Match either split-card half, require explicit ambiguous-printing choices and recover stalled matching requests.
- Reconcile README and roadmap; keep private hardware experiments outside this release.
- See [release notes](docs/v2.6.0-release.md) for validation and limits.

## 2.5.9 — Custom Card Import

- Add a dedicated Custom Card Import page for missing catalog cards, optional HTTPS artwork, set details, values and quantities.
- Keep custom cards private to their account across catalog search, collections, decks and CSV operations.
- Add portable JSON import/export and protect custom records during provider refreshes.
- Include migration 0021_custom_cards and update standalone installation version checks.
- Preserve existing scanner behavior; streamer effects and Bluetooth remain planned.


## Unreleased — planning documentation

- Document planned V3.2 streamer previews, optional sounds and card effects,
  private OBS overlays, and replayable/exportable pack recaps.
- Defer account-owned Bluetooth feeders to V3.5, subject to platform compatibility.
- Refresh upgrade guidance and distinguish the stable release snapshot from
  ongoing documentation updates. No new application features are released here.
- See the [V3 roadmap](docs/V3-ROADMAP.md) and
  [V3.2 proposal](docs/V3.2-STREAMER-PREVIEW.md).

## 2.5.2 - Documentation closeout

- Consolidate final Version 2.5 release evidence, current installation links,
  publishing status and Version 3 handoff without changing application behavior
  or database migrations.

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
