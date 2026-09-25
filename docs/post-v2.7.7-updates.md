# Updates after v2.7.7

## Scanner diagnostics and navigation protection — September 25, 2026

- Confirm with OK/Cancel before a normal page-link click leaves an active camera or unfinished scan. Cancel preserves the workspace; native browser warnings cover refresh/close where supported. This does not add session recovery or an in-app browser Back interceptor.
- Give ambiguous camera matches one deeper printing read, preserving review choices if it cannot identify a unique printing. Exact-printing confirmation remains required.
- Add stable SCAN error codes plus original/latest catalog suggestions and successfully saved card/finish snapshots. Distinguish an interface-default finish from user-confirmed foil/nonfoil; the camera does not detect foil automatically.
- Add migration `0025_scan_diagnostics`. Previous records retain their tags but cannot reconstruct missing card identities. No photos or raw OCR text are retained. Existing account/admin access and retention remain.
- Public automatic scanning remains simulation-only. Existing release tags are unchanged; real-card success-rate and endurance acceptance remain separate.

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

The public automatic scanner remains simulation-only. Private hardware agents, firmware, host configuration and deployment records are excluded.

Validation: public-source frontend and OCR results are recorded in the publishing checklist. Real-world camera and OBS acceptance limits in the v2.7.7 release notes still apply.
