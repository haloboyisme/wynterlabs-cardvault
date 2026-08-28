import { beforeEach, expect, it } from "vitest";

import {
  CAPTURE_SHORTCUT_STORAGE_KEY,
  DEFAULT_CAPTURE_SHORTCUT,
  captureShortcutLabel,
  readCaptureShortcut,
  writeCaptureShortcut,
} from "./capture-shortcut";

beforeEach(() => localStorage.clear());

it("uses Space as the browser-local default", () => {
  expect(readCaptureShortcut()).toBe(DEFAULT_CAPTURE_SHORTCUT);
  expect(captureShortcutLabel(DEFAULT_CAPTURE_SHORTCUT)).toBe("Space");
});

it("round trips a user-selected physical key", () => {
  expect(writeCaptureShortcut("KeyK")).toBe(true);
  expect(localStorage.getItem(CAPTURE_SHORTCUT_STORAGE_KEY)).toBe("KeyK");
  expect(readCaptureShortcut()).toBe("KeyK");
  expect(captureShortcutLabel("KeyK")).toBe("K");
});

it("rejects modifier-only and browser-navigation keys", () => {
  expect(writeCaptureShortcut("ShiftLeft")).toBe(false);
  expect(writeCaptureShortcut("Tab")).toBe(false);
  expect(writeCaptureShortcut("Escape")).toBe(false);
  expect(readCaptureShortcut()).toBe(DEFAULT_CAPTURE_SHORTCUT);
});

it("falls back safely when saved data is invalid", () => {
  localStorage.setItem(CAPTURE_SHORTCUT_STORAGE_KEY, "NotARealKey");
  expect(readCaptureShortcut()).toBe(DEFAULT_CAPTURE_SHORTCUT);
});
