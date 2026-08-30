import { afterEach, expect, it, vi } from "vitest";

import { DEFAULT_BRANDING, getBranding } from "./branding";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("falls back safely when the branding response is incomplete", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );

  await expect(getBranding()).resolves.toEqual(DEFAULT_BRANDING);
});
