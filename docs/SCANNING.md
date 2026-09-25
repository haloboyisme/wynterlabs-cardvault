# Scanning and failed-scan history

Available on `v2` after the v2.7.7 tag. Sign in and open **Scan**.

## Scan and confirm

Choose Single card or Multiple cards/session. Choose the game and preferred set;
scan preferences are remembered for the account in that browser. Use camera zoom
and framing controls, keep the card steady, and reduce glare. Difficult captures
can wait briefly for focus and retry deeper sideways/full-art recognition. Matching
checks either face of split, Room and double-faced names. No recognition method
is guaranteed for foil, promo or unusual artwork.

Review the card and exact printing before saving. Click a captured photo to open
a larger draggable view while correcting the title. Close it with X or Escape;
a successful save closes it too. Presentation animations never confirm a card or
move a feeder. Public automatic scanning uses the simulator; private DIY hardware
integration is not included in this repository.

## Review failures

Expand **Scan history · failed attempts** in any scanner workspace. The first
failure remains recorded even when a retry succeeds. History updates while open;
use **Refresh history** to request the latest records. Account members see only
their own records. Admins can enable **Admin: include all accounts**.

Each record has a random scan ID, mode, time, attempt count, outcome and short tags.
Outcomes are unresolved, recovered by retry, corrected manually or skipped.
Corrections to an already selected match can record `wrong_match`. Ambiguous
printings may be logged even when the card name is known, because the printing
still needs a choice. Successful first attempts do not create failure records.

Tags distinguish no recognized text, no catalog match, ambiguous printing,
wrong match, timeout and service errors. Blur, glare and darkness may be inferred
from capture quality; they are shown as **possible causes**, not diagnoses.
The schema also allows sideways/layout and unknown tags; it does not automatically
identify every physical cause or maintain a catalog of the failed card's identity.

## Privacy, retention and limits

No card photo, card name or recognized text is stored in this diagnostic log.
It retains up to 1,000 records per account for 90 days and displays the latest 100.
Expired records are hidden immediately and removed by hourly cleanup or subsequent
writes. Retries update the same scan ID; stale updates do not overwrite newer ones.
This does not change collections, saved packs or feeder controls.

Logging retries a failed delivery once while the page remains open. It is not an
offline queue; closing the page, a connection failure or signing out can leave an
attempt unrecorded. A warning appears when delivery fails. Historical scans from
before this feature was installed cannot be reconstructed. Logs help diagnose
future failures; physical card and prolonged phone/tablet tests remain necessary.

Upgrade through migration `0024_scan_failures` before using the updated API.
See [upgrade guidance](UPGRADING.md) and [remaining work](V3-ROADMAP.md).
