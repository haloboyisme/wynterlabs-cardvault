import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  COLLECTION_DISPLAY_STORAGE_KEY,
  DEFAULT_COLLECTION_DISPLAY,
  readCollectionDisplay,
  resetCollectionDisplay,
  writeCollectionDisplay,
} from "./collection-display";

beforeEach(() => {
  localStorage.clear();
  resetCollectionDisplay();
});

afterEach(() => {
  vi.restoreAllMocks();
});

it("round trips the complete allowed collection display preference", () => {
  const preference = {
    view: "list",
    size: "large",
    showSet: false,
    showLanguage: false,
    showTypeRarity: false,
    showPrices: false,
    animateDetails: false,
  } as const;

  expect(writeCollectionDisplay(preference)).toBe(true);
  expect(JSON.parse(localStorage.getItem(COLLECTION_DISPLAY_STORAGE_KEY) ?? "null")).toEqual(
    preference,
  );
  expect(readCollectionDisplay()).toEqual(preference);
});

it("falls back for malformed incomplete and unknown saved preferences", () => {
  for (const stored of [
    "not-json",
    JSON.stringify({ ...DEFAULT_COLLECTION_DISPLAY, view: "gallery" }),
    JSON.stringify({ view: "grid", size: "small" }),
    JSON.stringify({ ...DEFAULT_COLLECTION_DISPLAY, showPrices: "yes" }),
  ]) {
    localStorage.setItem(COLLECTION_DISPLAY_STORAGE_KEY, stored);
    expect(readCollectionDisplay()).toEqual(DEFAULT_COLLECTION_DISPLAY);
  }
});

it("retains the active choice in memory when browser storage is blocked", () => {
  const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
  const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
  const preference = {
    ...DEFAULT_COLLECTION_DISPLAY,
    view: "list",
    size: "small",
    animateDetails: false,
  } as const;

  expect(readCollectionDisplay()).toEqual(DEFAULT_COLLECTION_DISPLAY);
  expect(writeCollectionDisplay(preference)).toBe(false);
  expect(readCollectionDisplay()).toEqual(preference);

  getItem.mockRestore();
  setItem.mockRestore();
});

it("reset removes persisted state and restores exact defaults", () => {
  writeCollectionDisplay({
    ...DEFAULT_COLLECTION_DISPLAY,
    view: "list",
    showLanguage: false,
  });

  expect(resetCollectionDisplay()).toEqual(DEFAULT_COLLECTION_DISPLAY);
  expect(localStorage.getItem(COLLECTION_DISPLAY_STORAGE_KEY)).toBeNull();
  expect(readCollectionDisplay()).toEqual(DEFAULT_COLLECTION_DISPLAY);
});
