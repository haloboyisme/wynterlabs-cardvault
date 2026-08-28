import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CardsPage } from "./CardsPage";

const cardSet = {
  id: "set-id",
  code: "neo",
  name: "Kamigawa: Neon Dynasty",
  set_type: "expansion",
  released_at: "2022-02-18",
  card_count: 302,
  digital: false,
  icon_svg_uri: null,
    game: 'mtg',};

const card = {
  printing_id: "printing-id",
  oracle_id: "oracle-id",
  name: "The Wandering Emperor",
  mana_cost: "{2}{W}{W}",
  type_line: "Legendary Planeswalker",
  set: cardSet,
  collector_number: "42",
  rarity: "mythic",
  released_at: "2022-02-18",
  language: "en",
  layout: "normal",
  image_uris: { normal: "https://cards.scryfall.io/emperor.jpg" },
  prices: { usd: "19.99" },
  finishes: ["nonfoil", "foil"],
  colors: ["W"],
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/status")) {
      return json({
        ready: true,
        stale: false,
        source_updated_at: "2026-08-12T21:05:44Z",
        completed_at: "2026-08-12T21:12:00Z",
        counts: { sets: 1, oracle_cards: 1, printings: 1 },
      });
    }
    if (url.includes("/sets")) {
      return json({ items: [cardSet], page: 1, page_size: 200, total: 1, pages: 1 });
    }
    return json({ items: [card], page: 1, page_size: 25, total: 1, pages: 1 });
  }));
});

afterEach(() => vi.unstubAllGlobals());

it("renders semantic catalog results and accessible filters", async () => {
  render(<MemoryRouter><CardsPage /></MemoryRouter>);
  expect(await screen.findByRole("heading", { name: card.name })).toBeVisible();
  expect(screen.getByRole("list", { name: /card search results/i })).toBeVisible();
  expect(vi.mocked(fetch).mock.calls.some(([input]) => {
    const url = String(input);
    return url.includes("/cards?") && url.includes("page_size=25");
  })).toBe(true);
  const pageSize = screen.getByRole("combobox", { name: /cards per page/i });
  expect(Array.from(pageSize.querySelectorAll("option"), (option) => option.value)).toEqual(["25", "50", "75", "100"]);
  const footer = pageSize.closest(".catalog-results-footer");
  const pagination = screen.getByRole("navigation", { name: /card results pages/i });
  expect(footer).not.toBeNull();
  expect(footer).toContainElement(pagination);
  expect(pagination.compareDocumentPosition(pageSize) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole("img", { name: /wandering emperor card/i })).toBeVisible();
  for (const label of ["Set", "Collector number", "Rarity", "Color", "Card type", "Format legality", "Finish", "Sort"]) {
    expect(screen.getByLabelText(label)).toBeVisible();
  }
  const disclosure = screen.getByRole("button", { name: /refine results/i });
  expect(disclosure).toHaveAttribute("aria-expanded", "false");
  expect(disclosure).toHaveAttribute("aria-controls", "catalog-refinements");
  expect(document.getElementById("catalog-refinements")).not.toHaveClass("is-open");
  expect(screen.getByRole("group", { name: /find cards/i })).toBeVisible();
  expect(screen.getByRole("group", { name: /refine results/i })).toBeVisible();
  expect(screen.getByRole("link", { name: /view the wandering emperor details/i })).toBeVisible();
  expect(screen.getByText(/1 card found/i)).toHaveAttribute("aria-live", "polite");
});
it("opens and closes refinements with native keyboard button behavior", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><CardsPage /></MemoryRouter>);
  await screen.findByRole("heading", { name: card.name });
  const disclosure = screen.getByRole("button", { name: /refine results/i });
  disclosure.focus();
  await user.keyboard("{Enter}");
  expect(disclosure).toHaveAttribute("aria-expanded", "true");
  expect(document.getElementById("catalog-refinements")).toHaveClass("is-open");
  await user.keyboard(" ");
  expect(disclosure).toHaveAttribute("aria-expanded", "false");
});
it("shows catalog freshness and required source notices without third-party logos", async () => {
  render(<MemoryRouter><CardsPage /></MemoryRouter>);
  await screen.findByRole("heading", { name: card.name });
  expect(screen.getByText(/catalog updated/i)).toHaveTextContent(/aug 12, 2026/i);
  expect(screen.getByRole("link", { name: /card data provided by scryfall/i })).toHaveAttribute("href", "https://scryfall.com/");
  expect(screen.getByText(/unofficial fan content/i)).toBeVisible();
  expect(screen.getByRole("link", { name: /wizards fan content policy/i })).toHaveAttribute("href", expect.stringContaining("wizards.com"));
  expect(document.querySelector(".catalog-notices img")).toBeNull();
});
it("debounces search and serializes every filter", async () => {
  render(<MemoryRouter><CardsPage /></MemoryRouter>);
  await screen.findByRole("heading", { name: card.name });
  vi.mocked(fetch).mockClear();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "wandering" } });
  fireEvent.change(screen.getByLabelText("Set"), { target: { value: "mtg:neo" } });
  fireEvent.change(screen.getByLabelText("Rarity"), { target: { value: "mythic" } });
  fireEvent.change(screen.getByLabelText("Color"), { target: { value: "W" } });
  fireEvent.change(screen.getByLabelText("Card type"), { target: { value: "planeswalker" } });
  fireEvent.change(screen.getByLabelText("Format legality"), { target: { value: "commander" } });
  fireEvent.change(screen.getByLabelText("Finish"), { target: { value: "foil" } });
  fireEvent.change(screen.getByLabelText("Collector number"), { target: { value: "42" } });
  fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "collector" } });
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => {
    const url = String(input);
    return ["q=wandering", "set=neo", "collector=42", "rarity=mythic", "color=W", "type=planeswalker", "legality=commander", "finish=foil", "sort=collector", "page_size=25"].every((part) => url.includes(part));
  })).toBe(true), { timeout: 1200 });
});

it("filters Cards by game, resets pagination, clears incompatible sets, and restores Auto", async () => {
  const nonMagicSet = { ...cardSet, id: "other-set", code: "base1", name: "Pokémon Base Set", game: "pokemon" };
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/status")) return json({
      ready: true, stale: false, source_updated_at: null, completed_at: null,
      counts: { sets: 2, oracle_cards: 1, printings: 1 },
    });
    if (url.includes("/sets")) return json({ items: [cardSet, nonMagicSet], page: 1, page_size: 200, total: 2, pages: 1 });
    const page = Number(new URL(url, "https://local.test").searchParams.get("page") ?? "1");
    return json({ items: [card], page, page_size: 25, total: 2, pages: 2 });
  });
  render(<MemoryRouter><CardsPage /></MemoryRouter>);

  await screen.findByRole("heading", { name: card.name });
  fireEvent.change(screen.getByLabelText("Set"), { target: { value: "pokemon:base1" } });
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) =>
    new URL(String(input), "https://local.test").searchParams.get("set") === "base1",
  )).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("Page 2 of 2");

  fireEvent.change(screen.getByRole("combobox", { name: "Game or brand" }), { target: { value: "mtg" } });
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => {
    const parameters = new URL(String(input), "https://local.test").searchParams;
    return parameters.get("game") === "mtg" && parameters.get("page") === "1" && !parameters.has("set");
  })).toBe(true));
  expect(screen.getByLabelText("Set")).toHaveValue("");
  expect(screen.queryByRole("option", { name: "Pokémon Base Set" })).not.toBeInTheDocument();
  expect(screen.getByText("Game: Magic: The Gathering")).toBeVisible();

  fireEvent.change(screen.getByRole("combobox", { name: "Game or brand" }), { target: { value: "" } });
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => {
    const parameters = new URL(String(input), "https://local.test").searchParams;
    return parameters.get("page") === "1" && !parameters.has("game") && !parameters.has("set");
  })).toBe(true));
});

it("uses a game-qualified set filter when games share a set code", async () => {
  const pokemonNeo = { ...cardSet, id: "pokemon-neo", code: "neo", name: "Pokémon Neo", game: "pokemon" };
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/status")) return json({
      ready: true, stale: false, source_updated_at: null, completed_at: null,
      counts: { sets: 2, oracle_cards: 2, printings: 2 },
    });
    if (url.includes("/sets")) return json({ items: [cardSet, pokemonNeo], page: 1, page_size: 200, total: 2, pages: 1 });
    return json({ items: [card], page: 1, page_size: 25, total: 1, pages: 1 });
  });
  render(<MemoryRouter><CardsPage /></MemoryRouter>);

  await screen.findByRole("heading", { name: card.name });
  fireEvent.change(screen.getByLabelText("Set"), { target: { value: "pokemon:neo" } });

  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => {
    const parameters = new URL(String(input), "https://local.test").searchParams;
    return parameters.get("set") === "neo" && parameters.get("game") === "pokemon";
  })).toBe(true));
  expect(screen.getByLabelText("Set")).toHaveValue("pokemon:neo");
});

it("keeps the selected game when clearing a set filter", async () => {
  render(<MemoryRouter><CardsPage /></MemoryRouter>);

  await screen.findByRole("heading", { name: card.name });
  fireEvent.change(screen.getByRole("combobox", { name: "Game or brand" }), { target: { value: "mtg" } });
  fireEvent.change(screen.getByLabelText("Set"), { target: { value: "mtg:neo" } });
  fireEvent.change(screen.getByLabelText("Set"), { target: { value: "" } });

  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => {
    const parameters = new URL(String(input), "https://local.test").searchParams;
    return parameters.get("game") === "mtg" && !parameters.has("set");
  })).toBe(true));
  expect(screen.getByRole("combobox", { name: "Game or brand" })).toHaveValue("mtg");
});

it("keeps a healthy selected-game catalog usable when Magic is not ready", async () => {
  const pokemonSet = { ...cardSet, id: "pokemon-set", code: "base1", name: "Pokémon Base Set", game: "pokemon" };
  const pokemonCard = { ...card, set: pokemonSet, name: "Pikachu" };
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/status")) return json({
      ready: false, stale: false, source_updated_at: null, completed_at: null,
      counts: { sets: 0, oracle_cards: 0, printings: 0 },
    });
    if (url.includes("/sets")) return json({ items: [pokemonSet], page: 1, page_size: 200, total: 1, pages: 1 });
    return json({ items: [pokemonCard], page: 1, page_size: 25, total: 1, pages: 1 });
  });
  render(<MemoryRouter><CardsPage /></MemoryRouter>);

  expect(await screen.findByRole("heading", { name: "Pikachu" })).toBeVisible();
  fireEvent.change(screen.getByRole("combobox", { name: "Game or brand" }), { target: { value: "pokemon" } });
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) =>
    new URL(String(input), "https://local.test").searchParams.get("game") === "pokemon",
  )).toBe(true));
  expect(screen.queryByText(/catalog is being prepared/i)).not.toBeInTheDocument();
});

it("uses the selected game in the catalog heading", async () => {
  render(<MemoryRouter><CardsPage /></MemoryRouter>);
  await screen.findByRole("heading", { name: card.name });

  fireEvent.change(screen.getByRole("combobox", { name: "Game or brand" }), { target: { value: "pokemon" } });

  expect(await screen.findByText("Pokémon card catalog")).toBeVisible();
});

it("identifies active game filters in the empty Cards state and clears every filter", async () => {
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/status")) return json({
      ready: true, stale: false, source_updated_at: null, completed_at: null,
      counts: { sets: 1, oracle_cards: 1, printings: 1 },
    });
    if (url.includes("/sets")) return json({ items: [cardSet], page: 1, page_size: 200, total: 1, pages: 1 });
    const parameters = new URL(url, "https://local.test").searchParams;
    return parameters.has("game") || parameters.has("q")
      ? json({ items: [], page: 1, page_size: 25, total: 0, pages: 0 })
      : json({ items: [card], page: 1, page_size: 25, total: 1, pages: 1 });
  });
  render(<MemoryRouter><CardsPage /></MemoryRouter>);

  await screen.findByRole("heading", { name: card.name });
  fireEvent.change(screen.getByRole("combobox", { name: "Game or brand" }), { target: { value: "mtg" } });
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "no results" } });
  fireEvent.change(screen.getByLabelText("Set"), { target: { value: "mtg:neo" } });
  fireEvent.change(screen.getByLabelText("Rarity"), { target: { value: "mythic" } });
  fireEvent.change(screen.getByLabelText("Color"), { target: { value: "W" } });
  fireEvent.change(screen.getByLabelText("Card type"), { target: { value: "planeswalker" } });
  fireEvent.change(screen.getByLabelText("Format legality"), { target: { value: "commander" } });
  fireEvent.change(screen.getByLabelText("Finish"), { target: { value: "foil" } });
  fireEvent.change(screen.getByLabelText("Collector number"), { target: { value: "42" } });
  fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "collector" } });
  const emptyState = (await screen.findByRole("heading", { name: /no cards matched/i })).closest(".state-panel");
  expect(emptyState).toHaveTextContent("Game: Magic: The Gathering");
  expect(emptyState).toHaveTextContent("Search: no results");

  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(screen.getByRole("searchbox")).toHaveValue("");
  expect(screen.getByRole("combobox", { name: "Game or brand" })).toHaveValue("");
  expect(screen.getByLabelText("Set")).toHaveValue("");
  expect(screen.getByLabelText("Rarity")).toHaveValue("");
  expect(screen.getByLabelText("Color")).toHaveValue("");
  expect(screen.getByLabelText("Card type")).toHaveValue("");
  expect(screen.getByLabelText("Format legality")).toHaveValue("");
  expect(screen.getByLabelText("Finish")).toHaveValue("");
  expect(screen.getByLabelText("Collector number")).toHaveValue("");
  expect(screen.getByLabelText("Sort")).toHaveValue("relevance");
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => {
    const parameters = new URL(String(input), "https://local.test").searchParams;
    return parameters.get("page") === "1" && parameters.get("page_size") === "25"
      && ["game", "q", "set", "rarity", "color", "type", "legality", "finish", "collector", "sort"]
        .every((key) => !parameters.has(key));
  })).toBe(true));
});

it("shows stale, preparing, empty, and network error states", async () => {
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => String(input).includes("/status")
    ? json({ ready: false, stale: false, source_updated_at: null, completed_at: null, counts: { sets: 0, oracle_cards: 0, printings: 0 } })
    : json({ items: [], page: 1, page_size: 200, total: 0, pages: 0 }));
  const first = render(<MemoryRouter><CardsPage /></MemoryRouter>);
  expect(await screen.findByText(/catalog is being prepared/i)).toBeVisible();
  first.unmount();

  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => String(input).includes("/status")
    ? json({ ready: true, stale: true, source_updated_at: null, completed_at: null, counts: { sets: 1, oracle_cards: 1, printings: 1 } })
    : json({ items: [], page: 1, page_size: 25, total: 0, pages: 0 }));
  const second = render(<MemoryRouter><CardsPage /></MemoryRouter>);
  expect(await screen.findByText(/catalog data may be out of date/i)).toBeVisible();
  expect(await screen.findByText(/no cards matched/i)).toBeVisible();
  second.unmount();

  vi.mocked(fetch).mockRejectedValue(new TypeError("offline"));
  render(<MemoryRouter><CardsPage /></MemoryRouter>);
  expect(await screen.findByRole("alert")).toHaveTextContent(/unavailable/i);
});

it("bounds pagination and resets to page one when page size changes", async () => {
  let pageTwoAborted = false;
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/status")) return json({ ready: true, stale: false, source_updated_at: null, completed_at: null, counts: { sets: 1, oracle_cards: 1, printings: 25 } });
    if (url.includes("/sets")) return json({ items: [cardSet], page: 1, page_size: 200, total: 1, pages: 1 });
    const page = url.includes("page=2") ? 2 : 1;
    return json({ items: [card], page, page_size: url.includes("page_size=75") ? 75 : 25, total: 125, pages: 5 });
  });
  render(<MemoryRouter><CardsPage /></MemoryRouter>);
  await screen.findByText(/page 1 of 5/i);
  expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /next/i }));
  await screen.findByText(/page 2 of 5/i);
  const pageTwoCall = vi.mocked(fetch).mock.calls.find(([input]) => String(input).includes("page=2"));
  pageTwoCall?.[1]?.signal?.addEventListener("abort", () => { pageTwoAborted = true; });

  fireEvent.change(screen.getByRole("combobox", { name: /cards per page/i }), { target: { value: "75" } });

  await screen.findByText(/page 1 of 5/i);
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => {
    const url = String(input);
    return url.includes("page=1") && url.includes("page_size=75");
  })).toBe(true));
  expect(pageTwoAborted).toBe(true);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("shows a real loading state while card results are pending", async () => {
  let release: ((value: Response) => void) | undefined;
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/status")) return json({ ready: true, stale: false, source_updated_at: null, completed_at: null, counts: { sets: 1, oracle_cards: 1, printings: 1 } });
    if (url.includes("/sets")) return json({ items: [cardSet], page: 1, page_size: 200, total: 1, pages: 1 });
    return new Promise<Response>((resolve) => { release = resolve; });
  });
  render(<MemoryRouter><CardsPage /></MemoryRouter>);
  const status = await screen.findByRole("status", { name: /searching the catalog/i });
  expect(status.querySelectorAll(".catalog-skeleton-card")).toHaveLength(8);
});
it("recovers a list image after fallback when refreshed results change its source", async () => {
  render(<MemoryRouter><CardsPage /></MemoryRouter>);
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([input]) =>
    String(input).includes("/cards?"),
  )).toHaveLength(2));
  await waitFor(() => expect(screen.queryByRole("status", { name: /searching the catalog/i })).not.toBeInTheDocument());
  const image = await screen.findByRole("img", { name: /wandering emperor card/i });
  fireEvent.error(image);
  expect(screen.getByRole("img", { name: /image unavailable for the wandering emperor/i })).toBeVisible();

  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/status")) return json({ ready: true, stale: false, source_updated_at: null, completed_at: null, counts: { sets: 1, oracle_cards: 1, printings: 1 } });
    if (url.includes("/sets")) return json({ items: [cardSet], page: 1, page_size: 200, total: 1, pages: 1 });
    return json({ items: [{ ...card, image_uris: { normal: "https://cards.scryfall.io/emperor-new.jpg" } }], page: 1, page_size: 25, total: 1, pages: 1 });
  });
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "refresh" } });
  await waitFor(() => expect(screen.getByRole("img", { name: /wandering emperor card/i })).toHaveAttribute(
    "src",
    "/api/v1/catalog/media?source=https%3A%2F%2Fcards.scryfall.io%2Femperor-new.jpg",
  ), { timeout: 1200 });
});
it("cancels a fast replaced search without showing a false error", async () => {
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/status")) return json({ ready: true, stale: false, source_updated_at: null, completed_at: null, counts: { sets: 1, oracle_cards: 1, printings: 1 } });
    if (url.includes("/sets")) return json({ items: [cardSet], page: 1, page_size: 200, total: 1, pages: 1 });
    if (url.includes("q=first")) return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    });
    if (url.includes("q=second")) return json({ items: [{ ...card, name: "Second result" }], page: 1, page_size: 25, total: 1, pages: 1 });
    return json({ items: [card], page: 1, page_size: 25, total: 1, pages: 1 });
  });
  render(<MemoryRouter><CardsPage /></MemoryRouter>);
  await screen.findByRole("heading", { name: card.name });
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "first" } });
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes("q=first"))).toBe(true), { timeout: 1200 });
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "second" } });
  expect(await screen.findByRole("heading", { name: "Second result" }, { timeout: 1200 })).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
