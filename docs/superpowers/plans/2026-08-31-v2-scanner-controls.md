# V2 Scanner Controls Implementation Plan

**Status:** Completed and verified on 2026-08-31.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a simple multiple-card capture countdown and clearer simulation-only DIY scanner tuning within the approved $6 increment.

**Architecture:** Keep all new preferences browser-local and reuse `CardScanner`, `AutoScannerSettings`, and the simulated controller. A small multiple-scan settings module owns the countdown preference; the DIY panel exposes existing validated fields and a non-hardware safety check.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, browser localStorage.

**Spec:** `docs/superpowers/specs/2026-08-31-v2-linked-signin-scanner-controls-design.md`

## Global Constraints

- Do not add provider-login implementation in this increment.
- Do not connect to, energize, or issue commands to real hardware.
- Keep scanner photos and settings within their existing privacy boundaries.
- Use integer countdown values from 1 through 10 seconds with a five-second default.
- Run one focused verification group and one production build at the end.

---

### Task 1: Browser-local multiple-scan countdown

**Files:**
- Create: `web/src/scanner/multi-scan-settings.ts`
- Create: `web/src/scanner/multi-scan-settings.test.ts`
- Modify: `web/src/components/CardScanner.tsx`
- Modify: `web/src/components/MultiScanSession.tsx`
- Modify: `web/src/components/MultiScanSession.test.tsx`

**Interfaces:**
- Produces: `readMultiScanCountdownSeconds(): number`, `writeMultiScanCountdownSeconds(value: number): number`, and `automaticCountdownSeconds?: number` on `CardScanner`.
- Consumes: browser localStorage and the existing stable-frame auto-capture cycle.

- [ ] **Step 1: Write failing storage and component tests**

Assert a five-second default, recovery from malformed/out-of-range storage, 1-10 clamping, a labeled control, persistence, and propagation to `CardScanner`.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `node node_modules/vitest/vitest.mjs run src/scanner/multi-scan-settings.test.ts src/components/MultiScanSession.test.tsx`

- [ ] **Step 3: Implement the preference and countdown prop**

Create a versioned key, clamp integer values to 1-10, initialize `MultiScanSession` from it, persist changes, and replace the hard-coded `setAutoCountdown(5)` with the prop value.

- [ ] **Step 4: Rerun the focused tests and commit**

Expected: both focused files pass.

### Task 2: DIY quick tuning and safety check

**Files:**
- Modify: `web/src/components/AutoScannerControllerPanel.tsx`
- Modify: `web/src/components/AutoScannerControllerPanel.test.tsx`

**Interfaces:**
- Consumes: `AUTO_SCANNER_LIMITS`, `validateAutoScannerSettings`, and `writeAutoScannerSettings`.
- Produces: bounded acceleration, recognition-timeout, and retry controls plus a simulation-only profile-validation result.

- [ ] **Step 1: Write failing component tests**

Assert the three added controls expose existing bounds, save through the established local profile, and **Run safety check** reports ready or explains invalid settings without invoking controller movement.

- [ ] **Step 2: Run the component test and confirm failure**

Run: `node node_modules/vitest/vitest.mjs run src/components/AutoScannerControllerPanel.test.tsx`

- [ ] **Step 3: Implement the reused controls and safety feedback**

Extend `QuickSetting`, render the inputs, validate `settingsRef.current`, and display accessible success/warning/error feedback. Do not add a hardware transport.

- [ ] **Step 4: Rerun the component test and commit**

Expected: the focused component file passes, including existing emergency-stop tests.

### Task 3: Documentation and final verification

**Files:**
- Modify: `README.md`
- Modify: `docs/platform/current-state.md`
- Modify: `docs/AUTO-SCANNER-PRIVATE-TEST.md`

**Interfaces:**
- Consumes: completed Tasks 1 and 2.
- Produces: accurate V2 behavior and deferred Google/Apple roadmap documentation.

- [ ] **Step 1: Update user and testing documentation**

Document the multiple-card countdown, DIY safety check, simulation-only boundary, and linked-sign-in stages.

- [ ] **Step 2: Run the single final verification group**

Run the new settings test, MultiScanSession test, AutoScannerControllerPanel test, TypeScript `--noEmit`, and one Vite production build.

- [ ] **Step 3: Inspect the diff and commit**

Require `git diff --check` and ensure no provider credentials, hardware transport, or unrelated files are present.
