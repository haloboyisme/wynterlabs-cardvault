# V2 Scanner, Collection, and Release Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish V2 scanner preselection and feedback, collection statistics and marketplace handoff, then close release verification on the live private installation.

**Architecture:** Extend existing pure matching and marketplace helpers and consume them from the current scanner and collection pages. Preserve the current API, database, privacy boundaries, responsive layouts, Docker workflow, and owner-controlled live-first release process.

**Tech Stack:** React 19, TypeScript 5.9, Vitest, FastAPI, PostgreSQL, Docker Compose, Bash deployment and recovery tooling.

**Spec:** `docs/superpowers/specs/2026-09-01-v2-scanner-collection-release-design.md`

## Global Constraints

- Hard cap: $32 of Codex usage.
- Reuse existing components, tests, scripts, and documentation.
- Run focused red/green tests while editing and one consolidated release gate at the end.
- Do not add internal marketplace transactions, payments, messages, OAuth providers, card-data providers, schema migrations, or hardware transport.
- Do not push or tag public V2 until the owner reviews the private live result.

---

### Task 1: Reliable scanner recommendation and feedback

**Files:**
- Modify: `web/src/scanner/printing-match.ts`
- Modify: `web/src/scanner/printing-match.test.ts`
- Modify: `web/src/pages/ScannerPage.tsx`
- Modify: `web/src/pages/ScannerPage.test.tsx`
- Modify: `web/src/components/MultiScanSession.tsx`
- Modify: `web/src/components/MultiScanSession.test.tsx`

**Interfaces:**
- Produces: `recommendedDetectedPrintingId(candidates, hints, preferredSet?, preferredGame?) => string`
- Preserves: exact set/collector-number priority, explicit confirmation, correction filters, retake, and retry.

- [ ] Write failing pure-helper and UI tests proving one confident result is preselected in both scanner modes and match feedback is announced.
- [ ] Run the focused tests and confirm failures are caused by the missing fallback/feedback.
- [ ] Implement the minimum helper and status-copy changes.
- [ ] Run the focused tests and confirm they pass.

### Task 2: Collection game statistics and exact-printing research links

**Files:**
- Modify: `web/src/pages/CollectionPage.tsx`
- Modify: `web/src/pages/CollectionPage.test.tsx`
- Reuse: `web/src/lib/marketplace.ts`

**Interfaces:**
- Consumes: `CollectionSummary.sets`, `marketplaceLinksForCard()`.
- Produces: an accessible game-level copy count and safe outbound exact-printing searches from expanded saved-card details.

- [ ] Write failing tests for grouped game totals and exact-printing marketplace links in saved-card details.
- [ ] Run the focused tests and confirm the expected failures.
- [ ] Implement client-side game aggregation and render the existing marketplace links.
- [ ] Run the focused tests and confirm they pass.

### Task 3: Documentation and public-source audit

**Files:**
- Modify: `README.md`
- Modify: `docs/INSTALL.md`
- Modify: `docs/GITHUB-PUBLISHING-CHECKLIST.md`
- Create: `docs/v2-release-readiness.md`

**Interfaces:**
- Produces: current V2 scope, explicit non-commerce boundary, installer/recovery checklist, and sanitized release evidence.

- [ ] Update the roadmap to distinguish completed scanner/collection/marketplace work from deferred account providers, community activity, hardware, and V3 work.
- [ ] Record the live-first release sequence and one-command installation/recovery checks.
- [ ] Audit tracked public files for private usernames, personal email addresses, passwords, private IPs, secrets, backup archives, and private keys; record only sanitized results.

### Task 4: Live deployment and consolidated release gate

**Files:**
- Reuse live operational scripts under `/opt/wynterlabs/cards-platform/deploy`.

**Interfaces:**
- Produces: rollback point, fresh verified backup, live deployment, isolated restore evidence, readiness evidence, and an owner-reviewable V2 candidate.

- [ ] Review the complete diff and confirm no secret, provider, schema, or commerce changes.
- [ ] Create and checksum a fresh predeployment CT 102 backup and run the isolated restore verifier.
- [ ] Deploy privately using the existing rollback-capable workflow.
- [ ] Run one consolidated API/web/type/build/document/Compose/security/readiness gate.
- [ ] Create a fresh postdeployment backup and verify its isolated restore and encrypted off-host copy.
- [ ] Stop for owner live review before pushing or tagging public V2.

### Task 5: Public V2 release after owner review

**Files:**
- Modify only release metadata required by the approved V2 version/tag.

**Interfaces:**
- Produces: sanitized GitHub V2 commit and immutable V2 release tag.

- [ ] Incorporate only owner-requested live-review corrections, if any.
- [ ] Re-run the smallest verification that covers any correction.
- [ ] Push the reviewed V2 commit to GitHub.
- [ ] Create and verify the V2 release tag.
