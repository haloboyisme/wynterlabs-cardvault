import { afterEach, vi } from "vitest";

import { apiRequest } from "./api";


afterEach(() => {
  vi.unstubAllGlobals();
});


it("maps the stable API error envelope", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "rate_limited",
            message: "Try again later.",
            fields: null,
            request_id: "req-1",
          },
        }),
        { status: 429, headers: { "content-type": "application/json" } },
      ),
    ),
  );

  await expect(apiRequest("/api/test")).rejects.toMatchObject({
    code: "rate_limited",
    status: 429,
    requestId: "req-1",
  });
});
it("preserves intentional request cancellation", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }),
  ));
  const controller = new AbortController();
  const request = apiRequest("/api/test", { signal: controller.signal });
  controller.abort();
  await expect(request).rejects.toMatchObject({ name: "AbortError" });
});
