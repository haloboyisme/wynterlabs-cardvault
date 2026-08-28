import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { APPEARANCE_STORAGE_KEY, DEFAULT_APPEARANCE } from "../lib/appearance";
import { DecksPage } from "./DecksPage";

const headers = { "content-type": "application/json" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
const deck = {
  id: "d1", name: "Tempo", game: "mtg", format: "modern", description: "Fast",
  revision: 3, created_at: "2026-08-14T00:00:00Z",
  updated_at: "2026-08-14T00:00:00Z",
};
const snowDeck = {
  id: "d2", name: "Snow Control", game: "pokemon", format: "commander", description: "Cold answers",
  revision: 2, created_at: "2026-08-11T00:00:00Z",
  updated_at: "2026-08-18T12:30:00Z",
};
const atraxaDeck = {
  id: "d3", name: "Atraxa Friends", game: "yugioh", format: "commander", description: null,
  revision: 1, created_at: "2026-08-09T00:00:00Z",
  updated_at: "2026-08-12T08:00:00Z",
};
const decks = [deck, snowDeck, atraxaDeck];

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal("fetch", vi.fn(async (_input, init) => {
    if (init?.method === "POST") return json({ ...deck, id: "d2", name: "Control" }, 201);
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return json({ items: decks, total: decks.length });
  }));
});
afterEach(() => vi.unstubAllGlobals());
const view = () => render(<MemoryRouter><DecksPage /></MemoryRouter>);

it("lists private decks with format and detail links", async () => {
  view();
  expect(screen.getByRole("status")).toHaveTextContent(/loading decks/i);
  expect(await screen.findByRole("heading", { name: "Tempo" })).toBeVisible();
  expect(screen.getByRole("link", { name: /open tempo/i })).toHaveAttribute("href", "/decks/d1");
  expect(screen.getByText("Modern", { selector: "p" })).toBeVisible();
  expect(screen.getByText("Magic: The Gathering", { selector: "p" })).toBeVisible();
  expect(screen.getByText("Pokémon", { selector: "p" })).toBeVisible();
});

it("derives saved-deck and format totals from the loaded page", async () => {
  view();

  await screen.findByRole("heading", { name: "Snow Control" });
  expect(screen.getByText("3 saved decks")).toBeVisible();
  expect(screen.getByText("2 formats")).toBeVisible();
  expect(screen.getByText("Commander · 2")).toBeVisible();
  expect(screen.getByText("Modern · 1")).toBeVisible();
});

it("filters and sorts the loaded decks locally without refetching", async () => {
  view();
  await screen.findByRole("heading", { name: "Snow Control" });
  const callsAfterLoad = vi.mocked(fetch).mock.calls.length;

  fireEvent.change(screen.getByLabelText("Search decks"), { target: { value: "snow" } });
  expect(screen.getByRole("heading", { name: "Snow Control" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Tempo" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Atraxa Friends" })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Reset deck filters" }));
  fireEvent.change(screen.getByLabelText("Format filter"), { target: { value: "commander" } });
  expect(screen.getByRole("heading", { name: "Snow Control" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Atraxa Friends" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Tempo" })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Reset deck filters" }));
  fireEvent.change(screen.getByLabelText("Sort decks"), { target: { value: "name" } });
  const list = screen.getByRole("list", { name: "Saved decks" });
  expect(within(list).getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent))
    .toEqual(["Atraxa Friends", "Snow Control", "Tempo"]);
  expect(vi.mocked(fetch).mock.calls).toHaveLength(callsAfterLoad);
});

it("keeps deck creation closed in Simple mode and open in Advanced mode", async () => {
  localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({
    ...DEFAULT_APPEARANCE,
    complexity: "simple",
  }));
  const simple = view();
  await screen.findByRole("heading", { name: "Tempo" });
  expect(screen.getByText("Create a deck", { selector: "summary" }).closest("details"))
    .not.toHaveAttribute("open");

  simple.unmount();
  localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({
    ...DEFAULT_APPEARANCE,
    complexity: "advanced",
  }));
  view();
  await screen.findByRole("heading", { name: "Tempo" });
  expect(screen.getByText("Create a deck", { selector: "summary" }).closest("details"))
    .toHaveAttribute("open");
});

it("creates a deck with its selected game and refreshes", async () => {
  view();
  await screen.findByRole("heading", { name: "Tempo" });
  fireEvent.change(screen.getByLabelText(/deck name/i), { target: { value: "Control" } });
  fireEvent.change(screen.getByLabelText("Format"), { target: { value: "commander" } });
  fireEvent.change(screen.getByLabelText("Game"), { target: { value: "pokemon" } });
  expect(screen.getByLabelText("Format")).toHaveValue("standard");
  expect(within(screen.getByLabelText("Format")).queryByRole("option", { name: "Commander" }))
    .not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/description/i), { target: { value: "  Blue cards  " } });
  fireEvent.click(screen.getByRole("button", { name: /create deck/i }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([, init]) =>
    init?.method === "POST" &&
    JSON.parse(String(init.body)).name === "Control" &&
    JSON.parse(String(init.body)).game === "pokemon" &&
    JSON.parse(String(init.body)).format === "standard" &&
    JSON.parse(String(init.body)).description === "Blue cards",
  )).toBe(true));
  expect((await screen.findByText(/control created/i)).closest("[role='status']"))
    .toHaveTextContent(/created/i);
});

it("confirms deck deletion and sends the displayed revision", async () => {
  view();
  await screen.findByRole("heading", { name: "Tempo" });
  fireEvent.click(screen.getByRole("button", { name: /delete tempo/i }));
  expect(confirm).toHaveBeenCalled();
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) =>
    String(url).endsWith("expected_revision=3") && init?.method === "DELETE",
  )).toBe(true));
});

it("keeps last-good decks visible through a conflict and refreshes", async () => {
  vi.mocked(fetch).mockImplementation(async (_input, init) => {
    if (init?.method === "DELETE") return json({
      error: { code: "deck_stale", message: "Deck changed. Refresh and retry." },
    }, 409);
    return json({ items: [deck], total: 1 });
  });
  view();
  await screen.findByRole("heading", { name: "Tempo" });
  fireEvent.click(screen.getByRole("button", { name: /delete tempo/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/changed.*refreshed/i);
  expect(screen.getByRole("heading", { name: "Tempo" })).toBeVisible();
});

it("offers retry after an initial failure", async () => {
  vi.mocked(fetch).mockResolvedValue(json({ error: { message: "Decks unavailable." } }, 500));
  view();
  expect(await screen.findByRole("alert")).toHaveTextContent(/decks unavailable/i);
  expect(screen.getByRole("button", { name: /retry/i })).toBeVisible();
});

it("keeps the empty state and creation path available", async () => {
  vi.mocked(fetch).mockResolvedValue(json({ items: [], total: 0 }));
  view();

  expect(await screen.findByRole("heading", { name: "No decks yet." })).toBeVisible();
  expect(screen.getByText("Create a deck", { selector: "summary" }).closest("details"))
    .toHaveAttribute("open");
  expect(screen.getByLabelText("Deck name")).toBeVisible();
});
