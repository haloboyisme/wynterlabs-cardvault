export const COLLECTION_DISPLAY_STORAGE_KEY = "wynterlabs.cards.collection-display.v1";

export const COLLECTION_VIEWS = ["grid", "list"] as const;
export const COLLECTION_CARD_SIZES = ["small", "medium", "large"] as const;

export type CollectionView = (typeof COLLECTION_VIEWS)[number];
export type CollectionCardSize = (typeof COLLECTION_CARD_SIZES)[number];

export interface CollectionDisplayPreference {
  view: CollectionView;
  size: CollectionCardSize;
  showSet: boolean;
  showLanguage: boolean;
  showTypeRarity: boolean;
  showPrices: boolean;
  animateDetails: boolean;
}

export const DEFAULT_COLLECTION_DISPLAY: CollectionDisplayPreference = Object.freeze({
  view: "grid",
  size: "medium",
  showSet: true,
  showLanguage: true,
  showTypeRarity: true,
  showPrices: true,
  animateDetails: true,
});

let memoryPreference: CollectionDisplayPreference = { ...DEFAULT_COLLECTION_DISPLAY };

function includes<T extends string>(choices: readonly T[], value: unknown): value is T {
  return typeof value === "string" && choices.includes(value as T);
}

function validPreference(value: unknown): value is CollectionDisplayPreference {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return includes(COLLECTION_VIEWS, candidate.view)
    && includes(COLLECTION_CARD_SIZES, candidate.size)
    && typeof candidate.showSet === "boolean"
    && typeof candidate.showLanguage === "boolean"
    && typeof candidate.showTypeRarity === "boolean"
    && typeof candidate.showPrices === "boolean"
    && typeof candidate.animateDetails === "boolean";
}

export function readCollectionDisplay(): CollectionDisplayPreference {
  try {
    const saved = window.localStorage.getItem(COLLECTION_DISPLAY_STORAGE_KEY);
    if (!saved) {
      memoryPreference = { ...DEFAULT_COLLECTION_DISPLAY };
      return { ...memoryPreference };
    }
    const parsed: unknown = JSON.parse(saved);
    memoryPreference = validPreference(parsed) ? { ...parsed } : { ...DEFAULT_COLLECTION_DISPLAY };
    return { ...memoryPreference };
  } catch {
    return { ...memoryPreference };
  }
}

export function writeCollectionDisplay(preference: CollectionDisplayPreference): boolean {
  if (!validPreference(preference)) return false;
  memoryPreference = { ...preference };
  try {
    window.localStorage.setItem(COLLECTION_DISPLAY_STORAGE_KEY, JSON.stringify(preference));
    return true;
  } catch {
    return false;
  }
}

export function resetCollectionDisplay(): CollectionDisplayPreference {
  memoryPreference = { ...DEFAULT_COLLECTION_DISPLAY };
  try {
    window.localStorage.removeItem(COLLECTION_DISPLAY_STORAGE_KEY);
  } catch {
    // In-memory defaults remain active when browser storage is unavailable.
  }
  return { ...memoryPreference };
}
