import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  APPEARANCE_STORAGE_KEY,
  LEGACY_APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  applyAppearance,
  readAppearance,
  resetAppearance,
  writeAppearance,
} from "./appearance";

const FROST_APPEARANCE = {
  theme: "frost",
  accent: "frost",
  customAccent: null,
  complexity: "simple",
  density: "compact",
  textScale: "standard",
  contrast: "standard",
  motion: "reduced",
} as const;

function media(matches: boolean): MediaQueryList {
  return {
    matches,
    media: "(prefers-color-scheme: light)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}

beforeEach(() => {
  localStorage.clear();
  resetAppearance();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-theme-choice");
  document.documentElement.removeAttribute("data-density");
  document.documentElement.removeAttribute("data-accent");
  document.documentElement.removeAttribute("data-complexity");
  document.documentElement.removeAttribute("data-text-scale");
  document.documentElement.removeAttribute("data-contrast");
  document.documentElement.removeAttribute("data-motion");
  vi.stubGlobal("matchMedia", vi.fn(() => media(false)));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("appearance storage", () => {
  it("round trips every expanded base mode", () => {
    for (const theme of ["aurora", "amethyst", "ember", "forest", "sandstone", "slate"] as const) {
      const preference = { ...FROST_APPEARANCE, theme };

      expect(writeAppearance(preference)).toBe(true);
      expect(readAppearance()).toEqual(preference);
    }
  });

  it("falls back when saved appearance is malformed or contains unknown choices", () => {
    for (const stored of [
      "not-json",
      JSON.stringify({ theme: "neon", density: "tiny", motion: "spin" }),
      JSON.stringify({ theme: "light", accent: "frost", density: "compact" }),
    ]) {
      localStorage.setItem(APPEARANCE_STORAGE_KEY, stored);
      expect(readAppearance()).toEqual({
        theme: "system",
        accent: "frost",
        customAccent: null,
        complexity: "simple",
        density: "comfortable",
        textScale: "standard",
        contrast: "standard",
        motion: "system",
      });
    }
  });

  it("round trips only a complete allowed preference", () => {
    const preference = FROST_APPEARANCE;

    expect(writeAppearance(preference)).toBe(true);
    expect(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? "null")).toEqual(preference);
    expect(readAppearance()).toEqual(preference);
  });

  it("migrates a valid v1 preference in memory without writing version 2", () => {
    localStorage.setItem(LEGACY_APPEARANCE_STORAGE_KEY, JSON.stringify({
      theme: "frost", density: "compact", motion: "reduced",
    }));

    expect(readAppearance()).toEqual(FROST_APPEARANCE);
    expect(localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBeNull();
  });

  it("keeps working when browser storage is unavailable", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(readAppearance()).toEqual(DEFAULT_APPEARANCE);
    const browserOnly = {
      theme: "light", accent: "frost", customAccent: null, complexity: "simple",
      density: "compact", textScale: "standard", contrast: "standard", motion: "reduced",
    } as const;
    expect(writeAppearance(browserOnly)).toBe(false);
    expect(readAppearance()).toEqual(browserOnly);

    getItem.mockRestore();
    setItem.mockRestore();
  });
});

describe("appearance application", () => {
  it("applies each expanded base mode as the resolved document theme", () => {
    for (const theme of ["aurora", "amethyst", "ember", "forest", "sandstone", "slate"] as const) {
      applyAppearance({ ...FROST_APPEARANCE, theme });

      expect(document.documentElement.dataset.themeChoice).toBe(theme);
      expect(document.documentElement.dataset.theme).toBe(theme);
    }
  });

  it("applies exact root attributes without a network request", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    applyAppearance(FROST_APPEARANCE);

    expect(document.documentElement.dataset.themeChoice).toBe("frost");
    expect(document.documentElement.dataset.theme).toBe("frost");
    expect(document.documentElement.dataset.accent).toBe("frost");
    expect(document.documentElement.dataset.complexity).toBe("simple");
    expect(document.documentElement.dataset.density).toBe("compact");
    expect(document.documentElement.dataset.textScale).toBe("standard");
    expect(document.documentElement.dataset.contrast).toBe("standard");
    expect(document.documentElement.dataset.motion).toBe("reduced");
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#5BE7E7");
    expect(document.documentElement.style.getPropertyValue("--accent-soft-ink")).toBe("#FFFFFF");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("resolves System from the current browser color preference", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => media(true)));
    applyAppearance(DEFAULT_APPEARANCE);
    expect(document.documentElement.dataset.themeChoice).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("light");

    vi.stubGlobal("matchMedia", vi.fn(() => media(false)));
    applyAppearance(DEFAULT_APPEARANCE);
    expect(document.documentElement.dataset.theme).toBe("midnight");
  });

  it("reset removes the saved value and reapplies safe defaults", () => {
    writeAppearance({
      theme: "light", accent: "frost", customAccent: null, complexity: "simple",
      density: "compact", textScale: "standard", contrast: "standard", motion: "reduced",
    });
    applyAppearance(readAppearance());

    resetAppearance();

    expect(localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.dataset.themeChoice).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("midnight");
    expect(document.documentElement.dataset.accent).toBe("frost");
    expect(document.documentElement.dataset.complexity).toBe("simple");
    expect(document.documentElement.dataset.density).toBe("comfortable");
    expect(document.documentElement.dataset.textScale).toBe("standard");
    expect(document.documentElement.dataset.contrast).toBe("standard");
    expect(document.documentElement.dataset.motion).toBe("system");
  });
});
