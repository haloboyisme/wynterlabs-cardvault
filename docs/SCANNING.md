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
identify every physical cause.

## Privacy, retention and limits

Catalog card names, printing IDs, sets, collector numbers, languages and finishes
are stored for the original/latest suggestions and the accepted card. No photos
or raw OCR text are stored. Accepted means the collection save succeeded.
It retains up to 1,000 records per account for 90 days and displays the latest 100.
Expired records are hidden immediately and removed by hourly cleanup or subsequent
writes. Retries update the same scan ID; stale updates do not overwrite newer ones.
This does not change collections, saved packs or feeder controls.

Logging retries a failed delivery once while the page remains open. It is not an
offline queue; closing the page, a connection failure or signing out can leave an
attempt unrecorded. A warning appears when delivery fails. Historical scans from
before this feature was installed cannot be reconstructed. Logs help diagnose
future failures; physical card and prolonged phone/tablet tests remain necessary.

Upgrade through migration `0025_scan_diagnostics` before using the updated API.
See [upgrade guidance](UPGRADING.md) and [remaining work](V3-ROADMAP.md).


## Error codes and comparisons

- SCAN-001: no readable text; SCAN-002: no catalog match.
- SCAN-003: printing choice needed; SCAN-004: corrected suggested card/printing.
- SCAN-005: changed default finish; SCAN-006: timeout; SCAN-007: recognition/service error.
- SCAN-099: unknown cause.

History displays **Scanner suggested** and **Actually saved**. An ambiguous first
candidate is not a confident scanner selection. The suggested finish is an interface
default, not a camera foil measurement. Accepted finishes reflect the user's save.
Older entries display Not recorded for absent details. Corrections are diagnostic
evidence, not automatic model training. Ambiguous camera matches now receive one
deeper read before a manual choice; unresolved choices remain available.

## Leaving a scan

Clicking a page link during an active camera or unfinished card asks for OK to
leave or Cancel to keep scanning. Saved collection cards remain safe. Opening a
new tab or using a same-page anchor does not discard the scanner. Refresh/close
uses the browser's standard warning where supported; its wording is browser-owned.
In-app browser Back and programmatic navigation are not intercepted by this link
warning. Keep reviewing before leaving; this feature does not restore lost photos.
