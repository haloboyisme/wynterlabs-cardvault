import {
  APPEARANCE_ACCENTS,
  accentTokens,
  parseCustomAccent,
  type AppearanceAccent,
} from "./appearance-colors";

export { APPEARANCE_ACCENTS, accentTokens } from "./appearance-colors";
export type { AppearanceAccent } from "./appearance-colors";

export const APPEARANCE_STORAGE_KEY = "wynterlabs.cards.appearance.v2";
export const LEGACY_APPEARANCE_STORAGE_KEY = "wynterlabs.cards.appearance.v1";

export const APPEARANCE_THEMES = [
  "system", "midnight", "frost", "light", "aurora", "amethyst", "ember", "forest",
  "sandstone", "slate",
] as const;
export const APPEARANCE_COMPLEXITIES = ["simple", "advanced"] as const;
export const APPEARANCE_DENSITIES = ["comfortable", "compact", "spacious"] as const;
export const APPEARANCE_TEXT_SCALES = ["standard", "large", "extra-large"] as const;
export const APPEARANCE_CONTRASTS = ["standard", "high"] as const;
export const APPEARANCE_MOTIONS = ["system", "reduced"] as const;

export type AppearanceTheme = (typeof APPEARANCE_THEMES)[number];
export type AppearanceComplexity = (typeof APPEARANCE_COMPLEXITIES)[number];
export type AppearanceDensity = (typeof APPEARANCE_DENSITIES)[number];
export type AppearanceTextScale = (typeof APPEARANCE_TEXT_SCALES)[number];
export type AppearanceContrast = (typeof APPEARANCE_CONTRASTS)[number];
export type AppearanceMotion = (typeof APPEARANCE_MOTIONS)[number];

export interface AppearancePreference {
  theme: AppearanceTheme;
  accent: AppearanceAccent | "custom";
  customAccent: string | null;
  complexity: AppearanceComplexity;
  density: AppearanceDensity;
  textScale: AppearanceTextScale;
  contrast: AppearanceContrast;
  motion: AppearanceMotion;
}

interface LegacyAppearancePreference {
  theme: AppearanceTheme;
  density: "comfortable" | "compact";
  motion: AppearanceMotion;
}

export const DEFAULT_APPEARANCE: AppearancePreference = Object.freeze({
  theme: "system",
  accent: "frost",
  customAccent: null,
  complexity: "simple",
  density: "comfortable",
  textScale: "standard",
  contrast: "standard",
  motion: "system",
});

let memoryAppearance: AppearancePreference = { ...DEFAULT_APPEARANCE };

function includes<T extends string>(choices: readonly T[], value: unknown): value is T {
  return typeof value === "string" && choices.includes(value as T);
}

function validPreference(value: unknown): value is AppearancePreference {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const validAccent = candidate.accent === "custom"
    ? parseCustomAccent(candidate.customAccent) !== null
    : includes(APPEARANCE_ACCENTS, candidate.accent) && candidate.customAccent === null;
  return includes(APPEARANCE_THEMES, candidate.theme)
    && validAccent
    && includes(APPEARANCE_COMPLEXITIES, candidate.complexity)
    && includes(APPEARANCE_DENSITIES, candidate.density)
    && includes(APPEARANCE_TEXT_SCALES, candidate.textScale)
    && includes(APPEARANCE_CONTRASTS, candidate.contrast)
    && includes(APPEARANCE_MOTIONS, candidate.motion);
}

function validLegacyPreference(value: unknown): value is LegacyAppearancePreference {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return includes(APPEARANCE_THEMES, candidate.theme)
    && includes(["comfortable", "compact"] as const, candidate.density)
    && includes(APPEARANCE_MOTIONS, candidate.motion);
}

function parseSaved(key: string): unknown {
  const saved = window.localStorage.getItem(key);
  return saved ? JSON.parse(saved) : null;
}

function migrateLegacy(legacy: LegacyAppearancePreference): AppearancePreference {
  return {
    ...DEFAULT_APPEARANCE,
    theme: legacy.theme,
    accent: legacy.theme === "frost" ? "frost" : DEFAULT_APPEARANCE.accent,
    density: legacy.density,
    motion: legacy.motion,
  };
}

export function readAppearance(): AppearancePreference {
  try {
    const current = parseSaved(APPEARANCE_STORAGE_KEY);
    if (validPreference(current)) {
      memoryAppearance = { ...current };
      return { ...memoryAppearance };
    }
    const legacy = parseSaved(LEGACY_APPEARANCE_STORAGE_KEY);
    if (validLegacyPreference(legacy)) {
      memoryAppearance = migrateLegacy(legacy);
      return { ...memoryAppearance };
    }
    memoryAppearance = { ...DEFAULT_APPEARANCE };
    return { ...memoryAppearance };
  } catch {
    return { ...memoryAppearance };
  }
}

export function writeAppearance(preference: AppearancePreference): boolean {
  if (!validPreference(preference)) return false;
  memoryAppearance = { ...preference };
  try {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(preference));
    return true;
  } catch {
    return false;
  }
}

function systemTheme(): "light" | "midnight" {
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "midnight";
  } catch {
    return "midnight";
  }
}

export function applyAppearance(preference: AppearancePreference): void {
  const root = document.documentElement;
  const theme = preference.theme === "system" ? systemTheme() : preference.theme;
  const tokens = accentTokens(preference.accent, preference.customAccent, theme);
  root.dataset.themeChoice = preference.theme;
  root.dataset.theme = theme;
  root.dataset.accent = preference.accent;
  root.dataset.complexity = preference.complexity;
  root.dataset.density = preference.density;
  root.dataset.textScale = preference.textScale;
  root.dataset.contrast = preference.contrast;
  root.dataset.motion = preference.motion;
  root.style.setProperty("--accent", tokens.accent);
  root.style.setProperty("--accent-link", tokens.link);
  root.style.setProperty("--accent-soft", tokens.soft);
  root.style.setProperty("--accent-soft-ink", tokens.softInk);
  root.style.setProperty("--accent-ink", tokens.ink);
}

export function resetAppearance(): AppearancePreference {
  memoryAppearance = { ...DEFAULT_APPEARANCE };
  try {
    window.localStorage.removeItem(APPEARANCE_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_APPEARANCE_STORAGE_KEY);
  } catch {
    // The in-memory default still applies when browser storage is unavailable.
  }
  const preference = { ...DEFAULT_APPEARANCE };
  applyAppearance(preference);
  return preference;
}

export function watchSystemTheme(): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia("(prefers-color-scheme: light)");
  const update = () => {
    const current = readAppearance();
    if (current.theme === "system") applyAppearance(current);
  };
  query.addEventListener?.("change", update);
  return () => query.removeEventListener?.("change", update);
}
