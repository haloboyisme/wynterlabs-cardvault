import { beforeEach, expect, it } from "vitest";

import {
  MULTI_SCAN_COUNTDOWN_STORAGE_KEY,
  readMultiScanCountdownSeconds,
  writeMultiScanCountdownSeconds,
} from "./multi-scan-settings";

beforeEach(() => localStorage.clear());

it("defaults to the existing five-second capture countdown", () => {
  expect(readMultiScanCountdownSeconds()).toBe(5);
});

it("stores an integer countdown between one and ten seconds", () => {
  expect(writeMultiScanCountdownSeconds(0)).toBe(1);
  expect(writeMultiScanCountdownSeconds(12)).toBe(10);
  expect(writeMultiScanCountdownSeconds(7.6)).toBe(8);
  expect(localStorage.getItem(MULTI_SCAN_COUNTDOWN_STORAGE_KEY)).toBe("8");
});

it("recovers malformed browser storage to five seconds", () => {
  localStorage.setItem(MULTI_SCAN_COUNTDOWN_STORAGE_KEY, "not-a-number");
  expect(readMultiScanCountdownSeconds()).toBe(5);
  expect(localStorage.getItem(MULTI_SCAN_COUNTDOWN_STORAGE_KEY)).toBeNull();
});
