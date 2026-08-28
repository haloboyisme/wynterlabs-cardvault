import { describe, expect, it } from "vitest";

import {
  addSessionCapture,
  confirmSessionItem,
  createMultiScanSession,
  removeSessionItem,
  replaceSessionCapture,
  selectSessionItem,
  setAllMatchedSessionItemsConfirmed,
  setSessionItemError,
  updateSessionItem,
} from "./multi-scan-session";

const capture = (id: string) => ({
  id,
  previewUrl: `blob:${id}`,
  imageBlob: new Blob([id]),
  status: "queued" as const,
  detectedTitle: "",
  searchTitle: "",
  candidates: [],
  selectedPrintingId: "",
  finish: "nonfoil",
  condition: "near_mint",
  quantity: 1,
  confirmed: false,
  error: "",
});

describe("multi-card scan session", () => {
  it("allows 250 captures in the default browser session", () => {
    expect(createMultiScanSession().maximumItems).toBe(250);
  });

  it("adds captures in order, selects the newest, and caps the session", () => {
    let session = createMultiScanSession(2);
    session = addSessionCapture(session, capture("one"));
    session = addSessionCapture(session, capture("two"));
    session = addSessionCapture(session, capture("three"));
    expect(session.items.map((item) => item.id)).toEqual(["one", "two"]);
    expect(session.selectedId).toBe("two");
    expect(session.limitReached).toBe(true);
  });

  it("updates, confirms, selects, and removes one item without changing its neighbors", () => {
    let session = addSessionCapture(createMultiScanSession(), capture("one"));
    session = addSessionCapture(session, capture("two"));
    session = updateSessionItem(session, "one", {
      detectedTitle: "Voja, Jaws of the Conclave",
      selectedPrintingId: "printing-1",
    });
    session = confirmSessionItem(session, "one");
    session = selectSessionItem(session, "one");
    expect(session.items[0]).toMatchObject({ confirmed: true, status: "ready" });
    expect(session.items[1]?.status).toBe("queued");

    session = removeSessionItem(session, "one");
    expect(session.items.map((item) => item.id)).toEqual(["two"]);
    expect(session.selectedId).toBe("two");
  });

  it("confirms only matched cards and clears all matched confirmations", () => {
    let session = addSessionCapture(createMultiScanSession(), {
      ...capture("matched"),
      status: "review",
      selectedPrintingId: "printing-1",
    });
    session = addSessionCapture(session, {
      ...capture("unmatched"),
      status: "error",
      error: "No confident match found.",
    });

    session = setAllMatchedSessionItemsConfirmed(session, true);
    expect(session.items[0]).toMatchObject({ confirmed: true, status: "ready" });
    expect(session.items[1]).toMatchObject({
      confirmed: false,
      status: "error",
      error: "No confident match found.",
    });

    session = setAllMatchedSessionItemsConfirmed(session, false);
    expect(session.items[0]).toMatchObject({ confirmed: false, status: "review" });
    expect(session.items[1]).toMatchObject({ confirmed: false, status: "error" });
  });

  it("preserves the prior preview if a retake fails and replaces it only on success", () => {
    let session = addSessionCapture(createMultiScanSession(), capture("one"));
    session = setSessionItemError(session, "one", "Retake failed");
    expect(session.items[0]?.previewUrl).toBe("blob:one");
    session = replaceSessionCapture(session, "one", {
      previewUrl: "blob:replacement",
      imageBlob: new Blob(["replacement"]),
    });
    expect(session.items[0]).toMatchObject({
      previewUrl: "blob:replacement",
      status: "queued",
      error: "",
      confirmed: false,
      selectedPrintingId: "",
    });
  });
});
