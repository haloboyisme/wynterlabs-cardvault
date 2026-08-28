import { ApiError, apiRequest } from "./api";
import type {
  CollectionImportConfirmation, CollectionImportPreview,
  CollectionItem, CollectionItemCreate, CollectionItemUpdate, CollectionPageData,
  CollectionManualPriceResult, CollectionMissingPricePage,
  CollectionPriceStatus, CollectionSearchParams, CollectionSort, CollectionSummary,
  CollectionValueHistory, CollectionValueRange,
} from "./types";

const API = "/api/v1/collection";
const PAGE_SIZES = new Set([25, 50, 75, 100]);
const PRICE_STATUSES = new Set<CollectionPriceStatus>(["priced", "missing"]);
export const COLLECTION_SORT_STORAGE_KEY = "wynterlabs.cards.collection-sort.v1";
export const COLLECTION_SORTS: readonly CollectionSort[] = [
  "updated", "created_desc", "created_asc", "name", "name_desc",
  "quantity", "quantity_asc", "price_desc", "price_asc", "missing_price",
];
const SORTS = new Set<CollectionSort>(COLLECTION_SORTS);
let memorySort: CollectionSort = "updated";

function isCollectionSort(value: unknown): value is CollectionSort {
  return typeof value === "string" && SORTS.has(value as CollectionSort);
}

export function readCollectionSort(): CollectionSort {
  try {
    const saved = window.localStorage.getItem(COLLECTION_SORT_STORAGE_KEY);
    memorySort = isCollectionSort(saved) ? saved : "updated";
  } catch {
    // Preserve the last valid in-memory choice when browser storage is blocked.
  }
  return memorySort;
}

export function writeCollectionSort(sort: CollectionSort): boolean {
  if (!isCollectionSort(sort)) return false;
  memorySort = sort;
  try {
    window.localStorage.setItem(COLLECTION_SORT_STORAGE_KEY, sort);
    return true;
  } catch {
    return false;
  }
}

export function buildCollectionSearch(params: CollectionSearchParams): string {
  const query = new URLSearchParams();
  const values: Array<[string, string | number | undefined]> = [
    ["q", params.q?.trim() || undefined],
    ["set", params.set?.trim().toLowerCase() || undefined],
    ["game", params.game?.trim().toLocaleLowerCase() || undefined],
    ["collector_number", params.collector_number?.trim().toLowerCase() || undefined],
    ["rarity", params.rarity?.trim().toLowerCase() || undefined],
    ["finish", params.finish?.trim().toLowerCase() || undefined],
    ["condition", params.condition || undefined],
    ["price_status", params.price_status && PRICE_STATUSES.has(params.price_status)
      ? params.price_status
      : undefined],
    ["sort", params.sort && SORTS.has(params.sort) ? params.sort : "updated"],
    ["page", Math.max(1, Math.trunc(params.page ?? 1))],
    ["page_size", PAGE_SIZES.has(params.page_size ?? 25) ? params.page_size : 25],
  ];
  for (const [key, value] of values) if (value !== undefined && value !== "") query.set(key, String(value));
  return `${API}?${query.toString()}`;
}

export const getCollection = (params: CollectionSearchParams, signal?: AbortSignal) =>
  apiRequest<CollectionPageData>(buildCollectionSearch(params), { signal });
export const getCollectionSummary = (signal?: AbortSignal) =>
  apiRequest<CollectionSummary>(`${API}/summary`, { signal });
export const getCollectionValueHistory = (range: CollectionValueRange, signal?: AbortSignal) =>
  apiRequest<CollectionValueHistory>(`${API}/value-history?range=${range}`, { signal });
export const getMissingCollectionPrices = (page = 1, signal?: AbortSignal) =>
  apiRequest<CollectionMissingPricePage>(`${API}/pricing/missing?page=${page}&page_size=25`, { signal });
export const setManualCollectionPrice = (
  id: string,
  manualPriceUsd: string,
  expectedRevision: number,
  signal?: AbortSignal,
) => apiRequest<CollectionManualPriceResult>(`${API}/pricing/items/${encodeURIComponent(id)}`, {
  method: "PUT",
  body: JSON.stringify({ manual_price_usd: manualPriceUsd, expected_revision: expectedRevision }),
  signal,
});
export const addCollectionItem = (payload: CollectionItemCreate, signal?: AbortSignal) =>
  apiRequest<CollectionItem>(`${API}/items`, { method: "POST", body: JSON.stringify(payload), signal });
export const updateCollectionItem = (id: string, payload: CollectionItemUpdate, signal?: AbortSignal) =>
  apiRequest<CollectionItem>(`${API}/items/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(payload), signal });
export const deleteCollectionItem = (id: string, expectedRevision: number, signal?: AbortSignal) =>
  apiRequest<void>(`${API}/items/${encodeURIComponent(id)}?expected_revision=${expectedRevision}`, { method: "DELETE", signal });

export const previewCollectionCsv = (file: File, signal?: AbortSignal) =>
  apiRequest<CollectionImportPreview>(`${API}/imports/preview`, {
    method: "POST",
    body: file,
    headers: { "content-type": "text/csv" },
    signal,
  });

export const getCollectionImport = (id: string, signal?: AbortSignal) =>
  apiRequest<CollectionImportPreview>(`${API}/imports/${encodeURIComponent(id)}`, { signal });

export const confirmCollectionImport = (id: string, signal?: AbortSignal) =>
  apiRequest<CollectionImportConfirmation>(
    `${API}/imports/${encodeURIComponent(id)}/confirm`,
    { method: "POST", signal },
  );

export const cancelCollectionImport = (id: string, signal?: AbortSignal) =>
  apiRequest<void>(`${API}/imports/${encodeURIComponent(id)}`, {
    method: "DELETE",
    signal,
  });

export async function downloadCollectionCsv(signal?: AbortSignal): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(`${API}/export.csv`, {
      credentials: "same-origin",
      signal,
    });
  } catch (error) {
    if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
      throw error;
    }
    throw new ApiError("network_unavailable", "Collection export is unavailable.", 0);
  }
  if (!response.ok) {
    const body = response.headers.get("content-type")?.includes("application/json")
      ? await response.json() as { error?: { code?: string; message?: string } }
      : undefined;
    throw new ApiError(
      body?.error?.code ?? "request_failed",
      body?.error?.message ?? "Collection export could not be completed.",
      response.status,
    );
  }
  return response.blob();
}
