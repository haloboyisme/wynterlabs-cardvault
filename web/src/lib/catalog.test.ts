import { afterEach, expect, it, vi } from "vitest";

import {
  buildCardSearch,
  expandScanCandidates,
  getAllCatalogSets,
  getAllOraclePrintings,
  getScanCandidates,
} from "./catalog";

function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

afterEach(() => vi.unstubAllGlobals());

it("loads every declared set page beyond ten", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const page = Number(new URL(String(input), "https://local.test").searchParams.get("page"));
    return json({ items: [{ id: String(page), code: `s${page}`, name: `Set ${page}`, set_type: "expansion", released_at: null, card_count: 1, digital: false, icon_svg_uri: null, game: 'mtg' }], page, page_size: 200, total: 12, pages: 12 });
  }));
  const result = await getAllCatalogSets(undefined, 20);
  expect(result.items).toHaveLength(12);
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(12);
});

it("rejects absurd or invalid declared page counts", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => json({ items: [], page: 1, page_size: 200, total: 0, pages: 101 })));
  await expect(getAllCatalogSets(undefined, 100)).rejects.toThrow(/page count/i);
  vi.mocked(fetch).mockResolvedValue(json({ items: [], page: 1, page_size: 200, total: 0, pages: -1 }));
  await expect(getAllCatalogSets()).rejects.toThrow(/page count/i);
});

it("uses the card page-size default and enforces the API ceiling", () => {
  expect(new URL(buildCardSearch({}), "https://local.test").searchParams.get("page_size")).toBe("25");
  expect(new URL(buildCardSearch({ page_size: 100 }), "https://local.test").searchParams.get("page_size")).toBe("100");
  expect(new URL(buildCardSearch({ page_size: 101 }), "https://local.test").searchParams.get("page_size")).toBe("100");
});

it("omits Auto game filters and normalizes explicit game keys", () => {
  const auto = new URL(buildCardSearch({ game: "   " }), "https://local.test");
  const magic = new URL(buildCardSearch({ game: " MtG " }), "https://local.test");

  expect(auto.searchParams.has("game")).toBe(false);
  expect(magic.searchParams.get("game")).toBe("mtg");
});

it("sends only normalized text hints to the bounded scanner endpoint", async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json([]));
  vi.stubGlobal("fetch", fetchMock);
  const controller = new AbortController();
  await getScanCandidates({ name: " Black Lotus ", set: " LEA ", collector: " 233 " }, controller.signal);
  const [input, init] = fetchMock.mock.calls[0];
  const url = new URL(String(input), "https://local.test");
  expect(url.pathname).toBe("/api/v1/catalog/scan-candidates");
  expect(Object.fromEntries(url.searchParams)).toEqual({ name: "Black Lotus", set: "lea", collector: "233", limit: "10" });
  expect(init?.signal).toBe(controller.signal);
});

it("sends a selected game with preferred-set ranking hints", async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json([]));
  vi.stubGlobal("fetch", fetchMock);
  await getScanCandidates({
    name: " Lightning Bolt ",
    set: " M10 ",
    collector: " 146 ",
    preferredSet: " ISD ",
    game: " Pokemon ",
  });
  const url = new URL(String(fetchMock.mock.calls[0][0]), "https://local.test");
  expect(Object.fromEntries(url.searchParams)).toEqual({
    name: "Lightning Bolt",
    set: "m10",
    collector: "146",
    preferred_set: "isd",
    game: "pokemon",
    limit: "10",
  });
});

it("loads every printing page for an oracle card", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const page = Number(new URL(String(input), "https://local.test").searchParams.get("page"));
    return json({
      items: [{ printing_id: `p${page}`, oracle_id: "o1" }],
      page,
      page_size: 200,
      total: 3,
      pages: 3,
    });
  }));
  const result = await getAllOraclePrintings("o1");
  expect(result.map((printing) => printing.printing_id)).toEqual(["p1", "p2", "p3"]);
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
});

it("keeps a selected game on every expanded oracle-printing request", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "https://local.test");
    return json({
      items: [
        { printing_id: "pokemon-printing", oracle_id: "shared-oracle", set: { game: "pokemon" } },
        { printing_id: "yugioh-printing", oracle_id: "shared-oracle", set: { game: "yugioh" } },
      ],
      page: 1,
      page_size: 200,
      total: 1,
      pages: 1,
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  const results = await expandScanCandidates([
    { printing_id: "pokemon-seed", oracle_id: "shared-oracle", rank_reason: "exact_name" },
  ] as never, undefined, "pokemon");

  expect(results.map((item) => item.printing_id)).toEqual(["pokemon-printing"]);
  const url = new URL(String(fetchMock.mock.calls[0][0]), "https://local.test");
  expect(url.searchParams.get("game")).toBe("pokemon");
});
