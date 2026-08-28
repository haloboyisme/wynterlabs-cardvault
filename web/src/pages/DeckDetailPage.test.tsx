import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { DeckDetailPage } from "./DeckDetailPage";

const headers = { "content-type": "application/json" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
const card = {
  printing_id: "p1", oracle_id: "o1", name: "Lightning Bolt", mana_cost: "{R}",
  type_line: "Instant", set: { id: "s1", code: "lea", name: "Limited Edition Alpha",
    set_type: "core", released_at: "1993-08-05", card_count: 295, digital: false,
    icon_svg_uri: null, game: 'mtg' }, collector_number: "161", rarity: "common",
  released_at: "1993-08-05", language: "en", layout: "normal",
  image_uris: {}, prices: {}, finishes: ["nonfoil"], colors: ["R"], active: true,
};
const deckCard = {
  id: "c1", printing_id: "p1", section: "mainboard", quantity: 4, revision: 5,
  owned_quantity: 2, card,
};
const detail = {
  id: "d1", name: "Burn", game: "mtg", format: "modern", description: "Fast",
  revision: 3, created_at: "2026-08-14T00:00:00Z", updated_at: "2026-08-14T00:00:00Z",
  cards: [deckCard], mainboard_count: 4, sideboard_count: 0,
  warnings: [{ code: "ownership_shortage", message: "You need 2 more copies.", printing_id: "p1" }],
};

beforeEach(() => {
  vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal("fetch", vi.fn(async (input, init) => {
    const url = String(input);
    if (url.includes("/catalog/cards")) return json({ items: [card], page: 1, page_size: 25, total: 1, pages: 1 });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    if (init?.method) return json({ ...detail, revision: 4 });
    return json(detail);
  }));
});
afterEach(() => vi.unstubAllGlobals());
const view = () => render(<MemoryRouter initialEntries={["/decks/d1"]}>
  <Routes><Route path="/decks/:deckId" element={<DeckDetailPage />} /></Routes>
</MemoryRouter>);

it("renders totals, sections, warnings, ownership shortages, and inactive state", async () => {
  view();
  expect(screen.getByRole("status")).toHaveTextContent(/loading deck/i);
  expect(await screen.findByRole("heading", { name: "Burn" })).toBeVisible();
  expect(screen.getAllByText("Mainboard")[0].nextElementSibling).toHaveTextContent("4");
  expect(screen.getByText(/2 owned/i)).toBeVisible();
  expect(screen.getByText(/2 short/i)).toBeVisible();
  expect(screen.getByRole("alert", { name: /deck warning/i })).toHaveTextContent(/need 2 more/i);
  expect(screen.getByText(/Magic: The Gathering · Modern/)).toBeVisible();
});

it("updates metadata with the displayed deck revision", async () => {
  view();
  await screen.findByRole("heading", { name: "Burn" });
  fireEvent.click(screen.getByRole("button", { name: /edit deck details/i }));
  fireEvent.change(screen.getByLabelText(/deck name/i), { target: { value: "Burn Two" } });
  fireEvent.click(screen.getByRole("button", { name: /save deck details/i }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) =>
    String(url).endsWith("/decks/d1") && init?.method === "PATCH" &&
    JSON.parse(String(init.body)).expected_revision === 3,
  )).toBe(true));
});

it("offers only Pokémon formats when editing a Pokémon deck", async () => {
  const pokemonDeck = { ...detail, game: "pokemon", format: "standard" };
  vi.mocked(fetch).mockImplementation(async () => json(pokemonDeck));
  view();
  await screen.findByRole("heading", { name: "Burn" });
  fireEvent.click(screen.getByRole("button", { name: /edit deck details/i }));
  const format = screen.getByLabelText("Format");
  expect(format).toHaveTextContent("Standard");
  expect(format).toHaveTextContent("Expanded");
  expect(format).toHaveTextContent("Unlimited");
  expect(format).not.toHaveTextContent("Commander");
});

it("searches exact printings and adds to the selected section with target PUT", async () => {
  view();
  await screen.findByRole("heading", { name: "Burn" });
  fireEvent.change(screen.getByLabelText(/search card catalog/i), { target: { value: "bolt" } });
  fireEvent.click(screen.getByRole("button", { name: /search printings/i }));
  expect(await screen.findByRole("heading", { name: "Lightning Bolt" })).toBeVisible();
  expect(vi.mocked(fetch).mock.calls.some(([url]) =>
    new URL(String(url), "https://local.test").searchParams.get("game") === "mtg",
  )).toBe(true);
  fireEvent.change(screen.getByLabelText(/section for lightning bolt/i), { target: { value: "sideboard" } });
  fireEvent.click(screen.getByRole("button", { name: /add lightning bolt/i }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) => {
    if (!String(url).endsWith("/decks/d1/cards") || init?.method !== "PUT") return false;
    const body = JSON.parse(String(init.body));
    return body.printing_id === "p1" && body.section === "sideboard" &&
      !("expected_revision" in body);
  })).toBe(true));
});

it("shows the API's clear cross-game mismatch feedback", async () => {
  const pokemonCard = { ...card, printing_id: "pokemon-p1", set: { ...card.set, game: "pokemon" } };
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (String(input).includes("/catalog/cards")) return json({ items: [pokemonCard], page: 1, page_size: 25, total: 1, pages: 1 });
    if (String(input).endsWith("/decks/d1/cards") && init?.method === "PUT") {
      return json({ error: { code: "deck_game_mismatch", message: "That printing belongs to a different game." } }, 422);
    }
    return json(detail);
  });
  view();
  await screen.findByRole("heading", { name: "Burn" });
  fireEvent.change(screen.getByLabelText(/search card catalog/i), { target: { value: "pikachu" } });
  fireEvent.click(screen.getByRole("button", { name: /search printings/i }));
  await screen.findByRole("heading", { name: "Lightning Bolt" });
  fireEvent.click(screen.getByRole("button", { name: /add lightning bolt/i }));
  expect(await screen.findByRole("alert", { name: /deck error/i })).toHaveTextContent(/belongs to a different game/i);
});

it("moves and changes quantity through card-id PATCH with card revision", async () => {
  view();
  await screen.findByRole("heading", { name: "Burn" });
  fireEvent.click(screen.getByRole("button", { name: /edit lightning bolt/i }));
  fireEvent.change(screen.getByLabelText(/quantity for lightning bolt/i), { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText(/section for saved lightning bolt/i), { target: { value: "sideboard" } });
  fireEvent.click(screen.getByRole("button", { name: /save lightning bolt/i }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) => {
    if (!String(url).endsWith("/decks/d1/cards/c1") || init?.method !== "PATCH") return false;
    const body = JSON.parse(String(init.body));
    return body.expected_revision === 5 && body.section === "sideboard" && body.quantity === 3;
  })).toBe(true));
});

it("removes by card ID with revision and preserves last-good on stale conflict", async () => {
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (init?.method === "DELETE") return json({ error: { code: "deck_card_stale", message: "Card changed. Refresh and retry." } }, 409);
    return json(detail);
  });
  view();
  await screen.findByRole("heading", { name: "Burn" });
  fireEvent.click(screen.getByRole("button", { name: /remove lightning bolt/i }));
  expect(await screen.findByRole("alert", { name: /deck error/i })).toHaveTextContent(/changed.*refreshed/i);
  expect(screen.getByRole("heading", { name: "Lightning Bolt" })).toBeVisible();
  expect(vi.mocked(fetch).mock.calls.some(([url, init]) =>
    String(url).endsWith("/cards/c1?expected_revision=5") && init?.method === "DELETE",
  )).toBe(true);
});

it("limits section choices to the current format", async () => {
  view();
  await screen.findByRole("heading", { name: "Burn" });
  fireEvent.click(screen.getByRole("button", { name: /edit lightning bolt/i }));
  const choices = Array.from(screen.getByLabelText(/section for saved lightning bolt/i).querySelectorAll("option"))
    .map((option) => option.value);
  expect(choices).toEqual(["mainboard", "sideboard", "companion", "maybeboard"]);
  expect(choices).not.toContain("commander");
});

it("retains and labels inactive saved printings", async () => {
  vi.mocked(fetch).mockResolvedValue(json({
    ...detail, warnings: [], cards: [{
      ...deckCard, card: { ...card, active: false },
    }],
  }));
  view();
  expect(await screen.findByText(/inactive printing retained/i)).toBeVisible();
  expect(screen.getByRole("heading", { name: "Lightning Bolt" })).toBeVisible();
});

it("keeps the newest catalog search when an older response arrives late", async () => {
  let resolveOld: ((response: Response) => void) | undefined;
  let oldSignal: AbortSignal | undefined;
  const newest = { ...card, printing_id: "p2", name: "New printing" };
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/catalog/cards") && url.includes("q=old")) {
      oldSignal = init?.signal ?? undefined;
      return new Promise<Response>((resolve) => { resolveOld = resolve; });
    }
    if (url.includes("/catalog/cards") && url.includes("q=new")) {
      return json({ items: [newest], page: 1, page_size: 25, total: 1, pages: 1 });
    }
    return json(detail);
  });
  view();
  await screen.findByRole("heading", { name: "Burn" });
  const input = screen.getByLabelText(/search card catalog/i);
  fireEvent.change(input, { target: { value: "old" } });
  fireEvent.click(screen.getByRole("button", { name: /search printings/i }));
  await waitFor(() => expect(resolveOld).toBeTypeOf("function"));
  fireEvent.change(input, { target: { value: "new" } });
  fireEvent.click(screen.getByRole("button", { name: /search printings/i }));
  expect(await screen.findByRole("heading", { name: "New printing" })).toBeVisible();
  expect(oldSignal?.aborted).toBe(true);
  resolveOld?.(json({ items: [card], page: 1, page_size: 25, total: 1, pages: 1 }));
  await Promise.resolve();
  expect(screen.queryByRole("button", { name: /add lightning bolt/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("alert", { name: /deck error/i })).not.toBeInTheDocument();
});

it("clears the prior route and ignores an old mutation response", async () => {
  let resolvePatch: ((response: Response) => void) | undefined;
  let resolveSecond: ((response: Response) => void) | undefined;
  const second = { ...detail, id: "d2", name: "Control", cards: [], warnings: [] };
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/decks/d1") && init?.method === "PATCH") {
      return new Promise<Response>((resolve) => { resolvePatch = resolve; });
    }
    if (url.endsWith("/decks/d2")) {
      return new Promise<Response>((resolve) => { resolveSecond = resolve; });
    }
    return json(detail);
  });
  render(<MemoryRouter initialEntries={["/decks/d1"]}>
    <Link to="/decks/d2">Switch deck</Link>
    <Routes><Route path="/decks/:deckId" element={<DeckDetailPage />} /></Routes>
  </MemoryRouter>);
  await screen.findByRole("heading", { name: "Burn" });
  fireEvent.click(screen.getByRole("button", { name: /edit deck details/i }));
  fireEvent.change(screen.getByLabelText(/deck name/i), { target: { value: "Pending" } });
  fireEvent.click(screen.getByRole("button", { name: /save deck details/i }));
  await waitFor(() => expect(resolvePatch).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("link", { name: /switch deck/i }));
  expect(screen.queryByRole("heading", { name: "Burn" })).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(/loading deck/i);
  resolveSecond?.(json(second));
  expect(await screen.findByRole("heading", { name: "Control" })).toBeVisible();
  resolvePatch?.(json({ ...detail, name: "Pending", revision: 4 }));
  await Promise.resolve();
  expect(screen.getByRole("heading", { name: "Control" })).toBeVisible();
});

it("reloads full analysis after a format change", async () => {
  let reads = 0;
  const changed = {
    ...detail, format: "legacy", revision: 4,
    warnings: [{ code: "not_legal", message: "Not legal in Legacy.", printing_id: "p1" }],
  };
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/decks/d1") && init?.method === "PATCH") {
      return json({ ...detail, format: "legacy", revision: 4 });
    }
    if (url.endsWith("/decks/d1")) {
      reads += 1;
      return json(reads === 1 ? detail : changed);
    }
    return json(detail);
  });
  view();
  await screen.findByRole("heading", { name: "Burn" });
  fireEvent.click(screen.getByRole("button", { name: /edit deck details/i }));
  fireEvent.change(screen.getByLabelText(/format/i), { target: { value: "legacy" } });
  fireEvent.click(screen.getByRole("button", { name: /save deck details/i }));
  expect(await screen.findByText(/not legal in legacy/i)).toBeVisible();
  expect(reads).toBe(2);
});

it("reports a failed conflict refresh truthfully and offers retry", async () => {
  let reads = 0;
  let recovered = false;
  vi.mocked(fetch).mockImplementation(async (_input, init) => {
    if (init?.method === "DELETE") {
      return json({ error: { code: "deck_card_stale", message: "Card changed." } }, 409);
    }
    reads += 1;
    if (recovered) return json(detail);
    return reads === 1 ? json(detail) :
      json({ error: { code: "service_unavailable", message: "Refresh unavailable." } }, 503);
  });
  view();
  await screen.findByRole("heading", { name: "Burn" });
  fireEvent.click(screen.getByRole("button", { name: /remove lightning bolt/i }));
  const alert = await screen.findByRole("alert", { name: /deck error/i });
  await waitFor(() => expect(alert).toHaveTextContent(/refresh unavailable/i));
  expect(alert).not.toHaveTextContent(/has been refreshed/i);
  expect(screen.getByRole("button", { name: /retry/i })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Burn" })).toBeVisible();
  recovered = true;
  fireEvent.click(screen.getByRole("button", { name: /retry/i }));
  await waitFor(() => expect(screen.queryByRole("alert", { name: /deck error/i }))
    .not.toBeInTheDocument());
});

it("pages search results and shows an explicit empty state", async () => {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/catalog/cards") && url.includes("q=missing")) {
      return json({ items: [], page: 1, page_size: 25, total: 0, pages: 0 });
    }
    if (url.includes("/catalog/cards") && url.includes("page=2")) {
      return json({ items: [{ ...card, printing_id: "p26", name: "Page Two Card" }],
        page: 2, page_size: 25, total: 26, pages: 2 });
    }
    if (url.includes("/catalog/cards")) {
      return json({ items: [card], page: 1, page_size: 25, total: 26, pages: 2 });
    }
    return json(detail);
  });
  view();
  await screen.findByRole("heading", { name: "Burn" });
  const input = screen.getByLabelText(/search card catalog/i);
  fireEvent.change(input, { target: { value: "bolt" } });
  fireEvent.click(screen.getByRole("button", { name: /search printings/i }));
  await screen.findByRole("heading", { name: "Lightning Bolt" });
  fireEvent.click(screen.getByRole("button", { name: /next search page/i }));
  expect(await screen.findByRole("heading", { name: "Page Two Card" })).toBeVisible();
  fireEvent.change(input, { target: { value: "missing" } });
  fireEvent.click(screen.getByRole("button", { name: /search printings/i }));
  expect(await screen.findByText(/no printings found/i)).toBeVisible();
});

it("clears an in-flight search and route feedback when changing decks", async () => {
  let oldSignal: AbortSignal | undefined;
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/catalog/cards")) {
      oldSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    }
    if (url.endsWith("/decks/d2")) {
      return json({ ...detail, id: "d2", name: "Control", warnings: [] });
    }
    return json(detail);
  });
  render(<MemoryRouter initialEntries={["/decks/d1"]}>
    <Link to="/decks/d2">Switch deck</Link>
    <Routes><Route path="/decks/:deckId" element={<DeckDetailPage />} /></Routes>
  </MemoryRouter>);
  await screen.findByRole("heading", { name: "Burn" });
  fireEvent.change(screen.getByLabelText(/search card catalog/i), { target: { value: "old" } });
  fireEvent.click(screen.getByRole("button", { name: /search printings/i }));
  expect(await screen.findByRole("status")).toHaveTextContent(/searching printings/i);
  fireEvent.click(screen.getByRole("link", { name: /switch deck/i }));
  expect(await screen.findByRole("heading", { name: "Control" })).toBeVisible();
  expect(oldSignal?.aborted).toBe(true);
  expect(screen.queryByText(/searching printings/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("alert", { name: /deck error/i })).not.toBeInTheDocument();
});

it("serializes deck-details before card removal and renders the authoritative refresh", async () => {
  let resolveMutation: ((response: Response) => void) | undefined;
  let reads = 0;
  const finalDetail = { ...detail, name: "Server Final", revision: 4 };
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/decks/d1") && init?.method === "PATCH") {
      return new Promise<Response>((resolve) => { resolveMutation = resolve; });
    }
    if (url.endsWith("/decks/d1") && !init?.method) {
      reads += 1;
      return json(reads === 1 ? detail : finalDetail);
    }
    if (init?.method) return json(detail);
    return json(detail);
  });
  view();
  await screen.findByRole("heading", { name: "Burn" });
  fireEvent.click(screen.getByRole("button", { name: /edit deck details/i }));
  fireEvent.change(screen.getByLabelText(/deck name/i), { target: { value: "Client Draft" } });
  fireEvent.click(screen.getByRole("button", { name: /save deck details/i }));
  await waitFor(() => expect(resolveMutation).toBeTypeOf("function"));

  const remove = screen.getByRole("button", { name: /remove lightning bolt/i });
  expect(remove).toBeDisabled();
  fireEvent.click(remove);
  expect(vi.mocked(fetch).mock.calls.filter(([, init]) =>
    init?.method && init.method !== "GET",
  )).toHaveLength(1);

  resolveMutation?.(json({ ...detail, name: "Client Draft", revision: 4 }));
  expect(await screen.findByRole("heading", { name: "Server Final" })).toBeVisible();
  expect(reads).toBe(2);
});

it("serializes card removal before deck-details save in the reverse attempt order", async () => {
  let resolveMutation: ((response: Response) => void) | undefined;
  let reads = 0;
  const finalDetail = { ...detail, name: "Burn", cards: [], mainboard_count: 0, warnings: [] };
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.method === "DELETE") {
      return new Promise<Response>((resolve) => { resolveMutation = resolve; });
    }
    if (url.endsWith("/decks/d1") && !init?.method) {
      reads += 1;
      return json(reads === 1 ? detail : finalDetail);
    }
    if (init?.method) return json(detail);
    return json(detail);
  });
  view();
  await screen.findByRole("heading", { name: "Burn" });
  fireEvent.click(screen.getByRole("button", { name: /edit deck details/i }));
  fireEvent.click(screen.getByRole("button", { name: /remove lightning bolt/i }));
  await waitFor(() => expect(resolveMutation).toBeTypeOf("function"));

  const save = screen.getByRole("button", { name: /save deck details/i });
  expect(save).toBeDisabled();
  fireEvent.click(save);
  expect(vi.mocked(fetch).mock.calls.filter(([, init]) =>
    init?.method && init.method !== "GET",
  )).toHaveLength(1);

  resolveMutation?.(new Response(null, { status: 204 }));
  expect(await screen.findByText(/no cards in this deck yet/i)).toBeVisible();
  expect(reads).toBe(2);
});

it("refreshes full deck detail after a successful card add", async () => {
  let reads = 0;
  const finalCard = { ...deckCard, quantity: 7, revision: 6 };
  const finalDetail = {
    ...detail, cards: [finalCard], mainboard_count: 7, revision: 4, warnings: [],
  };
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/catalog/cards")) {
      return json({ items: [card], page: 1, page_size: 25, total: 1, pages: 1 });
    }
    if (url.endsWith("/decks/d1/cards") && init?.method === "PUT") {
      return json({ ...detail, cards: [], mainboard_count: 0, revision: 4 });
    }
    if (url.endsWith("/decks/d1") && !init?.method) {
      reads += 1;
      return json(reads === 1 ? detail : finalDetail);
    }
    return json(detail);
  });
  view();
  await screen.findByRole("heading", { name: "Burn" });
  fireEvent.change(screen.getByLabelText(/search card catalog/i), { target: { value: "bolt" } });
  fireEvent.click(screen.getByRole("button", { name: /search printings/i }));
  await screen.findByRole("button", { name: /add lightning bolt/i });
  fireEvent.click(screen.getByRole("button", { name: /add lightning bolt/i }));
  expect((await screen.findByText("7", { selector: "strong" })).parentElement).toHaveTextContent(/7 saved/i);
  expect(reads).toBe(2);
});
