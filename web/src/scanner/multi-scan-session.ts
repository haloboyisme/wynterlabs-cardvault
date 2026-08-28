export type MultiScanItemStatus =
  | "queued"
  | "recognizing"
  | "review"
  | "ready"
  | "saving"
  | "saved"
  | "error";

export interface MultiScanItem {
  id: string;
  previewUrl: string;
  imageBlob: Blob;
  status: MultiScanItemStatus;
  detectedTitle: string;
  searchTitle: string;
  candidates: ScanCandidate[];
  selectedPrintingId: string;
  finish: string;
  condition: string;
  quantity: number;
  confirmed: boolean;
  error: string;
}

export interface MultiScanSession {
  items: MultiScanItem[];
  selectedId: string;
  maximumItems: number;
  limitReached: boolean;
}

export const createMultiScanSession = (maximumItems = 250): MultiScanSession => ({
  items: [],
  selectedId: "",
  maximumItems: Math.max(1, maximumItems),
  limitReached: false,
});

export const addSessionCapture = (
  session: MultiScanSession,
  item: MultiScanItem,
): MultiScanSession => {
  if (session.items.length >= session.maximumItems) {
    return { ...session, limitReached: true };
  }
  const items = [...session.items, item];
  return {
    ...session,
    items,
    selectedId: item.id,
    limitReached: items.length >= session.maximumItems,
  };
};

export const updateSessionItem = (
  session: MultiScanSession,
  id: string,
  updates: Partial<MultiScanItem>,
): MultiScanSession => ({
  ...session,
  items: session.items.map((item) => item.id === id ? { ...item, ...updates, id } : item),
});

export const confirmSessionItem = (session: MultiScanSession, id: string): MultiScanSession =>
  updateSessionItem(session, id, { confirmed: true, status: "ready", error: "" });

export const canConfirmSessionItem = (item: MultiScanItem): boolean =>
  item.status !== "saving"
  && item.status !== "saved"
  && Boolean(item.selectedPrintingId)
  && Boolean(item.finish)
  && item.quantity > 0;

export const setAllMatchedSessionItemsConfirmed = (
  session: MultiScanSession,
  confirmed: boolean,
): MultiScanSession => ({
  ...session,
  items: session.items.map((item) => {
    if (!canConfirmSessionItem(item)) return item;
    return {
      ...item,
      confirmed,
      status: confirmed ? "ready" : "review",
      error: "",
    };
  }),
});

export const setSessionItemError = (
  session: MultiScanSession,
  id: string,
  error: string,
): MultiScanSession => updateSessionItem(session, id, { error, status: "error" });

export const selectSessionItem = (session: MultiScanSession, id: string): MultiScanSession => ({
  ...session,
  selectedId: session.items.some((item) => item.id === id) ? id : session.selectedId,
});

export const removeSessionItem = (session: MultiScanSession, id: string): MultiScanSession => {
  const items = session.items.filter((item) => item.id !== id);
  return {
    ...session,
    items,
    selectedId: session.selectedId === id ? (items[0]?.id ?? "") : session.selectedId,
    limitReached: false,
  };
};

export const replaceSessionCapture = (
  session: MultiScanSession,
  id: string,
  capture: Pick<MultiScanItem, "previewUrl" | "imageBlob">,
): MultiScanSession => updateSessionItem(session, id, {
  ...capture,
  status: "queued",
  detectedTitle: "",
  searchTitle: "",
  candidates: [],
  selectedPrintingId: "",
  confirmed: false,
  error: "",
});
import type { ScanCandidate } from "../lib/types";
