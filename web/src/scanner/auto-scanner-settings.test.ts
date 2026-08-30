import { beforeEach, expect, it } from "vitest";
import {
  AUTO_SCANNER_STORAGE_KEY,
  DEFAULT_AUTO_SCANNER_SETTINGS,
  consumeAutoScannerSettingsRecovery,
  readAutoScannerSettings,
  readAutoScannerSettingsWithRecovery,
  resetAutoScannerSettings,
  validateAutoScannerSettings,
  writeAutoScannerSettings,
} from "./auto-scanner-settings";

beforeEach(() => localStorage.clear());

it("uses safe simulation defaults when no profile is saved", () => {
  expect(readAutoScannerSettings()).toEqual(DEFAULT_AUTO_SCANNER_SETTINGS);
});

it("removes corrupt saved settings and reports recovery metadata", () => {
  localStorage.setItem(AUTO_SCANNER_STORAGE_KEY, "not-json");

  expect(readAutoScannerSettingsWithRecovery()).toEqual({
    settings: DEFAULT_AUTO_SCANNER_SETTINGS,
    recovered: true,
  });
  expect(localStorage.getItem(AUTO_SCANNER_STORAGE_KEY)).toBeNull();
  expect(readAutoScannerSettings()).toEqual(DEFAULT_AUTO_SCANNER_SETTINGS);
});

it("removes unsupported or invalid saved profiles and reports recovery metadata", () => {
  localStorage.setItem(AUTO_SCANNER_STORAGE_KEY, JSON.stringify({
    ...DEFAULT_AUTO_SCANNER_SETTINGS,
    version: 2,
  }));

  expect(readAutoScannerSettingsWithRecovery()).toEqual({
    settings: DEFAULT_AUTO_SCANNER_SETTINGS,
    recovered: true,
  });
  expect(localStorage.getItem(AUTO_SCANNER_STORAGE_KEY)).toBeNull();

  localStorage.setItem(AUTO_SCANNER_STORAGE_KEY, JSON.stringify({
    ...DEFAULT_AUTO_SCANNER_SETTINGS,
    speedPercent: 101,
  }));
  expect(readAutoScannerSettingsWithRecovery()).toEqual({
    settings: DEFAULT_AUTO_SCANNER_SETTINGS,
    recovered: true,
  });
  expect(localStorage.getItem(AUTO_SCANNER_STORAGE_KEY)).toBeNull();
});

it("retains recovery metadata after a settings-only read until Account consumes it", () => {
  localStorage.setItem(AUTO_SCANNER_STORAGE_KEY, "not-json");

  expect(readAutoScannerSettings()).toEqual(DEFAULT_AUTO_SCANNER_SETTINGS);
  expect(readAutoScannerSettingsWithRecovery()).toEqual({
    settings: DEFAULT_AUTO_SCANNER_SETTINGS,
    recovered: true,
  });
  expect(consumeAutoScannerSettingsRecovery()).toBe(true);
  expect(readAutoScannerSettingsWithRecovery().recovered).toBe(false);
});

it("rejects duplicate required pins", () => {
  const result = validateAutoScannerSettings({
    ...DEFAULT_AUTO_SCANNER_SETTINGS,
    pins: { ...DEFAULT_AUTO_SCANNER_SETTINGS.pins, direction: 18 },
  });
  expect(result.errors.pins).toMatch(/STEP and DIR/i);
});

it("rejects motor and timing values outside hard limits", () => {
  const result = validateAutoScannerSettings({
    ...DEFAULT_AUTO_SCANNER_SETTINGS,
    speedPercent: 101,
    countdownSeconds: 0,
    settleDelayMs: 10001,
  });
  expect(result.errors.speedPercent).toMatch(/1.*100/);
  expect(result.errors.countdownSeconds).toMatch(/1.*10/);
  expect(result.errors.settleDelayMs).toMatch(/250.*10000/);
});

it("saves and reads one valid versioned profile", () => {
  const next = { ...DEFAULT_AUTO_SCANNER_SETTINGS, profileName: "Deck feeder" };
  expect(writeAutoScannerSettings(next)).toEqual({ ok: true, settings: next });
  expect(readAutoScannerSettings()).toEqual(next);
});

it("warns when pins are outside the selected board range", () => {
  const result = validateAutoScannerSettings({
    ...DEFAULT_AUTO_SCANNER_SETTINGS,
    board: "arduino_uno",
    pins: { ...DEFAULT_AUTO_SCANNER_SETTINGS.pins, homeSensor: 32 },
  });
  expect(result.ok).toBe(true);
  expect(result.warnings.join(" ")).toMatch(/homeSensor.*arduino_uno/i);
});

it("limits profile names to forty printable characters and warns above Arduino Uno pin 19", () => {
  expect(validateAutoScannerSettings({
    ...DEFAULT_AUTO_SCANNER_SETTINGS,
    profileName: "A".repeat(41),
  }).errors.profileName).toMatch(/1-40/);
  expect(validateAutoScannerSettings({
    ...DEFAULT_AUTO_SCANNER_SETTINGS,
    board: "arduino_uno",
    pins: { ...DEFAULT_AUTO_SCANNER_SETTINGS.pins, homeSensor: 20 },
  }).warnings.join(" ")).toMatch(/0-19/);
});

it("rejects negative, fractional, and generic pins above 255", () => {
  expect(validateAutoScannerSettings({ ...DEFAULT_AUTO_SCANNER_SETTINGS, pins: { ...DEFAULT_AUTO_SCANNER_SETTINGS.pins, step: -1 } }).errors.pins).toMatch(/non-negative/i);
  expect(validateAutoScannerSettings({ ...DEFAULT_AUTO_SCANNER_SETTINGS, pins: { ...DEFAULT_AUTO_SCANNER_SETTINGS.pins, step: 1.5 } }).errors.pins).toMatch(/integer/i);
  expect(validateAutoScannerSettings({ ...DEFAULT_AUTO_SCANNER_SETTINGS, board: "generic", pins: { ...DEFAULT_AUTO_SCANNER_SETTINGS.pins, step: 256 } }).errors.pins).toMatch(/255/i);
});

it("resets storage and returns an isolated default", () => {
  writeAutoScannerSettings({ ...DEFAULT_AUTO_SCANNER_SETTINGS, profileName: "Saved" });
  const reset = resetAutoScannerSettings();
  reset.pins.step = 99;
  expect(readAutoScannerSettings()).toEqual(DEFAULT_AUTO_SCANNER_SETTINGS);
});

it("does not persist unknown sensitive-looking fields", () => {
  const unsafe = {
    ...DEFAULT_AUTO_SCANNER_SETTINGS,
    credentials: "secret-token",
    photo: "data:image/png;base64,secret",
    recognitionResult: { confidence: 1 },
    pins: { ...DEFAULT_AUTO_SCANNER_SETTINGS.pins, injected: "secret" },
  } as typeof DEFAULT_AUTO_SCANNER_SETTINGS & Record<string, unknown>;

  expect(writeAutoScannerSettings(unsafe)).toEqual({
    ok: true,
    settings: DEFAULT_AUTO_SCANNER_SETTINGS,
  });
  expect(localStorage.getItem(AUTO_SCANNER_STORAGE_KEY)).not.toContain("secret");
  expect(readAutoScannerSettings()).toEqual(DEFAULT_AUTO_SCANNER_SETTINGS);
});
