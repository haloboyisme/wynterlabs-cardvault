import { afterEach, expect, it, vi } from "vitest";

import {
  createDeck, deleteDeck, formatsForGame, getDeck, listDecks, removeDeckCard,
  sectionsForFormat, setDeckCard, updateDeck, updateDeckCard, DECK_FORMATS,
} from "./decks";

afterEach(() => vi.unstubAllGlobals());

function response(body: unknown = {}) {
  return new Response(JSON.stringify(body), {
    status: 200, headers: { "content-type": "application/json" },
  });
}

it("maps formats to only API-supported sections", () => {
  expect(sectionsForFormat("modern")).toEqual([
    "mainboard", "sideboard", "companion", "maybeboard",
  ]);
  expect(sectionsForFormat("commander")[0]).toBe("commander");
  expect(sectionsForFormat("oathbreaker").slice(0, 2)).toEqual([
    "oathbreaker", "signature_spell",
  ]);
});

it("limits non-Magic decks to their supported format choices", () => {
  expect(formatsForGame("pokemon")).toEqual(["standard", "expanded", "unlimited"]);
  expect(formatsForGame("yugioh")).toEqual(["advanced", "traditional", "unlimited"]);
  expect(formatsForGame("onepiece")).toEqual(["standard"]);
  expect(formatsForGame("mtg")).toEqual(DECK_FORMATS);
});

it("serializes list, detail, metadata, and deletion revisions", async () => {
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response({ items: [], total: 0 }));
  vi.stubGlobal("fetch", fetcher);
  await listDecks();
  await createDeck({ name: "Tempo", game: "mtg", format: "modern", description: null });
  await getDeck("deck/id");
  await updateDeck("deck/id", {
    name: "Tempo", format: "modern", description: null, expected_revision: 7,
  });
  await deleteDeck("deck/id", 8);
  expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
    "/api/v1/decks", "/api/v1/decks", "/api/v1/decks/deck%2Fid",
    "/api/v1/decks/deck%2Fid", "/api/v1/decks/deck%2Fid?expected_revision=8",
  ]);
  expect(fetcher.mock.calls[3][1]).toMatchObject({ method: "PATCH" });
  expect(JSON.parse(String(fetcher.mock.calls[3][1]?.body))).toMatchObject({ expected_revision: 7 });
});

it("uses target-section PUT, card-id PATCH, and revisioned DELETE", async () => {
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response({ cards: [] }));
  vi.stubGlobal("fetch", fetcher);
  await setDeckCard("d1", {
    printing_id: "p1", section: "sideboard", quantity: 2,
  });
  await updateDeckCard("d1", "c1", {
    section: "mainboard", quantity: 3, expected_revision: 4,
  });
  await removeDeckCard("d1", { id: "c1", revision: 5 });
  expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "PUT" });
  expect(String(fetcher.mock.calls[0][1]?.body)).not.toContain("expected_revision");
  expect(fetcher.mock.calls[1][1]).toMatchObject({ method: "PATCH" });
  expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toMatchObject({ expected_revision: 4 });
  expect(fetcher.mock.calls[2][0]).toBe(
    "/api/v1/decks/d1/cards/c1?expected_revision=5",
  );
});

it("preserves AbortError and forwards the caller signal", async () => {
  const abort = new DOMException("Stopped", "AbortError");
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => { throw abort; });
  vi.stubGlobal("fetch", fetcher);
  const controller = new AbortController();
  await expect(listDecks(controller.signal)).rejects.toBe(abort);
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    signal: controller.signal,
  });
});
