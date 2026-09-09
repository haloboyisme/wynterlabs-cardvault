# Version 3 roadmap

Version 2.5 is the completed self-hosted collection release. Version 3 remains
experimental and will be developed in small, privately tested stages. These are
directions, not promised dates or permanent maintenance commitments.

| Version | Status | Focus |
|---|---|---|
| V2.5.9 | Released | Collection and scanning release with Custom Card Import |
| V2.6 | Planned | Remember the last selected scan set when navigating between pages |
| V3.2 | Planned | Streamer previews, optional feedback, OBS overlays and pack-recap videos |
| V3.5 | Deferred | Bluetooth feeders for iPhone, Android and computers, subject to compatibility |

The stages below describe work areas, not minor-version numbers.

## V2.6: remember the selected scan set

- Keep the last set selected in the scanner when moving to another page and back.
- Restore the selection for the current user and card game; do not mix selections between accounts or games.
- Let the user change or clear the remembered set, and handle removed sets gracefully.
- Planned for V2.6; not included in V2.5.9.

## Stage 1: Custom Card Import — delivered in V2.5.9

- A simple account-private form for cards without a dependable catalog is now available.
- Require a name and game or category; keep image, set, number and value optional.
- Clearly label custom records so they cannot be mistaken for provider data.
- Include custom cards in collections, decks, imports, exports and backups.

## Stage 2: scanner workshop

- Improve sideways and split-room recognition without weakening normal scans.
- Keep title, set and collector-number correction available for every game.
- Prototype the existing DIY scanner controls on the private installation only.
- Add safe limits, stop controls and dry-run feedback before attaching motors.
- Document USB-C power separation and never power motors directly from a controller pin.

## Stage 3: solo tabletop practice

- Begin with one camera and an alignment overlay for Magic and Pokemon.
- Let the member select a saved deck; do not attempt automatic rules enforcement.
- Add optional second-camera recognition only after the basic layout is usable.
- Keep video local/private and show clear camera and retention controls.

## V3.2: streamer previews, feedback and pack recap

Planned scope; implementation has not started. Add optional presentation tools
for collectors, YouTube creators and streamers while retaining plain scanning.

- Choose instant appearance, fade-in or card-back-to-front flip directly in the preview.
- Preserve existing card details with configurable styling, visibility and layout.
- Offer optional pack-opening effects and 3D-style presentation with a lightweight fallback.
- Configure confirmation/rejection sounds, individual effects and volume; provide
  account-page master mute plus a convenient preview mute.
- Save preferences per user with Plain, Subtle and Streamer presets.
- Provide a clean pop-out and a revocable, read-only OBS Browser Source URL for
  the user's selected session, with transparent, green, blue or solid backgrounds.
- Finish Pack produces a replayable recap of confirmed pulls; target downloadable
  video as well as OBS recording, with export compatibility validated during design.
- Keep overlay viewing separate from feeder control and avoid duplicate audio or
  celebration replay after reconnects.

See the [V3.2 streamer preview proposal](V3.2-STREAMER-PREVIEW.md) for scope,
recap ideas, ownership boundaries and validation requirements.

## V3.5: Bluetooth feeder connections

Deferred until V3.5. Target iPhone, Android and computers, subject to an explicit
platform/browser compatibility assessment; do not assume direct browser Bluetooth
works everywhere. Evaluate a companion application or bridge where needed.

- Keep Wi-Fi as the initial feeder transport.
- Pair each feeder to an individual CardVault account; enforce ownership for all
  commands and allow only one active scanning session per feeder.
- Preserve those ownership and session boundaries when adding Bluetooth.
- Provide device rename, disconnect and revoke controls; reconnects must not
  repeat motor commands or automatically resume unsafe movement.
- Treat Bluetooth pairing and CardVault account authorization as distinct checks.

These version targets supplement the stages above; they do not renumber or
remove custom collectibles, recognition improvements or solo tabletop practice.

## Later experiments

- Consider multiplayer only after identity, moderation, privacy and network safety review.
- Add new catalog providers only when their data source and image terms are suitable.
- Revisit advanced database or clustering options only if real installations need them.

## Promotion rule

Every V3 stage is tested first on the private CardVault installation. Public V3
branches or releases are updated only after owner acceptance. The immutable
V2.5.2 tag remains the stable fallback throughout experimentation.
