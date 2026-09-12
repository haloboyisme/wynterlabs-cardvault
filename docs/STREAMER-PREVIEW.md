# Streamer preview, sounds and pack recap

Available in V2.7.5. Open **Scan → Streamer preview** or **Account → Scan & stream**.
Changes to presentation settings must be saved; the preview lets you try a draft first.

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
Use master mute, volume, temporary mute, per-event sound/off choices and test buttons.
Select scanner or overlay audio output to avoid doubled sound. Browser autoplay rules
apply: enable audio with a click; use OBS Interact where necessary.

Prize pulls selects the highest enabled threshold reached by the displayed USD
**per-card** estimate: $5, $10, $20, $50 or $100. Quantity is not multiplied.
Each tier has an editable message, enable switch, jingle/off and visual effect
(none, confetti, sparks or burst). Disabling a tier falls back to a lower enabled
tier. Global celebration/particle switches and master mute remain available.
Unknown/non-USD prices do not trigger tiers. These are estimates, not guaranteed
sale proceeds. Celebrations also appear in recap export; reduced motion uses a
static badge. No custom sound upload or full 3D engine is included.

## Saved packs and private OBS links

Enable **Capture saved pulls** and save to collect confirmed cards and send previews
to OBS. Local found/accepted feedback also works with capture disabled.
Create/rotate the OBS link, then paste it into an OBS Browser Source. The link is a
private read-only bearer credential: anyone with it can see that presentation.
It expires after seven days. Disable, rotate or start a new pack to revoke it.
It grants no account editing or device control. Your OBS computer must reach the host.
Initial load/reconnect shows current content without replaying old celebrations.
Transparent live overlays are supported; check audio routing on your OBS computer.

**Finish Pack** freezes additions. Remove or highlight presentation pulls without
editing the collection. Duplicates and quantities are retained. Replay all cards or
highlights; save/export before starting a new pack, which clears the presentation
and revokes its link. Maximum 100 saved pulls per pack. Failed delivery can be retried
while the page remains open.

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
