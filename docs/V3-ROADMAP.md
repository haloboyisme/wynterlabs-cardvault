# CardVault roadmap — remaining work

Updated September 12, 2026. This is the outstanding product backlog, reconciled
with the original Card Scanner Project and verified implementation records. Version
labels describe targets, not promised dates. V2.6 remembered scan preferences are
included in the public V2.6.0 release; physical V2.8 acceptance remains pending.

Completed work has been removed from this backlog: V2.6 remembered scan game/set
(per account and game on the current browser), Custom Card Import, daily
card-price comparisons, the collection-wide sales-based value, interactive
dashboard history, basic sideways OCR retry, Hardware Lab simulation, multi-board
firmware support, the existing Home activity feed, and Docker installation and
recovery. Their release records remain historical evidence.

| Target | Status | Remaining outcome |
|---|---|---|
| V2.7.5 | Real-card acceptance pending | Validate difficult cards and long sessions after the matching/recovery improvements |
| V2.7.5 follow-up | Device checks pending | Verify OBS desktop audio routing and longer camera sessions |
| V2.8 | Physical testing pending | Connect and validate the real feeder using the existing Hardware Lab |
| V3 | Planned | Magic/Pokémon solo tabletop practice and saved-deck support |
| V3.5 | Deferred | Account-owned wireless feeders and Bluetooth compatibility |
| Later V3+ | Exploratory | Assisted gameplay tracking, friend/tournament displays and expanded community |

## V2.7.5 — real-card scanner acceptance

Basic sideways OCR retry and manual correction already exist. Version 2.6 updates
add either-half split-card matching, explicit selection for ambiguous printings,
45-second search recovery with retained photos, and foil/promo/long-session guidance.
Automated checks pass; physical card/camera acceptance remains outstanding.

- Test difficult sideways/split-room, double-faced, foil and promo cards.
- Improve ambiguous printing selection and title/set/collector-number matching
  where real scans still fail; preserve manual correction.
- Refine phone/tablet feedback and long multi-card sessions based on observed issues.
- Validate improvements against ordinary scans to avoid regressions.

## Completed in V2.7.5

Streamer reveals, layouts, backgrounds, custom card backs, sound controls, prize
celebrations, revocable OBS links, pack recap and local video export are delivered.
Refreshed Account/Admin/Home/Dashboard layouts, 42 Base Modes, low-power dynamic
themes and shared Brand Studio controls are also included. These are no longer
backlog items. See the [release notes](v2.7.5-release.md) and
[streamer guide](STREAMER-PREVIEW.md). Real OBS audio routing remains a device check.

## V2.8 — complete real feeder testing

The website controls, simulation, board profiles and firmware foundation are
already built in the private prototype, which is excluded from this public release.
The remaining work is physical acceptance and subsequent public-release review.

- Confirm the selected board, driver, motor and power arrangement match the firmware.
- Complete the physical feeder/camera mount and card path; calibrate feed,
  positioning and ejection without damaging cards.
- Connect the real device through the existing integration and verify scan/movement
  timing, pause, emergency stop, disconnects, reconnects and fault recovery.
- Update the setup guide with the tested configuration and remaining limitations.
- Keep simulation available. Physical acceptance remains pending; software tests
  alone do not prove that a real mechanism works.

## V3 — solo tabletop practice

- Begin with one camera and Magic/Pokémon alignment layouts for the play surface.
- Add clear camera start/stop controls and keep video private by default.
- Let the user select an existing saved deck and view deck lists, zones, counters
  and turn notes without silently modifying the deck.
- Start with assisted practice; automatic rules enforcement is outside this stage.

## V3.5 — wireless ownership and Bluetooth

- Build on the existing device integration for account-owned Wi-Fi feeder sessions.
- Enforce device ownership, one active controlling session, rename, disconnect and
  revoke controls; reconnects must not repeat motor commands.
- Add Bluetooth only after checking browser/device support on iPhone, Android and
  computers; use a companion or bridge where direct browser support is unsuitable.
- Distinguish Bluetooth pairing from permission to control a device in CardVault.

## Later V3+ — gameplay, displays and broader compatibility

These are future directions, not completed features or fully specified releases.

- Assisted card tracking through deliberate scans or an optional second camera.
- Friend/tournament displays, TV/YouTube presentation and companion-tablet views.
- Expanded community beyond the existing activity feed; multiplayer after solo play
  is usable and identity, privacy and moderation requirements are designed.
- Easier supported setup on Raspberry Pi, computers and custom scanner hardware,
  reusing Docker. Phones/tablets can be clients; do not assume they run Docker.
- Evaluate additional catalog coverage and infrastructure only when a supported
  data source or demonstrated installation need justifies the work.

## Delivery and release boundaries

Work is tested on a private installation before owner-approved public publication.
Physical device testing, multiplayer, external access and paid services require
separate setup and review. The experimental Hardware Lab and board firmware are
not included in this public release. Use existing code and supported free data
sources where practical. Missing prices stay visibly unavailable.
