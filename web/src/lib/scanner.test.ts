import { afterEach, expect, it, vi } from "vitest";

import { recognizeCardPhoto } from "./scanner";

afterEach(() => vi.unstubAllGlobals());

it("sends one image only to the authenticated private OCR endpoint", async () => {
  const photo = new Blob(["private pixels"], { type: "image/jpeg" });
  const fetch = vi.fn(async () => new Response(JSON.stringify({
    name: "Voja, Jaws of the Conclave",
    title_candidates: ["Voja, Jaws of the Conclave"],
    set: "sld",
    collector: "2284",
    raw_text: "Voja, Jaws of the Conclave",
  }), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);

  await expect(recognizeCardPhoto(photo)).resolves.toEqual({
    name: "Voja, Jaws of the Conclave",
    titleCandidates: ["Voja, Jaws of the Conclave"],
    set: "sld",
    collector: "2284",
    rawText: "Voja, Jaws of the Conclave",
  });
  expect(fetch).toHaveBeenCalledWith("/api/v1/scanner/recognize", expect.objectContaining({
    body: photo,
    credentials: "same-origin",
    method: "POST",
    headers: expect.objectContaining({ "content-type": "image/jpeg" }),
  }));
});

it("preserves AbortError when private OCR is superseded", async () => {
  const error = new DOMException("superseded", "AbortError");
  vi.stubGlobal("fetch", vi.fn(async () => { throw error; }));
  await expect(recognizeCardPhoto(new Blob(["x"], { type: "image/jpeg" }))).rejects.toBe(error);
});
