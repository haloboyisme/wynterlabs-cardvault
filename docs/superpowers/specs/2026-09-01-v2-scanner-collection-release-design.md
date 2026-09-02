# V2 Scanner, Collection, and Release Closure Design

**Status:** Approved through the owner's combined-bundle approval and $32 hard cap.

## Goal

Close the remaining V2 scanner, collection, marketplace-handoff, and release-readiness gaps without replacing working components or adding commerce.

## Scope

- Preselect the only confident printing returned by scanner matching in both single-card and multi-card modes. Exact set and collector-number matches retain priority when several printings exist.
- Give screen-reader and sighted users concise feedback when matching begins, when one printing is preselected, when several printings require review, and when no confident result is found.
- Keep every current correction, filter, retake, confirmation, multi-session, camera, privacy, and reduced-motion behavior.
- Add a game-level collection breakdown derived from the existing set summary. No database or API change is needed.
- Put the existing exact-printing TCGplayer/eBay research links in expanded saved-card details as well as card details. Links remain outbound searches and never create sales, payments, shipping, messaging, or marketplace accounts.
- Update V2 documentation and release evidence, audit public source for secrets and personal data, verify the one-command Docker workflow, create and restore-test a fresh live backup, and run one consolidated release gate.

## Reuse and boundaries

- Reuse `printing-match.ts`, `marketplace.ts`, `CollectionSummary.sets`, responsive scanner grids, value-history chart, standalone installer, operational backup scripts, and current test suites.
- Do not add a schema migration, data provider, OAuth provider, payment integration, transaction storage, member-to-member trading, or hardware transport.
- Scanner photos remain transient and every selected printing still requires user confirmation.
- Public V2 push and release tag occur only after the owner reviews the private live deployment.

## Verification

- Focused red/green scanner, collection, and marketplace tests during implementation.
- One consolidated web/API/document/Compose verification after all edits.
- Fresh CT 102 backup, checksum validation, isolated restore, readiness check, and public-source secret/personal-data audit.
