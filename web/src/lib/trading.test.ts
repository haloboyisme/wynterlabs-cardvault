import { afterEach, expect, it, vi } from "vitest";

import {
  createTrade,
  createWant,
  getTradeMatches,
  reportTrade,
} from "./trading";

afterEach(() => vi.unstubAllGlobals());

it("sends bounded private trade, want, match, and report requests", async () => {
  const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
  vi.stubGlobal("fetch", vi.fn(async (input, init) => {
    calls.push([input, init]);
    return new Response(JSON.stringify({ items: [], page: 1, page_size: 25, total: 0, pages: 0 }), {
      status: init?.method === "POST" ? 201 : 200,
      headers: { "content-type": "application/json" },
    });
  }));

  await createTrade({ collection_item_id: "ci1", quantity: 2 });
  await createWant({ oracle_id: "o1", printing_id: null, finish: null, condition: null, quantity: 1 });
  await getTradeMatches();
  await reportTrade({ listing_id: "l1", reason: "spam", details: "Repeated listing" });

  expect(String(calls[0][0])).toBe("/api/v1/trades");
  expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ collection_item_id: "ci1", quantity: 2 });
  expect(String(calls[2][0])).toContain("/api/v1/trade-matches");
  expect(JSON.parse(String(calls[3][1]?.body))).toEqual({
    listing_id: "l1", reason: "spam", details: "Repeated listing",
  });
});
