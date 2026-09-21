# Streamer preview, sounds and pack recap

Available in V2.7.5. Open **Scan → Streamer preview** or **Account → Scan & stream**.
Changes to presentation settings must be saved; the preview lets you try a draft first.

## Find your controls

Use **Look**, **Sounds**, and **Replay & OBS** to switch views without losing draft settings. Choose a visual preset, then save. Custom card backs and timing live under **More look options**. Individual sounds and prize thresholds expand separately. OBS setup and recap editing are in **Replay & OBS**. The sample preview is display-only and is never added to a pack.

## Look & feel

Choose Plain, Subtle or Streamer as a starting point. Seven reveals include instant,
fade, flip, slide, zoom, comic pop and tilt. Eight backgrounds include transparent,
green, blue, solid, blend, spotlight, neon grid and star dots. Four layouts cover
landscape, portrait, square and card-right landscape. Keep or hide card details,
change accent, scale, timing and glow, and choose a generic pack intro.
For flip reveals, upload a PNG/JPEG/WebP card back up to 256 KB; removing it restores
the built-in back. Use artwork you have permission to share.

## Sound and prize pulls

Found and accepted are different events: finding a printing previews it; a successful
collection save accepts it. Only accepted cards enter the pack. Repeated captures of
the same printing get fresh feedback; quantity edits do not repeat the found sound.
Use master mute, volume, temporary mute, per-event sound/off choices and Try buttons.
There are 15 original synthesized cues: Chime, Arcade, Fanfare, Bell, Bubbles, Radar,
Sparkle, Coin, Powerup, Victory, Error, Warning, Sonar, Twinkle and Drumroll, plus Off.
These choices also apply to prize tiers and exported recaps; no downloads are required.
Select scanner or overlay audio output to avoid doubled sound. Browser autoplay rules
apply in ordinary browsers. OBS attempts audio automatically and never shows an audio-enable button over your cards. Creating a link selects overlay audio while preserving saved mute.

Prize pulls selects the highest enabled threshold reached by the displayed USD
**per-card** estimate: $5, $10, $20, $50 or $100. Quantity is not multiplied.
Each tier has an editable message, enable switch, jingle/off and visual effect
(none, confetti, sparks or burst). Disabling a tier falls back to a lower enabled
tier. Global celebration/particle switches and master mute remain available.
Unknown/non-USD prices do not trigger tiers. These are estimates, not guaranteed
sale proceeds. Celebrations also appear in recap export; reduced motion uses a
static badge. No custom sound upload or full 3D engine is included.

## Saved packs and private OBS links

Enable **Add saved cards to my replay** and save to collect confirmed cards and send previews
to OBS. Local found/accepted feedback also works with capture disabled.
Create/rotate the OBS link, then paste it into an OBS Browser Source. The link is a
private read-only bearer credential: anyone with it can see that presentation.
It expires after seven days. Disable, rotate or start a new pack to revoke it.
It grants no account editing or device control. Your OBS computer must reach the host.
Initial load/reconnect shows current content without replaying old celebrations.
Transparent live overlays are supported; check audio routing on your OBS computer.

**Finish Pack & replay** completes the current session and automatically replays
its confirmed cards. Remove or highlight presentation pulls without editing the
collection. Duplicates and quantities are retained. The next accepted card starts
a fresh pack automatically; Start new pack also starts one explicitly.

**Replay last session** on Scan replays the previous saved session without changing
the current pack or collection. It survives page refreshes and browser restarts
because the cards are stored with the account. One previous session is kept, up
to 100 pulls; the next outgoing session replaces it. Repeated new-pack actions on
an empty pack preserve the last recap. Unsaved photos and undelivered browser-queue
events cannot be recovered. Capture saved pulls must be enabled.

Starting a fresh pack revokes the old OBS link; create a new link for the new pack.
Archived history is excluded from OBS responses. Last-session replay is local to
the signed-in scanner. Export videos you want to keep before moving on; downloaded
files are separate from the one-session recovery feature. Failed delivery can be
retried while the page remains open.

## Save a video

Recaps render locally with canvas/MediaRecorder, using supported WebM or MP4.
Keep the tab visible during export. Missing or blocked artwork gets a named
placeholder. Live transparency exports as a solid dark video, not alpha video.
Download and check playback before clearing the pack. Device/browser codec and
OBS audio support need checking on your own setup.

## Performance and privacy

Effects use bounded CSS particles rather than a 3D engine. Unchanged OBS polls
return an empty response; hidden tabs poll less often. Account-owned settings,
pack data and a bounded custom card back are stored on the installation.
The overlay exposes the selected presentation only. Never publish an OBS link.


## V2.7.7 update

See [V2.7.7 release notes](v2.7.7-release.md) for background uploads and static fallbacks, account/browser scope, motion speed and interface cues, larger recap export behavior and the exact OBS/device verification limits.
