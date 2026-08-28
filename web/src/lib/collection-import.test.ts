import { afterEach, expect, it, vi } from "vitest";

import {
  cancelCollectionImport,
  confirmCollectionImport,
  downloadCollectionCsv,
  getCollectionImport,
  previewCollectionCsv,
} from "./collection";


const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

afterEach(() => vi.unstubAllGlobals());

it("uses exact CSV bodies and revision-safe import endpoints", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input, init) => {
    if (String(input).endsWith("/export.csv")) {
      return new Response("csv", { headers: { "content-type": "text/csv" } });
    }
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return json({});
  }));
  const file = new File(["csv"], "collection.csv", { type: "text/csv" });
  await previewCollectionCsv(file);
  await getCollectionImport("preview one");
  await confirmCollectionImport("preview one");
  await cancelCollectionImport("preview one");
  expect(await downloadCollectionCsv()).toBeInstanceOf(Blob);

  const calls = vi.mocked(fetch).mock.calls;
  expect(calls[0]).toEqual([
    "/api/v1/collection/imports/preview",
    expect.objectContaining({
      method: "POST",
      body: file,
      headers: expect.objectContaining({ "content-type": "text/csv" }),
    }),
  ]);
  expect(calls[1][0]).toBe("/api/v1/collection/imports/preview%20one");
  expect(calls[2]).toEqual([
    "/api/v1/collection/imports/preview%20one/confirm",
    expect.objectContaining({ method: "POST" }),
  ]);
  expect(calls[3]).toEqual([
    "/api/v1/collection/imports/preview%20one",
    expect.objectContaining({ method: "DELETE" }),
  ]);
  expect(calls[4][0]).toBe("/api/v1/collection/export.csv");
});

it("preserves controlled API errors and AbortError", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    json({ error: { code: "collection_import_stale", message: "Create a new preview." } }, 409),
  ));
  await expect(confirmCollectionImport("p1")).rejects.toMatchObject({
    name: "ApiError",
    code: "collection_import_stale",
    status: 409,
  });

  vi.mocked(fetch).mockImplementation(async (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
      );
    }),
  );
  const controller = new AbortController();
  const request = previewCollectionCsv(
    new File(["csv"], "collection.csv", { type: "text/csv" }),
    controller.signal,
  );
  controller.abort();
  await expect(request).rejects.toMatchObject({ name: "AbortError" });
});
