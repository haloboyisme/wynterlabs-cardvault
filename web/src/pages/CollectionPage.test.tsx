import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  COLLECTION_DISPLAY_STORAGE_KEY,
  DEFAULT_COLLECTION_DISPLAY,
} from "../lib/collection-display";
import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
} from "../lib/appearance";
import type { CardSummary, CollectionItem } from "../lib/types";
import { CollectionPage } from "./CollectionPage";

const COLLECTION_SORT_STORAGE_KEY = "wynterlabs.cards.collection-sort.v1";

const card: CardSummary = {
  printing_id: "p1", oracle_id: "o1", name: "Lightning Bolt", mana_cost: "{R}",
  type_line: "Instant", set: { id: "s1", code: "lea", name: "Limited Edition Alpha", set_type: "core",
    released_at: "1993-08-05", card_count: 295, digital: false, icon_svg_uri: null, game: 'mtg' },
  collector_number: "161", rarity: "common", released_at: "1993-08-05", language: "en",
  layout: "normal", image_uris: {}, prices: { usd: "1.25", usd_foil: null }, finishes: ["nonfoil", "foil"], colors: ["R"], active: true,
};
const item: CollectionItem = {
  id: "i1", printing_id: "p1", finish: "nonfoil", condition: "near_mint",
  quantity: 2, revision: 3, created_at: "2026-08-14T00:00:00Z",
  updated_at: "2026-08-14T00:00:00Z", card,
};
const counterspell: CollectionItem = {
  ...item,
  id: "i2",
  printing_id: "p2",
  quantity: 4,
  card: {
    ...card,
    printing_id: "p2",
    oracle_id: "o2",
    name: "Counterspell",
    type_line: "Instant",
    set: { ...card.set, id: "s2", code: "isd", name: "Innistrad" },
    collector_number: "55",
    rarity: "uncommon",
    language: "jp",
    prices: { usd: "2.50", usd_foil: "7.00" },
  },
};
const headers = { "content-type": "application/json" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const page = (items = [item]) => ({ items, page: 1, page_size: 25, total: items.length, pages: items.length ? 1 : 0 });
const summary = (total = 2) => total === 0 ? {
  total_copies: 0, distinct_items: 0, distinct_oracle_cards: 0, distinct_sets: 0,
  estimated_value_usd: "0.00", priced_copies: 0, unpriced_copies: 0,
  price_snapshot_at: null,
  finishes: [], conditions: [], sets: [],
} : {
  total_copies: total, distinct_items: 1, distinct_oracle_cards: 1, distinct_sets: 1,
  estimated_value_usd: (total * 1.25).toFixed(2), priced_copies: total,
  unpriced_copies: 0, price_snapshot_at: "2026-08-16T12:00:00Z",
  finishes: [{ value: "nonfoil", copies: total }],
  conditions: [{ value: "near_mint", copies: total }],
  sets: [{ code: "lea", name: "Limited Edition Alpha", copies: total, distinct_items: 1 }],
};

beforeEach(() => {
  localStorage.removeItem(APPEARANCE_STORAGE_KEY);
  localStorage.removeItem(COLLECTION_SORT_STORAGE_KEY);
  vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/summary")) return json(summary());
    if (url.includes("/collection/items/")) return json({ ...item, quantity: 3, revision: 4 });
    return json(page());
  }));
});
afterEach(() => vi.unstubAllGlobals());
const view = () => render(<MemoryRouter><CollectionPage /></MemoryRouter>);
const openDetails = (name: string) => {
  fireEvent.click(screen.getByRole("button", { name: `Details for ${name}` }));
};
const selectionLabel = (entry: CollectionItem) =>
  `Select ${entry.card.name} — ${entry.card.set.name} (${entry.card.set.code.toUpperCase()}) #${entry.card.collector_number}, ${entry.finish === "nonfoil" ? "Nonfoil" : entry.finish.charAt(0).toUpperCase() + entry.finish.slice(1)}, ${entry.condition.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")}`;

it("renders summary, printing metadata, fallback, filters and exact page sizes", async () => {
  view();
  expect(screen.getByRole("status")).toHaveTextContent(/loading collection/i);
  expect(await screen.findByRole("heading", { name: "Lightning Bolt" })).toBeVisible();
  expect(screen.getByText(/2 total copies/i)).toBeVisible();
  expect(screen.getByText("Estimated value")).toBeVisible();
  expect(screen.getByText("$2.50")).toBeVisible();
  expect(screen.getByText(/2 of 2 copies priced/i)).toBeVisible();
  expect(screen.getByText(/prices from.*aug 16, 2026/i)).toBeVisible();
  expect(document.querySelectorAll(".collection-overview .workspace-stat")).toHaveLength(4);
  expect(screen.getByText(/limited edition alpha.*161.*EN/i)).toBeVisible();
  expect(document.querySelector(".collection-finish-badge")).toHaveTextContent("Nonfoil");
  expect(screen.getByRole("img", { name: /image unavailable for lightning bolt/i })).toBeVisible();
  expect(screen.getByText(/language: en/i)).toBeVisible();
  expect(screen.getByRole("link", { name: /import.*export csv/i })).toHaveAttribute(
    "href", "/collection/import",
  );
  const selector = screen.getByLabelText(/cards per page/i);
  expect(selector).toHaveValue("25");
  expect(Array.from(selector.querySelectorAll("option")).map((option) => option.value)).toEqual(["25", "50", "75", "100"]);
});

it("keeps primary filters visible and discloses secondary filters in Simple mode", async () => {
  localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({
    ...DEFAULT_APPEARANCE,
    complexity: "simple",
  }));
  view();

  await screen.findByRole("heading", { name: "Lightning Bolt" });
  const primary = document.querySelector(".collection-primary-filters");
  expect(primary).toContainElement(screen.getByLabelText("Search collection"));
  expect(primary).toContainElement(screen.getByLabelText("Set filter"));

  const disclosure = screen.getByText("Advanced collection filters").closest("details");
  expect(disclosure).not.toHaveAttribute("open");
  expect(screen.getByText("More collection stats").closest("details"))
    .not.toHaveAttribute("open");
  expect(disclosure).toContainElement(screen.getByLabelText("Finish filter"));
  expect(disclosure).toContainElement(screen.getByLabelText("Condition filter"));
  expect(disclosure).toContainElement(screen.getByLabelText("Sort"));
});

it("opens secondary Collection filters by default in Advanced mode", async () => {
  localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({
    ...DEFAULT_APPEARANCE,
    complexity: "advanced",
  }));
  view();

  await screen.findByRole("heading", { name: "Lightning Bolt" });
  expect(screen.getByText("Advanced collection filters").closest("details"))
    .toHaveAttribute("open");
  expect(screen.getByText("More collection stats").closest("details"))
    .toHaveAttribute("open");
});

it("keeps the game filter inside Advanced collection filters and serializes Magic without changing Auto totals", async () => {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/summary")) return json({
      ...summary(),
      sets: [{ code: "lea", name: "Limited Edition Alpha", copies: 2, distinct_items: 1, game: "mtg" }],
    });
    const requestedPage = Number(new URL(url, "https://local.test").searchParams.get("page") ?? "1");
    return json({ ...page(), page: requestedPage, total: 2, pages: 2 });
  });
  view();

  await screen.findByRole("heading", { name: "Lightning Bolt" });
  const advanced = screen.getByText("Advanced collection filters").closest("details");
  expect(advanced).toContainElement(screen.getByRole("combobox", { name: "Game or brand" }));
  expect(document.querySelector(".collection-primary-filters")).not.toContainElement(
    screen.getByRole("combobox", { name: "Game or brand" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Select cards" }));
  fireEvent.click(screen.getByRole("checkbox", { name: selectionLabel(item) }));
  expect(screen.getByRole("group", { name: "Selected collection actions" })).toHaveTextContent("1 selected");
  expect(screen.getByRole("button", { name: "Quick deck" })).toBeEnabled();

  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("Page 2 of 2");

  fireEvent.change(screen.getByRole("combobox", { name: "Game or brand" }), { target: { value: "mtg" } });
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => {
    const parameters = new URL(String(input), "https://local.test").searchParams;
    return parameters.get("game") === "mtg" && parameters.get("page") === "1";
  })).toBe(true));
  expect(screen.getAllByText("Game: Magic: The Gathering")).toHaveLength(2);
  expect(screen.getByRole("checkbox", { name: selectionLabel(item) })).toBeChecked();
  expect(screen.getByRole("button", { name: "Quick deck" })).toBeEnabled();
  expect(screen.getByText("Magic: The Gathering · Limited Edition Alpha")).toBeInTheDocument();

  fireEvent.change(screen.getByRole("combobox", { name: "Game or brand" }), { target: { value: "" } });
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => {
    const parameters = new URL(String(input), "https://local.test").searchParams;
    return parameters.get("page") === "1" && !parameters.has("game");
  })).toBe(true));
  expect(screen.getByText(/2 total copies/i)).toBeVisible();
  expect(screen.getByRole("checkbox", { name: selectionLabel(item) })).toBeChecked();
  expect(screen.getByRole("group", { name: "Selected collection actions" })).toHaveTextContent("1 selected");
  expect(screen.getByRole("button", { name: "Quick deck" })).toBeEnabled();
});

it("groups equal set codes by game in the collection summary", async () => {
  vi.mocked(fetch).mockImplementation(async (input) => {
    if (String(input).endsWith("/summary")) return json({
      ...summary(),
      distinct_sets: 2,
      sets: [
        { code: "base", name: "Base Set", copies: 2, distinct_items: 1, game: "pokemon" },
        { code: "base", name: "Legend of Blue Eyes", copies: 1, distinct_items: 1, game: "yugioh" },
      ],
    });
    return json(page());
  });
  view();
  await screen.findByRole("heading", { name: "Lightning Bolt" });
  fireEvent.click(screen.getByText("More collection stats"));
  expect(screen.getByText("Pokémon · Base Set")).toBeVisible();
  expect(screen.getByText("Yu-Gi-Oh! · Legend of Blue Eyes")).toBeVisible();
  expect(screen.getByRole("list", { name: "Cards by game" })).toHaveTextContent(
    "Pokémon2 copiesYu-Gi-Oh!1 copy",
  );
});

it("offers safe exact-printing marketplace research from expanded saved-card details", async () => {
  view();
  await screen.findByRole("heading", { name: "Lightning Bolt" });
  openDetails("Lightning Bolt");

  const tcgplayer = screen.getByRole("link", { name: "Search TCGplayer" });
  const ebay = screen.getByRole("link", { name: "Search eBay" });
  expect(tcgplayer).toHaveAttribute("href", expect.stringContaining("Lightning+Bolt"));
  expect(tcgplayer).toHaveAttribute("target", "_blank");
  expect(ebay).toHaveAttribute("rel", "noreferrer");
  expect(screen.getByText(/cardvault does not process the sale, payment, shipping, or seller contact/i))
    .toBeVisible();
});

it("offers global sort choices, remembers the choice, and reports active ordering", async () => {
  localStorage.setItem(COLLECTION_SORT_STORAGE_KEY, "price_desc");
  view();

  await screen.findByRole("heading", { name: "Lightning Bolt" });
  const selector = screen.getByLabelText("Sort");
  expect(selector).toHaveValue("price_desc");
  expect(Array.from(selector.querySelectorAll("option")).map((option) => [
    option.value,
    option.textContent,
  ])).toEqual([
    ["updated", "Recently updated"],
    ["created_desc", "Newest added"],
    ["created_asc", "Oldest added"],
    ["name", "Name A–Z"],
    ["name_desc", "Name Z–A"],
    ["quantity", "Highest quantity"],
    ["quantity_asc", "Lowest quantity"],
    ["price_desc", "Highest price"],
    ["price_asc", "Lowest price"],
    ["missing_price", "Missing prices first"],
  ]);
  expect(screen.getByRole("status")).toHaveTextContent(
    "1 matching item · Sorted by Highest price",
  );
  expect(vi.mocked(fetch).mock.calls.some(([input]) =>
    new URL(String(input), "https://local.test").searchParams.get("sort") === "price_desc",
  )).toBe(true);

  fireEvent.change(selector, { target: { value: "price_asc" } });
  await waitFor(() => expect(localStorage.getItem(COLLECTION_SORT_STORAGE_KEY)).toBe("price_asc"));
  expect(screen.getByRole("status")).toHaveTextContent("Sorted by Lowest price");
});

it("clears each derived filter chip independently and returns every clear to page one", async () => {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/summary")) return json({
      ...summary(3),
      sets: [{ code: "lea", name: "Alpha", copies: 3, distinct_items: 1 }],
    });
    const requestedPage = Number(new URL(url, "https://local.test").searchParams.get("page") ?? "1");
    return json({ ...page(), page: requestedPage, total: 3, pages: 2 });
  });
  view();

  await screen.findByRole("heading", { name: "Lightning Bolt" });
  fireEvent.change(screen.getByLabelText("Search collection"), { target: { value: "bolt" } });
  fireEvent.change(screen.getByLabelText("Set filter"), { target: { value: "lea" } });
  fireEvent.change(screen.getByLabelText("Finish filter"), { target: { value: "foil" } });
  fireEvent.change(screen.getByLabelText("Condition filter"), { target: { value: "near_mint" } });

  expect(await screen.findByText("Search: bolt")).toBeVisible();
  expect(await screen.findByText("Set: Alpha")).toBeVisible();
  expect(screen.getByText("Finish: Foil")).toBeVisible();
  expect(screen.getByText("Condition: Near mint")).toBeVisible();
  expect(screen.getByText("3 matching items · 4 active filters · Sorted by Recently updated"))
    .toBeVisible();

  async function goToPageTwo() {
    const callsBeforeNext = vi.mocked(fetch).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.slice(callsBeforeNext).some(([input]) =>
      new URL(String(input), "https://local.test").searchParams.get("page") === "2",
    )).toBe(true));
  }

  async function expectPageOneWithout(parameter: string, callsBeforeClear: number) {
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.slice(callsBeforeClear).some(([input]) => {
      const parameters = new URL(String(input), "https://local.test").searchParams;
      return parameters.get("page") === "1" && !parameters.has(parameter);
    })).toBe(true));
  }

  await goToPageTwo();
  let callsBeforeClear = vi.mocked(fetch).mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Clear Search" }));
  expect(screen.getByLabelText("Search collection")).toHaveValue("");
  expect(screen.getByLabelText("Set filter")).toHaveValue("lea");
  expect(screen.getByLabelText("Finish filter")).toHaveValue("foil");
  expect(screen.getByLabelText("Condition filter")).toHaveValue("near_mint");
  await expectPageOneWithout("q", callsBeforeClear);

  await goToPageTwo();
  callsBeforeClear = vi.mocked(fetch).mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Clear Set" }));
  expect(screen.getByLabelText("Set filter")).toHaveValue("");
  expect(screen.getByLabelText("Finish filter")).toHaveValue("foil");
  expect(screen.getByLabelText("Condition filter")).toHaveValue("near_mint");
  await expectPageOneWithout("set", callsBeforeClear);

  await goToPageTwo();
  callsBeforeClear = vi.mocked(fetch).mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Clear Finish" }));
  expect(screen.getByLabelText("Finish filter")).toHaveValue("");
  expect(screen.getByLabelText("Condition filter")).toHaveValue("near_mint");
  await expectPageOneWithout("finish", callsBeforeClear);

  await goToPageTwo();
  callsBeforeClear = vi.mocked(fetch).mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Clear Condition" }));
  expect(screen.getByLabelText("Condition filter")).toHaveValue("");
  await expectPageOneWithout("condition", callsBeforeClear);
});

it("keeps advanced filters through paging and clears one or all with feedback", async () => {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/summary")) return json(summary(3));
    const requestedPage = Number(new URL(url, "https://local.test").searchParams.get("page") ?? "1");
    return json({ ...page(), page: requestedPage, total: 3, pages: 2 });
  });
  view();

  await screen.findByRole("heading", { name: "Lightning Bolt" });
  fireEvent.change(screen.getByLabelText("Collector number filter"), {
    target: { value: "301" },
  });
  fireEvent.change(screen.getByLabelText("Rarity filter"), { target: { value: "rare" } });
  fireEvent.change(screen.getByLabelText("Price status filter"), {
    target: { value: "priced" },
  });

  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => {
    const parameters = new URL(String(input), "https://local.test").searchParams;
    return parameters.get("collector_number") === "301"
      && parameters.get("rarity") === "rare"
      && parameters.get("price_status") === "priced"
      && parameters.get("page") === "1";
  })).toBe(true));
  expect(screen.getByRole("status")).toHaveTextContent("3 active filters");
  expect(screen.getByText("Collector number: 301")).toBeVisible();
  expect(screen.getByText("Rarity: Rare")).toBeVisible();
  expect(screen.getByText("Price status: Priced")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => {
    const parameters = new URL(String(input), "https://local.test").searchParams;
    return parameters.get("collector_number") === "301"
      && parameters.get("rarity") === "rare"
      && parameters.get("price_status") === "priced"
      && parameters.get("page") === "2";
  })).toBe(true));

  fireEvent.click(screen.getByRole("button", { name: "Clear Rarity" }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => {
    const parameters = new URL(String(input), "https://local.test").searchParams;
    return parameters.get("page") === "1"
      && parameters.get("collector_number") === "301"
      && !parameters.has("rarity")
      && parameters.get("price_status") === "priced";
  })).toBe(true));

  fireEvent.click(screen.getByRole("button", { name: "Clear collection filters" }));
  expect(screen.getByLabelText("Collector number filter")).toHaveValue("");
  expect(screen.getByLabelText("Rarity filter")).toHaveValue("");
  expect(screen.getByLabelText("Price status filter")).toHaveValue("");
  expect(await screen.findByText("Collection filters cleared.")).toBeVisible();
});

it("serializes filters and resets to the chosen page size", async () => {
  view();
  await screen.findByRole("heading", { name: "Lightning Bolt" });
  fireEvent.change(screen.getByLabelText(/search collection/i), { target: { value: " bolt " } });
  fireEvent.change(screen.getByLabelText(/finish filter/i), { target: { value: "foil" } });
  fireEvent.change(screen.getByLabelText(/cards per page/i), { target: { value: "100" } });
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => {
    const url = String(input);
    return url.includes("q=bolt") && url.includes("finish=foil") && url.includes("page_size=100");
  })).toBe(true));
});

it("increments and edits with the displayed optimistic revision", async () => {
  view();
  await screen.findByRole("heading", { name: "Lightning Bolt" });
  openDetails("Lightning Bolt");
  fireEvent.click(screen.getByRole("button", { name: /increment lightning bolt/i }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([, init]) =>
    init?.method === "PUT" && String(init.body).includes('"quantity":3') && String(init.body).includes('"expected_revision":3'),
  )).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: /edit lightning bolt/i }));
  fireEvent.change(screen.getByLabelText(/quantity for lightning bolt/i), { target: { value: "7" } });
  fireEvent.change(screen.getByLabelText(/condition for lightning bolt/i), { target: { value: "lightly_played" } });
  fireEvent.click(screen.getByRole("button", { name: /save lightning bolt/i }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([, init]) =>
    init?.method === "PUT" && String(init.body).includes('"quantity":7') && String(init.body).includes('"condition":"lightly_played"'),
  )).toBe(true));
});

it("dismisses successful mutation feedback without clearing the last-good row", async () => {
  view();
  await screen.findByRole("heading", { name: "Lightning Bolt" });
  openDetails("Lightning Bolt");
  fireEvent.click(screen.getByRole("button", { name: /increment lightning bolt/i }));

  expect(await screen.findByText("Lightning Bolt quantity increased.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss message" }));

  expect(screen.queryByText("Lightning Bolt quantity increased.")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Lightning Bolt" })).toBeVisible();
});

it("confirms removal and uses the displayed revision", async () => {
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (String(input).endsWith("/summary")) return json(summary());
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return json(page());
  });
  view();
  await screen.findByRole("heading", { name: "Lightning Bolt" });
  openDetails("Lightning Bolt");
  fireEvent.click(screen.getByRole("button", { name: /remove lightning bolt/i }));
  expect(confirm).toHaveBeenCalled();
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input, init]) =>
    String(input).includes("expected_revision=3") && init?.method === "DELETE",
  )).toBe(true));
});

it("keeps last-good rows through a controlled stale conflict", async () => {
  view();
  await screen.findByRole("heading", { name: "Lightning Bolt" });
  openDetails("Lightning Bolt");
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (String(input).endsWith("/summary")) return json(summary());
    if (init?.method === "PUT") return json({ error: { code: "collection_item_stale", message: "Collection item has changed. Refresh and retry." } }, 409);
    return json(page());
  });
  fireEvent.click(screen.getByRole("button", { name: /increment lightning bolt/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/changed.*refreshed/i);
  expect(screen.getByRole("heading", { name: "Lightning Bolt" })).toBeVisible();
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([input, init]) =>
    String(input).includes("/api/v1/collection?") && !init?.method,
  ).length).toBeGreaterThan(1));
  expect(screen.getByRole("alert")).toHaveTextContent(/changed.*refreshed/i);
  fireEvent.click(screen.getByRole("button", { name: "Dismiss message" }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Lightning Bolt" })).toBeVisible();
});

it("provides empty and retryable initial error states", async () => {
  vi.mocked(fetch).mockImplementation(async (input) => String(input).endsWith("/summary")
    ? json(summary(0)) : json(page([])));
  const first = view();
  expect(await screen.findByText(/no cards match/i)).toBeVisible();
  first.unmount();
  vi.mocked(fetch).mockResolvedValue(json({ error: { message: "Collection unavailable." } }, 500));
  view();
  expect(await screen.findByRole("alert")).toHaveTextContent(/collection unavailable/i);
  expect(screen.getByRole("button", { name: /retry/i })).toBeVisible();
});

it("ignores a late superseded list response without showing an abort error", async () => {
  let resolveOld: ((response: Response) => void) | undefined;
  const newer = { ...item, id: "i2", card: { ...card, name: "New result" } };
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/summary")) return json(summary(1));
    if (url.includes("q=new")) return json({ ...page([newer]), total: 1 });
    return new Promise<Response>((resolve) => { resolveOld = resolve; });
  });
  view();
  await waitFor(() => expect(resolveOld).toBeTypeOf("function"));
  fireEvent.change(screen.getByLabelText(/search collection/i), { target: { value: "new" } });
  expect(await screen.findByRole("heading", { name: "New result" })).toBeVisible();
  resolveOld?.(json(page()));
  await Promise.resolve();
  expect(screen.queryByRole("heading", { name: "Lightning Bolt" })).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("keeps the newest summary when a mutation refresh supersedes an older request", async () => {
  let resolveOldSummary: ((response: Response) => void) | undefined;
  let summaryCalls = 0;
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/summary")) {
      summaryCalls += 1;
      if (summaryCalls === 1) return new Promise<Response>((resolve) => { resolveOldSummary = resolve; });
      return json(summary(99));
    }
    if (init?.method === "PUT") return json({ ...item, quantity: 3, revision: 4 });
    return json(page());
  });
  view();
  await screen.findByRole("heading", { name: "Lightning Bolt" });
  await waitFor(() => expect(resolveOldSummary).toBeTypeOf("function"));
  openDetails("Lightning Bolt");
  fireEvent.click(screen.getByRole("button", { name: /increment lightning bolt/i }));
  expect(await screen.findByText(/99 total copies/i)).toBeVisible();
  expect(screen.getByText("$123.75")).toBeVisible();
  resolveOldSummary?.(json(summary(1)));
  await Promise.resolve();
  expect(screen.getByText(/99 total copies/i)).toBeVisible();
  expect(screen.queryByText(/1 total copies/i)).not.toBeInTheDocument();
});

it("marks inactive printings and never links them to a dead detail route", async () => {
  const inactive = { ...item, card: { ...card, active: false } };
  vi.mocked(fetch).mockImplementation(async (input) => String(input).endsWith("/summary")
    ? json(summary())
    : json(page([inactive])));
  view();
  expect(await screen.findByText(/inactive printing/i)).toBeVisible();
  expect(screen.getByRole("heading", { name: "Lightning Bolt" })).toBeVisible();
  expect(screen.queryByRole("link", { name: /lightning bolt/i })).not.toBeInTheDocument();
});

it("requests both next and previous collection pages", async () => {
  vi.mocked(fetch).mockImplementation(async (input) => {
    if (String(input).endsWith("/summary")) return json(summary());
    const requested = new URL(String(input), "https://local.test").searchParams.get("page") ?? "1";
    return json({ ...page(), page: Number(requested), pages: 2, total: 2 });
  });
  view();
  await screen.findByRole("heading", { name: "Lightning Bolt" });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes("page=2"))).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes("page=1")).length).toBeGreaterThan(1));
});

it("preserves the last-good row and conflict alert after a stale delete refresh", async () => {
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (String(input).endsWith("/summary")) return json(summary());
    if (init?.method === "DELETE") return json({ error: { code: "collection_item_stale", message: "Collection item has changed. Refresh and retry." } }, 409);
    return json(page());
  });
  view();
  await screen.findByRole("heading", { name: "Lightning Bolt" });
  openDetails("Lightning Bolt");
  fireEvent.click(screen.getByRole("button", { name: /remove lightning bolt/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/changed.*refreshed/i);
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([input, init]) =>
    String(input).includes("/api/v1/collection?") && !init?.method,
  ).length).toBeGreaterThan(1));
  expect(screen.getByRole("alert")).toHaveTextContent(/changed.*refreshed/i);
  expect(screen.getByRole("heading", { name: "Lightning Bolt" })).toBeVisible();
});

it("shows whole-collection statistics and combines a complete Set filter with clear", async () => {
  vi.mocked(fetch).mockImplementation(async (input) => String(input).endsWith("/summary")
    ? json({
      total_copies: 8,
      distinct_items: 3,
      distinct_oracle_cards: 2,
      distinct_sets: 2,
      estimated_value_usd: "1234.56",
      priced_copies: 7,
      unpriced_copies: 1,
      price_snapshot_at: "2026-08-15T12:00:00Z",
      finishes: [
        { value: "nonfoil", copies: 5 },
        { value: "foil", copies: 3 },
      ],
      conditions: [
        { value: "near_mint", copies: 5 },
        { value: "lightly_played", copies: 3 },
      ],
      sets: [
        { code: "isd", name: "Innistrad", copies: 6, distinct_items: 2 },
        { code: "m10", name: "Magic 2010", copies: 2, distinct_items: 1 },
      ],
    })
    : json(page([item, counterspell])));
  view();

  expect(await screen.findByText(/8 total copies/i)).toBeVisible();
  expect(screen.getByText(/2 unique cards/i)).toBeVisible();
  expect(screen.getByText("$1,234.56")).toBeVisible();
  expect(screen.getByText(/7 of 8 copies priced.*1 unpriced/i)).toBeVisible();
  fireEvent.click(screen.getByText("More collection stats"));
  expect(screen.getByText(/2 sets/i)).toBeVisible();
  const extraStats = screen.getByText("More collection stats").closest("details");
  expect(extraStats).toHaveTextContent(/nonfoil.*5 copies/i);
  expect(extraStats).toHaveTextContent(/Innistrad.*6 copies/i);

  const setFilter = screen.getByLabelText("Set filter");
  expect(Array.from(setFilter.querySelectorAll("option")).map((option) => option.value))
    .toEqual(["", "isd", "m10"]);
  fireEvent.change(screen.getByLabelText(/search collection/i), { target: { value: "bolt" } });
  fireEvent.change(setFilter, { target: { value: "isd" } });
  fireEvent.change(screen.getByLabelText(/finish filter/i), { target: { value: "foil" } });
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => {
    const url = String(input);
    return url.includes("q=bolt") && url.includes("set=isd") && url.includes("finish=foil");
  })).toBe(true));

  const callsBeforeClear = vi.mocked(fetch).mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Clear collection filters" }));
  expect(screen.getByLabelText(/search collection/i)).toHaveValue("");
  expect(setFilter).toHaveValue("");
  expect(screen.getByLabelText(/finish filter/i)).toHaveValue("");
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(callsBeforeClear));
});

it("uses browser display choices and opens only one in-page card detail bubble", async () => {
  localStorage.setItem(COLLECTION_DISPLAY_STORAGE_KEY, JSON.stringify({
    ...DEFAULT_COLLECTION_DISPLAY,
    size: "small",
    showLanguage: false,
    showPrices: false,
  }));
  vi.mocked(fetch).mockImplementation(async (input) => String(input).endsWith("/summary")
    ? json({
      ...summary(6),
      distinct_items: 2,
      distinct_oracle_cards: 2,
      distinct_sets: 2,
      sets: [
        { code: "lea", name: "Limited Edition Alpha", copies: 2, distinct_items: 1 },
        { code: "isd", name: "Innistrad", copies: 4, distinct_items: 1 },
      ],
    })
    : json(page([item, counterspell])));
  view();

  await screen.findByRole("heading", { name: "Lightning Bolt" });
  const cards = screen.getByRole("list", { name: "Collection cards" });
  expect(cards).toHaveAttribute("data-view", "grid");
  expect(cards).toHaveAttribute("data-size", "small");
  expect(cards).toHaveAttribute("data-animate", "true");
  expect(screen.getByLabelText("2 copies")).toBeVisible();
  expect(screen.queryByText(/language: en/i)).not.toBeInTheDocument();
  expect(screen.queryByText("$1.25")).not.toBeInTheDocument();
  expect(document.querySelectorAll(".collection-overview .workspace-stat")).toHaveLength(4);
  expect(screen.getByText("Estimated value")).toBeVisible();
  expect(screen.getByText("Hidden")).toBeVisible();
  expect(screen.getByText(/enable prices in account/i)).toBeVisible();
  expect(screen.queryByText("$7.50")).not.toBeInTheDocument();

  const boltDetails = screen.getByRole("button", { name: "Details for Lightning Bolt" });
  fireEvent.click(boltDetails);
  expect(boltDetails).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("region", { name: "Lightning Bolt details" })).toBeVisible();

  const counterDetails = screen.getByRole("button", { name: "Details for Counterspell" });
  fireEvent.click(counterDetails);
  expect(counterDetails).toHaveAttribute("aria-expanded", "true");
  expect(boltDetails).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("region", { name: "Lightning Bolt details" }))
    .not.toBeInTheDocument();

  const next = {
    ...DEFAULT_COLLECTION_DISPLAY,
    view: "list",
    size: "large",
    showLanguage: true,
    showPrices: true,
    animateDetails: false,
  } as const;
  localStorage.setItem(COLLECTION_DISPLAY_STORAGE_KEY, JSON.stringify(next));
  fireEvent(window, new StorageEvent("storage", {
    key: COLLECTION_DISPLAY_STORAGE_KEY,
    newValue: JSON.stringify(next),
  }));
  await waitFor(() => expect(cards).toHaveAttribute("data-view", "list"));
  expect(cards).toHaveAttribute("data-size", "large");
  expect(cards).toHaveAttribute("data-animate", "false");
  expect(screen.getByText(/language: jp/i)).toBeVisible();
  expect(screen.getAllByText("$2.50").length).toBeGreaterThan(0);
  expect(screen.getByText(/estimated value/i)).toBeVisible();
});

it("retains selected card snapshots across filter loads and clears them when selection mode ends", async () => {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/summary")) return json(summary(6));
    const search = new URL(url, "https://local.test").searchParams.get("q");
    return json(page(search === "counter" ? [counterspell] : [item]));
  });
  view();

  await screen.findByRole("heading", { name: "Lightning Bolt" });
  fireEvent.click(screen.getByRole("button", { name: "Select cards" }));
  fireEvent.click(screen.getByRole("checkbox", { name: selectionLabel(item) }));
  expect(screen.getByRole("group", { name: "Selected collection actions" }))
    .toHaveTextContent("1 selected");
  expect(screen.queryByRole("toolbar", { name: "Selected collection actions" }))
    .not.toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Search collection"), { target: { value: "counter" } });
  await waitFor(() => expect(screen.queryByRole("heading", { name: "Lightning Bolt" }))
    .not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("checkbox", { name: selectionLabel(counterspell) }));
  expect(screen.getByRole("group", { name: "Selected collection actions" }))
    .toHaveTextContent("2 selected");

  fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
  expect(screen.getByRole("group", { name: "Selected collection actions" }))
    .toHaveTextContent("0 selected");
  fireEvent.click(screen.getByRole("button", { name: "Select page" }));
  expect(screen.getByRole("checkbox", { name: selectionLabel(counterspell) })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Quick deck" }));
  expect(screen.getByRole("form", { name: "Create quick deck" })).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "Done selecting" }));
  expect(screen.queryByRole("group", { name: "Selected collection actions" }))
    .not.toBeInTheDocument();
  expect(screen.queryByRole("form", { name: "Create quick deck" }))
    .not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox", { name: selectionLabel(counterspell) }))
    .not.toBeInTheDocument();
});

it("gives same-name collection rows distinct exact-printing checkbox names", async () => {
  const alternateBolt: CollectionItem = {
    ...item,
    id: "i4",
    printing_id: "p4",
    finish: "foil",
    condition: "lightly_played",
    card: {
      ...card,
      printing_id: "p4",
      set: { ...card.set, id: "s4", code: "m10", name: "Magic 2010" },
      collector_number: "146",
    },
  };
  vi.mocked(fetch).mockImplementation(async (input) => String(input).endsWith("/summary")
    ? json(summary(4))
    : json(page([item, alternateBolt])));
  view();

  await screen.findAllByRole("heading", { name: "Lightning Bolt" });
  fireEvent.click(screen.getByRole("button", { name: "Select cards" }));

  const alpha = screen.getByRole("checkbox", { name: selectionLabel(item) });
  const magic2010 = screen.getByRole("checkbox", { name: selectionLabel(alternateBolt) });
  expect(alpha).not.toBe(magic2010);
  expect(alpha).toHaveAccessibleName(
    "Select Lightning Bolt — Limited Edition Alpha (LEA) #161, Nonfoil, Near Mint",
  );
  expect(magic2010).toHaveAccessibleName(
    "Select Lightning Bolt — Magic 2010 (M10) #146, Foil, Lightly Played",
  );
});

it("creates a quick deck sequentially with one copy of each unique selected printing", async () => {
  const duplicateBolt = { ...item, id: "i3", finish: "foil", revision: 7 };
  const deck = {
    id: "d1", name: "Friday Cards", format: "commander", description: null,
    revision: 1, created_at: "2026-08-21T00:00:00Z", updated_at: "2026-08-21T00:00:00Z",
  };
  const deckCardBodies: string[] = [];
  let resolveFirstAdd!: (response: Response) => void;
  let firstAddResolved = false;
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/summary")) return json(summary(8));
    if (url === "/api/v1/decks" && init?.method === "POST") return json(deck, 201);
    if (url === "/api/v1/decks/d1/cards" && init?.method === "PUT") {
      deckCardBodies.push(String(init.body));
      if (deckCardBodies.length === 1) {
        return new Promise<Response>((resolve) => { resolveFirstAdd = resolve; });
      }
      expect(firstAddResolved).toBe(true);
      return json({ ...deck, cards: [] });
    }
    return json(page([item, duplicateBolt, counterspell]));
  });
  view();

  await screen.findByRole("heading", { name: "Counterspell" });
  fireEvent.click(screen.getByRole("button", { name: "Select cards" }));
  fireEvent.click(screen.getByRole("button", { name: "Select page" }));
  fireEvent.click(screen.getByRole("button", { name: "Quick deck" }));
  expect(screen.getByLabelText("Quick deck format")).toHaveValue("commander");
  expect(screen.getByLabelText("Quick deck name")).toBeRequired();
  fireEvent.change(screen.getByLabelText("Quick deck name"), { target: { value: "Friday Cards" } });
  fireEvent.click(screen.getByRole("button", { name: "Create quick deck" }));

  await waitFor(() => expect(deckCardBodies).toHaveLength(1));
  const createButton = screen.getByRole("button", { name: "Creating quick deck" });
  expect(createButton).toBeDisabled();
  fireEvent.click(createButton);
  expect(vi.mocked(fetch).mock.calls.filter(([input, init]) =>
    String(input) === "/api/v1/decks" && init?.method === "POST")).toHaveLength(1);
  firstAddResolved = true;
  resolveFirstAdd(json({ ...deck, cards: [] }));

  expect(await screen.findByText(/Friday Cards created with 2 unique cards/i)).toBeVisible();
  expect(screen.getByRole("link", { name: "View Friday Cards" })).toHaveAttribute("href", "/decks/d1");
  expect(screen.getByRole("group", { name: "Selected collection actions" }))
    .toHaveTextContent("0 selected");
  expect(deckCardBodies.map((body) => JSON.parse(body))).toEqual([
    { printing_id: "p1", section: "mainboard", quantity: 1 },
    { printing_id: "p2", section: "mainboard", quantity: 1 },
  ]);
  const createCall = vi.mocked(fetch).mock.calls.find(([input, init]) =>
    String(input) === "/api/v1/decks" && init?.method === "POST");
  expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
    name: "Friday Cards", game: "mtg", format: "commander", description: null,
  });
});

it("keeps every selection when quick deck creation fails", async () => {
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/summary")) return json(summary());
    if (url === "/api/v1/decks" && init?.method === "POST") {
      return json({ error: { message: "Deck creation is unavailable." } }, 503);
    }
    return json(page([item]));
  });
  view();

  await screen.findByRole("heading", { name: "Lightning Bolt" });
  fireEvent.click(screen.getByRole("button", { name: "Select cards" }));
  fireEvent.click(screen.getByRole("checkbox", { name: selectionLabel(item) }));
  fireEvent.click(screen.getByRole("button", { name: "Quick deck" }));
  fireEvent.change(screen.getByLabelText("Quick deck name"), { target: { value: "Retry Deck" } });
  fireEvent.click(screen.getByRole("button", { name: "Create quick deck" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Deck creation is unavailable.");
  expect(screen.getByRole("checkbox", { name: selectionLabel(item) })).toBeChecked();
  expect(screen.getByRole("group", { name: "Selected collection actions" }))
    .toHaveTextContent("1 selected");
});

it("keeps only failed printings selected after a partial quick deck", async () => {
  const deck = {
    id: "d2", name: "Partial Deck", format: "commander", description: null,
    revision: 1, created_at: "2026-08-21T00:00:00Z", updated_at: "2026-08-21T00:00:00Z",
  };
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/summary")) return json(summary(6));
    if (url === "/api/v1/decks" && init?.method === "POST") return json(deck, 201);
    if (url === "/api/v1/decks/d2/cards" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      return body.printing_id === "p2"
        ? json({ error: { message: "Counterspell could not be added." } }, 409)
        : json({ ...deck, cards: [] });
    }
    return json(page([item, counterspell]));
  });
  view();

  await screen.findByRole("heading", { name: "Lightning Bolt" });
  fireEvent.click(screen.getByRole("button", { name: "Select cards" }));
  fireEvent.click(screen.getByRole("button", { name: "Select page" }));
  fireEvent.click(screen.getByRole("button", { name: "Quick deck" }));
  fireEvent.change(screen.getByLabelText("Quick deck name"), { target: { value: "Partial Deck" } });
  fireEvent.click(screen.getByRole("button", { name: "Create quick deck" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(/1 of 2 unique cards could not be added/i);
  expect(screen.getByRole("link", { name: "View Partial Deck" })).toHaveAttribute("href", "/decks/d2");
  expect(screen.getByRole("checkbox", { name: selectionLabel(item) })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: selectionLabel(counterspell) })).toBeChecked();
  expect(screen.getByRole("group", { name: "Selected collection actions" }))
    .toHaveTextContent("1 selected");
});

it("removes selected rows with one confirmation and retains only failures", async () => {
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/summary")) return json(summary(6));
    if (init?.method === "DELETE" && url.includes("/collection/items/i1")) {
      return new Response(null, { status: 204 });
    }
    if (init?.method === "DELETE" && url.includes("/collection/items/i2")) {
      return json({ error: { message: "Counterspell changed. Try again." } }, 409);
    }
    return json(page([item, counterspell]));
  });
  view();

  await screen.findByRole("heading", { name: "Lightning Bolt" });
  const listCallsBefore = vi.mocked(fetch).mock.calls.filter(([input, init]) =>
    String(input).includes("/api/v1/collection?") && !init?.method).length;
  fireEvent.click(screen.getByRole("button", { name: "Select cards" }));
  fireEvent.click(screen.getByRole("button", { name: "Select page" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));

  expect(confirm).toHaveBeenCalledTimes(1);
  expect(confirm).toHaveBeenCalledWith("Remove 2 selected cards from your collection?");
  expect(await screen.findByRole("alert")).toHaveTextContent(/1 of 2 selected cards could not be removed/i);
  expect(screen.getByRole("checkbox", { name: selectionLabel(item) })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: selectionLabel(counterspell) })).toBeChecked();
  expect(vi.mocked(fetch).mock.calls.some(([input, init]) =>
    String(input).includes("/collection/items/i1?expected_revision=3") && init?.method === "DELETE")).toBe(true);
  expect(vi.mocked(fetch).mock.calls.some(([input, init]) =>
    String(input).includes("/collection/items/i2?expected_revision=3") && init?.method === "DELETE")).toBe(true);
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([input, init]) =>
    String(input).includes("/api/v1/collection?") && !init?.method).length)
    .toBe(listCallsBefore + 1));
});

it("reconciles a visible stale bulk-delete selection before retrying with the new revision", async () => {
  const refreshedCounterspell = { ...counterspell, revision: 4 };
  let listCalls = 0;
  const deleteUrls: string[] = [];
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/summary")) return json(summary(4));
    if (init?.method === "DELETE") {
      deleteUrls.push(url);
      if (url.includes("/collection/items/i1")) return new Response(null, { status: 204 });
      if (url.includes("expected_revision=3")) {
        return json({ error: { message: "Counterspell changed." } }, 409);
      }
      return new Response(null, { status: 204 });
    }
    listCalls += 1;
    return json(page(listCalls === 1 ? [item, counterspell] : [refreshedCounterspell]));
  });
  view();

  await screen.findByRole("heading", { name: "Counterspell" });
  fireEvent.click(screen.getByRole("button", { name: "Select cards" }));
  fireEvent.click(screen.getByRole("button", { name: "Select page" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(/1 of 2 selected cards could not be removed/i);
  await waitFor(() => expect(listCalls).toBe(2));
  expect(screen.getByRole("checkbox", { name: selectionLabel(refreshedCounterspell) })).toBeChecked();
  const retry = screen.getByRole("button", { name: "Remove selected" });
  expect(retry).toBeEnabled();
  fireEvent.click(retry);

  expect(await screen.findByText("1 selected card removed from your collection.")).toBeVisible();
  expect(deleteUrls).toEqual([
    "/api/v1/collection/items/i1?expected_revision=3",
    "/api/v1/collection/items/i2?expected_revision=3",
    "/api/v1/collection/items/i2?expected_revision=4",
  ]);
  expect(listCalls).toBe(3);
});

it("keeps a rejected revision blocked while reconciliation is pending despite reselection", async () => {
  const refreshedItem = { ...item, revision: 4 };
  let listCalls = 0;
  let resolveRefresh!: (response: Response) => void;
  const deleteUrls: string[] = [];
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/summary")) return json(summary(2));
    if (init?.method === "DELETE") {
      deleteUrls.push(url);
      return url.includes("expected_revision=3")
        ? json({ error: { message: "Lightning Bolt changed." } }, 409)
        : new Response(null, { status: 204 });
    }
    listCalls += 1;
    if (listCalls === 1) return json(page([item]));
    return new Promise<Response>((resolve) => { resolveRefresh = resolve; });
  });
  view();

  await screen.findByRole("heading", { name: "Lightning Bolt" });
  fireEvent.click(screen.getByRole("button", { name: "Select cards" }));
  const oldSnapshot = screen.getByRole("checkbox", { name: selectionLabel(item) });
  fireEvent.click(oldSnapshot);
  fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));

  await screen.findByRole("alert");
  await waitFor(() => expect(resolveRefresh).toBeTypeOf("function"));
  fireEvent.click(oldSnapshot);
  fireEvent.click(oldSnapshot);
  fireEvent.click(screen.getByRole("button", { name: "Select page" }));
  const blockedRemove = screen.getByRole("button", { name: "Remove selected" });
  expect(blockedRemove).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent(/successful reload or visit/i);
  fireEvent.click(blockedRemove);
  expect(deleteUrls).toEqual(["/api/v1/collection/items/i1?expected_revision=3"]);

  resolveRefresh(json(page([refreshedItem])));
  await waitFor(() => expect(screen.getByRole("button", { name: "Remove selected" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));
  expect(await screen.findByText("1 selected card removed from your collection.")).toBeVisible();
  expect(deleteUrls).toEqual([
    "/api/v1/collection/items/i1?expected_revision=3",
    "/api/v1/collection/items/i1?expected_revision=4",
  ]);
});

it("rejects a pre-conflict list response before the post-conflict refresh reconciles", async () => {
  const refreshedItem = { ...item, revision: 4 };
  let listCalls = 0;
  let resolvePreConflict!: (response: Response) => void;
  let resolvePostConflict!: (response: Response) => void;
  let resolveDelete!: (response: Response) => void;
  const deleteUrls: string[] = [];
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/summary")) return json(summary(2));
    if (init?.method === "DELETE") {
      deleteUrls.push(url);
      if (url.includes("expected_revision=4")) return new Response(null, { status: 204 });
      return new Promise<Response>((resolve) => { resolveDelete = resolve; });
    }
    listCalls += 1;
    if (listCalls === 1) return json(page([item]));
    if (listCalls === 2) {
      return new Promise<Response>((resolve) => { resolvePreConflict = resolve; });
    }
    return new Promise<Response>((resolve) => { resolvePostConflict = resolve; });
  });
  view();

  await screen.findByRole("heading", { name: "Lightning Bolt" });
  fireEvent.click(screen.getByRole("button", { name: "Select cards" }));
  fireEvent.click(screen.getByRole("checkbox", { name: selectionLabel(item) }));
  fireEvent.change(screen.getByLabelText("Search collection"), { target: { value: "pending" } });
  await waitFor(() => expect(resolvePreConflict).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));
  await waitFor(() => expect(resolveDelete).toBeTypeOf("function"));

  await act(async () => {
    resolveDelete(json({ error: { message: "Lightning Bolt changed." } }, 409));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    resolvePreConflict(json(page([item])));
    await Promise.resolve();
    await Promise.resolve();
  });

  await waitFor(() => expect(resolvePostConflict).toBeTypeOf("function"));
  expect(screen.getByRole("checkbox", { name: selectionLabel(item) })).toBeChecked();
  const blockedRemove = screen.getByRole("button", { name: "Remove selected" });
  expect(blockedRemove).toBeDisabled();
  fireEvent.click(blockedRemove);
  expect(deleteUrls).toEqual(["/api/v1/collection/items/i1?expected_revision=3"]);

  resolvePostConflict(json(page([refreshedItem])));
  await waitFor(() => expect(screen.getByRole("button", { name: "Remove selected" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));
  expect(await screen.findByText("1 selected card removed from your collection.")).toBeVisible();
  expect(deleteUrls).toEqual([
    "/api/v1/collection/items/i1?expected_revision=3",
    "/api/v1/collection/items/i1?expected_revision=4",
  ]);
});

it("preserves rejected revision evidence across a failed refresh and selection-mode resets", async () => {
  let listCalls = 0;
  const deleteUrls: string[] = [];
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/summary")) return json(summary(2));
    if (init?.method === "DELETE") {
      deleteUrls.push(url);
      return json({ error: { message: "Lightning Bolt changed." } }, 409);
    }
    listCalls += 1;
    return listCalls === 1
      ? json(page([item]))
      : json({ error: { message: "Collection reload failed." } }, 503);
  });
  view();

  await screen.findByRole("heading", { name: "Lightning Bolt" });
  fireEvent.click(screen.getByRole("button", { name: "Select cards" }));
  fireEvent.click(screen.getByRole("checkbox", { name: selectionLabel(item) }));
  fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));

  await screen.findByRole("alert");
  await waitFor(() => expect(listCalls).toBe(2));
  fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
  fireEvent.click(screen.getByRole("button", { name: "Select page" }));
  expect(screen.getByRole("button", { name: "Remove selected" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent(/successful reload or visit/i);
  fireEvent.click(screen.getByRole("button", { name: "Done selecting" }));
  fireEvent.click(screen.getByRole("button", { name: "Select cards" }));
  fireEvent.click(screen.getByRole("button", { name: "Select page" }));
  expect(screen.getByRole("button", { name: "Remove selected" })).toBeDisabled();
  expect(deleteUrls).toEqual(["/api/v1/collection/items/i1?expected_revision=3"]);
});

it("blocks retry for a hidden stale selection until a visible result refreshes its snapshot", async () => {
  const refreshedItem = { ...item, revision: 4 };
  let listCalls = 0;
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/summary")) return json(summary(4));
    if (init?.method === "DELETE") {
      return json({ error: { message: "Lightning Bolt changed." } }, 409);
    }
    listCalls += 1;
    const search = new URL(url, "https://local.test").searchParams.get("q");
    if (search === "bolt") return json(page([refreshedItem]));
    return json(page(listCalls === 1 ? [item] : [counterspell]));
  });
  view();

  await screen.findByRole("heading", { name: "Lightning Bolt" });
  fireEvent.click(screen.getByRole("button", { name: "Select cards" }));
  fireEvent.click(screen.getByRole("checkbox", { name: selectionLabel(item) }));
  fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    /1 of 1 selected cards could not be removed.*successful reload or visit/i,
  );
  await screen.findByRole("heading", { name: "Counterspell" });
  expect(screen.getByRole("button", { name: "Remove selected" })).toBeDisabled();
  expect(screen.getByRole("group", { name: "Selected collection actions" }))
    .toHaveTextContent("1 selected");

  fireEvent.change(screen.getByLabelText("Search collection"), { target: { value: "bolt" } });
  expect(await screen.findByRole("checkbox", { name: selectionLabel(refreshedItem) })).toBeChecked();
  expect(screen.getByRole("button", { name: "Remove selected" })).toBeEnabled();
});

it("clears selection and reports success after every selected row is removed", async () => {
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/summary")) return json(summary(6));
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return json(page([item, counterspell]));
  });
  view();

  await screen.findByRole("heading", { name: "Lightning Bolt" });
  fireEvent.click(screen.getByRole("button", { name: "Select cards" }));
  fireEvent.click(screen.getByRole("button", { name: "Select page" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));

  expect(await screen.findByText("2 selected cards removed from your collection.")).toBeVisible();
  expect(screen.getByRole("group", { name: "Selected collection actions" }))
    .toHaveTextContent("0 selected");
  expect(confirm).toHaveBeenCalledTimes(1);
});
