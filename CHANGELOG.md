# Changelog

## Scanner diagnostics and navigation protection — September 25, 2026

- Confirm with OK/Cancel before a normal page-link click leaves an active camera or unfinished scan. Cancel preserves the workspace; native browser warnings cover refresh/close where supported. This does not add session recovery or an in-app browser Back interceptor.
- Give ambiguous camera matches one deeper printing read, preserving review choices if it cannot identify a unique printing. Exact-printing confirmation remains required.
- Add stable SCAN error codes plus original/latest catalog suggestions and successfully saved card/finish snapshots. Distinguish an interface-default finish from user-confirmed foil/nonfoil; the camera does not detect foil automatically.
- Add migration `0025_scan_diagnostics`. Previous records retain their tags but cannot reconstruct missing card identities. No photos or raw OCR text are retained. Existing account/admin access and retention remain.
- Public automatic scanning remains simulation-only. Existing release tags are unchanged; real-card success-rate and endurance acceptance remain separate.

## Documentation refresh — September 25, 2026

- Reconcile installation, upgrade, security, contribution and streamer guides with V2.7.7 and current v2 follow-ups. Correct the old 100-pull recap limit.
- Add a documentation index and scan-history guide; distinguish dated release evidence from current instructions. Explain migration 0024 and the standalone helper's same-version restriction.
- No application behavior, license terms, release version or existing tags changed.

## September 25, 2026 — failed-scan history and face matching

- Log first failed attempts across scanner modes, including retry recovery, manual corrections and skipped cards. Keep stable scan IDs and reject stale updates to avoid duplicate or overwritten outcomes.
- Add **Scan history · failed attempts** to Scan, with account isolation and an admin-only combined view. Show the latest 100 records; retain 90 days, capped at 1,000 per account. No photos or recognized text are stored.
- Record short reason tags for unreadable text, missing catalog matches, ambiguous printing, corrected wrong matches, timeouts and service errors. Blur, glare and darkness are suspected quality causes, not confirmed diagnoses.
- Match either face of split, Room and double-faced catalog names before candidate limits, preserving exact-printing ranking.
- Add migration `0024_scan_failures`. Back up first, upgrade the database with `alembic upgrade head` using the deployment's migration procedure, then restart the updated API and web. Older v2.7.7 release instructions describe the original tag, not this follow-up.
- Physical card and prolonged phone/tablet acceptance remain pending. The public automatic scanner remains simulation-only; private feeder code is excluded.

## Post-v2.7.7 updates — September 21, 2026

- Retry difficult scans with deeper sideways/full-art OCR, up to eight title candidates and a 90-second matching window. Poor-focus camera captures can wait up to four extra seconds. Clear captures proceed immediately; exact-printing confirmation remains required.
- Click captured photos to open a larger draggable window while searching. Close with X/Escape; successful saves and removed session cards close the photograph.
- Start OBS overlay audio automatically where autoplay is supported, respect saved mute, and remove the on-screen audio-enable button. Creating an OBS link selects overlay audio to avoid duplicate scanner playback.
- Redesign the streamer studio with a larger preview, Look / Sounds / Replay & OBS navigation, illustrated presets, simpler labels and expandable advanced controls. Keep all sounds, prize tiers, card backs, recap editing and exports.
- Real missed-card/iPhone acceptance remains pending. No new physical-feed validation or success-rate claim is made.

## 2.7.7 — backgrounds, catalog recovery and scanner polish

- Add three original still backgrounds and bounded PNG/JPEG/GIF uploads, preset layering, personal account/browser choices and shared admin branding. Restore defaults includes backgrounds.
- Add adjustable ambient speed and soft/glass/retro interface cues; pause animated uploads when hidden, scanning or in reduced-motion/low-power mode.
- Show per-game catalog attempts and retry only failed games; continue all-game imports after provider failures and avoid duplicate Digimon set-code collisions. Reduce catalog-status reads to two queries.
- Improve camera framing/quality guidance, zoom out/in and lazy rotation/contrast OCR retries. Remove recap card-count caps, retain previous-session recovery and bound export image resolution/concurrency.
- Reconcile current docs and roadmap. V2.7.6 planned scope is delivered in this release.
- Controlled 108-card browser video export and four-cue OBS recording passed. Physical missed-card/iPhone and long-session acceptance remains pending; see [release evidence](docs/v2.7.7-release.md).

## OBS settings refresh — September 13, 2026

- Notify connected overlays when presentation settings change, including mute, volume and audio destination.
- Clear the previous event so a settings update does not replay an old pull or celebration.
- Add a regression test for conditional overlay polling and preserved cards.
- Physical-card, prolonged phone/tablet and actual OBS audio-routing acceptance remain pending.

## Sound library and session recovery — September 13, 2026

- Offer 15 synthesized sounds plus Off for found, accepted, rejected, pack-complete and prize events, with Try buttons.
- Finish Pack replays saved cards; the next accepted card starts a fresh pack.
- Preserve one previous session per account and add Replay last session after refresh/restart.
- Keep archived recaps out of OBS responses and revoke the old link when a fresh pack begins.

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
