import { afterEach, expect, it, vi } from "vitest";

import { addCollectionItem, buildCollectionSearch, deleteCollectionItem, getCollection, getCollectionValueHistory, updateCollectionItem } from "./collection";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

it("serializes trimmed filters and only permits supported page sizes", () => {
  const url = new URL(buildCollectionSearch({
    q: "  bolt  ", set: " M10 ", collector_number: " 301 ", rarity: " RARE ",
    finish: "foil", condition: "near_mint", price_status: "priced", sort: "quantity",
    page: 0, page_size: 75,
  }), "https://local.test");
  expect(Object.fromEntries(url.searchParams)).toEqual({
    q: "bolt", set: "m10", collector_number: "301", rarity: "rare", finish: "foil",
    condition: "near_mint", price_status: "priced", sort: "quantity", page: "1",
    page_size: "75",
  });
  expect(new URL(buildCollectionSearch({ price_status: "unknown" as never }), "https://local.test")
    .searchParams.has("price_status")).toBe(false);
  expect(new URL(buildCollectionSearch({ page_size: 99 }), "https://local.test").searchParams.get("page_size")).toBe("25");
});

it("omits Auto game filters and normalizes explicit game keys", () => {
  const auto = new URL(buildCollectionSearch({ game: "" }), "https://local.test");
  const magic = new URL(buildCollectionSearch({ game: " MtG " }), "https://local.test");

  expect(auto.searchParams.has("game")).toBe(false);
  expect(magic.searchParams.get("game")).toBe("mtg");
});

it("serializes every supported global collection sort", () => {
  const sorts = [
    "updated", "created_desc", "created_asc", "name", "name_desc",
    "quantity", "quantity_asc", "price_desc", "price_asc", "missing_price",
  ];

  for (const sort of sorts) {
    const url = new URL(
      buildCollectionSearch({ sort: sort as never }),
      "https://local.test",
    );
    expect(url.searchParams.get("sort")).toBe(sort);
  }
});

it("sends typed mutation bodies and optimistic revisions", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => json({})));
  await addCollectionItem({ printing_id: "p1", finish: "foil", condition: "near_mint", quantity: 2 });
  await updateCollectionItem("item 1", { quantity: 3, expected_revision: 4 });
  await deleteCollectionItem("item 1", 5);
  const calls = vi.mocked(fetch).mock.calls;
  expect(calls[0]).toEqual(["/api/v1/collection/items", expect.objectContaining({ method: "POST", body: JSON.stringify({ printing_id: "p1", finish: "foil", condition: "near_mint", quantity: 2 }) })]);
  expect(calls[1][0]).toBe("/api/v1/collection/items/item%201");
  expect(calls[1][1]).toEqual(expect.objectContaining({ method: "PUT", body: JSON.stringify({ quantity: 3, expected_revision: 4 }) }));
  expect(calls[2][0]).toBe("/api/v1/collection/items/item%201?expected_revision=5");
});

it("preserves API errors and AbortError", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => json({ error: { code: "collection_item_stale", message: "Refresh and retry." } }, 409)));
  await expect(getCollection({})).rejects.toMatchObject({ name: "ApiError", code: "collection_item_stale", status: 409 });
  vi.mocked(fetch).mockImplementation(async (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }));
  const controller = new AbortController();
  const request = getCollection({}, controller.signal);
  controller.abort();
  await expect(request).rejects.toMatchObject({ name: "AbortError" });
});

it("requests a typed collection value-history range", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => json({
    range: "month", points: [], current_value_usd: "0.00", change_usd: "0.00",
    change_percent: null, priced_copies: 0, unpriced_copies: 0, total_copies: 0,
  })));

  const history = await getCollectionValueHistory("quarter");

  expect(fetch).toHaveBeenCalledWith("/api/v1/collection/value-history?range=quarter", expect.objectContaining({
    credentials: "same-origin",
  }));
  expect(history.range).toBe("month");
});
