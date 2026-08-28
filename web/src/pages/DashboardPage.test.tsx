import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getCatalogStatus } from "../lib/catalog";
import { getCollection, getCollectionSummary, getCollectionValueHistory } from "../lib/collection";
import { listDecks } from "../lib/decks";
import type { CardSummary, CollectionItem, CollectionSummary, CollectionValueHistory, Deck } from "../lib/types";
import { DashboardPage } from "./DashboardPage";

const authState = vi.hoisted(() => ({ role: "owner" as "owner" | "admin" | "member" }));
vi.mock("../app/auth", () => ({
  useAuth: () => ({
    user: {
      id: "u1", email: "member-8026a0997359@example.invalid", display_name: "Aaron",
      role: authState.role, must_change_password: false, created_at: "2026-08-12T00:00:00Z",
    },
  }),
}));
vi.mock("../lib/catalog", () => ({ getCatalogStatus: vi.fn() }));
vi.mock("../lib/collection", () => ({ getCollection: vi.fn(), getCollectionSummary: vi.fn(), getCollectionValueHistory: vi.fn() }));
vi.mock("../lib/decks", () => ({ listDecks: vi.fn() }));

const set = {
  id: "s1", code: "lea", name: "Limited Edition Alpha", set_type: "core",
  released_at: "1993-08-05", card_count: 295, digital: false, icon_svg_uri: null,
    game: 'mtg',};
const card: CardSummary = {
  printing_id: "p1", oracle_id: "o1", name: "Lightning Bolt", mana_cost: "{R}",
  type_line: "Instant", set, collector_number: "161", rarity: "common",
  released_at: "1993-08-05", language: "en", layout: "normal", image_uris: {},
  prices: { usd: "3.50", usd_foil: null }, finishes: ["nonfoil"], colors: ["R"], active: true,
};
const collectionItem: CollectionItem = {
  id: "i1", printing_id: "p1", finish: "nonfoil", condition: "near_mint",
  quantity: 2, revision: 1, created_at: "2026-08-18T12:00:00Z",
  updated_at: "2026-08-19T12:00:00Z", card,
};
const summary: CollectionSummary = {
  total_copies: 12, distinct_items: 8, distinct_oracle_cards: 6, distinct_sets: 3,
  estimated_value_usd: "42.25", priced_copies: 10, unpriced_copies: 2,
  price_snapshot_at: "2026-08-18T12:00:00Z",
  finishes: [{ value: "nonfoil", copies: 9 }, { value: "foil", copies: 3 }],
  conditions: [{ value: "near_mint", copies: 10 }, { value: "lightly_played", copies: 2 }],
  sets: [
    { code: "lea", name: "Limited Edition Alpha", copies: 7, distinct_items: 4, game: "mtg" },
    { code: "neo", name: "Kamigawa: Neon Dynasty", copies: 5, distinct_items: 4, game: "mtg" },
  ],
};
const deck: Deck = {
  id: "d1", name: "Izzet Tempo", format: "modern", description: "Fast spells",
  revision: 2, created_at: "2026-08-17T12:00:00Z", updated_at: "2026-08-19T13:00:00Z",
};
const ready = {
  ready: true, stale: false, source_updated_at: "2026-08-18T00:00:00Z",
  completed_at: "2026-08-18T00:05:00Z", counts: { sets: 900, oracle_cards: 30000, printings: 100000 },
};
const valueHistory: CollectionValueHistory = {
  range: "month", current_value_usd: "42.25", change_usd: "2.25", change_percent: "5.62",
  priced_copies: 10, unpriced_copies: 2, total_copies: 12,
  points: [
    { timestamp: "2026-08-01T12:00:00Z", estimated_value_usd: "40.00", priced_copies: 10, unpriced_copies: 2, total_copies: 12, oldest_price_snapshot_at: "2026-08-01T00:00:00Z" },
    { timestamp: "2026-08-20T12:00:00Z", estimated_value_usd: "42.25", priced_copies: 10, unpriced_copies: 2, total_copies: 12, oldest_price_snapshot_at: "2026-08-18T12:00:00Z" },
  ],
};
const collectionPage = (items = [collectionItem]) => ({
  items, page: 1, page_size: 25, total: items.length, pages: items.length ? 1 : 0,
});

function loadPopulated() {
  vi.mocked(getCatalogStatus).mockResolvedValue(ready);
  vi.mocked(getCollectionSummary).mockResolvedValue(summary);
  vi.mocked(getCollectionValueHistory).mockResolvedValue(valueHistory);
  vi.mocked(getCollection).mockResolvedValue(collectionPage());
  vi.mocked(listDecks).mockResolvedValue({ items: [deck], total: 1 });
}

const view = () => render(<MemoryRouter><DashboardPage /></MemoryRouter>);

beforeEach(() => {
  authState.role = "owner";
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-08-20T14:00:00Z"));
  loadPopulated();
});
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

it("turns collection, card, and deck data into a useful command center", async () => {
  view();
  expect(screen.getByRole("heading", { level: 1, name: /good (morning|afternoon|evening), aaron/i })).toBeVisible();
  expect(await screen.findByText("$42.25", { selector: ".dashboard-value-metric strong" })).toBeVisible();
  expect(screen.getByText("12", { selector: "strong" })).toBeVisible();
  expect(screen.getByText("6", { selector: "strong" })).toBeVisible();
  expect(screen.getByText("3", { selector: "strong" })).toBeVisible();
  expect(screen.getByRole("heading", { name: /recent cards/i })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Lightning Bolt" })).toBeVisible();
  expect(screen.getByRole("heading", { name: /recent decks/i })).toBeVisible();
  expect(screen.getByRole("link", { name: /open izzet tempo/i })).toHaveAttribute("href", "/decks/d1");
  expect(screen.getByRole("link", { name: /scan/i })).toHaveAttribute("href", "/scan");
  expect(screen.getByRole("link", { name: /browse/i })).toHaveAttribute("href", "/cards");
  expect(screen.getByRole("link", { name: /import/i })).toHaveAttribute("href", "/collection/import");
  expect(screen.getByRole("link", { name: /decks/i })).toHaveAttribute("href", "/decks");
  expect(screen.getByRole("link", { name: /2 copies need pricing/i }))
    .toHaveAttribute("href", "/collection/pricing");
  expect(screen.getByText(/limited edition alpha/i)).toBeVisible();
});

it("shows finish mix and human-readable pricing freshness", async () => {
  view();
  await screen.findByText("$42.25", { selector: ".dashboard-value-metric strong" });
  const attention = screen.getByRole("heading", { name: /needs attention/i }).closest("article");
  expect(attention).not.toBeNull();
  expect(within(attention!).getByText("Nonfoil").closest("li")).toHaveTextContent(/9 copies/i);
  expect(within(attention!).getByText("Foil").closest("li")).toHaveTextContent(/3 copies/i);
  expect(within(attention!).getByText(/prices updated aug 18, 2026/i)).toHaveTextContent(/2 days ago/i);
});

it("states when pricing freshness is unavailable", async () => {
  vi.mocked(getCollectionSummary).mockResolvedValue({ ...summary, price_snapshot_at: null });
  view();
  expect(await screen.findByText(/price update time unavailable/i)).toBeVisible();
});

it("gives an empty collection a first-card pricing state instead of misleading quality claims", async () => {
  vi.mocked(getCollectionSummary).mockResolvedValue({
    ...summary, total_copies: 0, distinct_items: 0, distinct_oracle_cards: 0,
    distinct_sets: 0, estimated_value_usd: "0.00", priced_copies: 0,
    unpriced_copies: 0, price_snapshot_at: null, finishes: [], conditions: [], sets: [],
  });
  view();

  expect(await screen.findByText("No collection pricing yet")).toBeVisible();
  expect(screen.getByText(/add a card or import a collection to begin pricing checks/i)).toBeVisible();
  expect(screen.queryByText("Pricing coverage complete")).not.toBeInTheDocument();
  expect(screen.queryByText(/price update time unavailable/i)).not.toBeInTheDocument();
});

it("shows an accessible monthly estimated-value chart and switches the selected range", async () => {
  view();

  expect(await screen.findByRole("heading", { name: /collection value history/i })).toBeVisible();
  expect(screen.getByRole("button", { name: "Month" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("img", { name: /estimated collection value over the last month/i })).toBeVisible();
  expect(screen.getByText(/estimated collection value increased by \$2\.25 \(5\.62%\)/i)).toBeVisible();
  expect(screen.getByText(/10 of 12 copies priced; 2 copies are unpriced/i)).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "Quarter" }));
  await waitFor(() => expect(getCollectionValueHistory).toHaveBeenLastCalledWith("quarter", expect.any(AbortSignal)));
  expect(screen.getByRole("button", { name: "Quarter" })).toHaveAttribute("aria-pressed", "true");
});

it("keeps the dashboard useful when value history is unavailable and retries only that widget", async () => {
  vi.mocked(getCollectionValueHistory).mockRejectedValueOnce(new Error("offline"));
  view();

  expect(await screen.findByRole("alert", { name: /collection value history unavailable/i })).toHaveTextContent(/could not be loaded/i);
  expect(screen.getByText("$42.25", { selector: ".dashboard-value-metric strong" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /retry value history/i }));
  expect(await screen.findByRole("img", { name: /estimated collection value over the last month/i })).toBeVisible();
  expect(getCollectionValueHistory).toHaveBeenCalledTimes(2);
  expect(getCollectionSummary).toHaveBeenCalledTimes(1);
});

it("explains when no history exists without manufacturing a change", async () => {
  vi.mocked(getCollectionValueHistory).mockResolvedValue({ ...valueHistory, points: [], current_value_usd: "0.00", change_usd: "0.00", change_percent: null, priced_copies: 0, unpriced_copies: 0, total_copies: 0 });
  view();

  expect(await screen.findByText(/no collection value history yet/i)).toBeVisible();
  expect(screen.getByText(/value history will appear after collection activity or a price refresh/i)).toBeVisible();
  expect(screen.queryByText(/estimated collection value increased/i)).not.toBeInTheDocument();
});

it("treats legacy value history without points as empty history", async () => {
  const { points: _points, ...legacyValueHistory } = valueHistory;
  vi.mocked(getCollectionValueHistory).mockResolvedValue(legacyValueHistory as unknown as CollectionValueHistory);
  view();

  expect(await screen.findByText(/no collection value history yet/i)).toBeVisible();
  expect(screen.queryByRole("img", { name: /estimated collection value over/i })).not.toBeInTheDocument();
});

it("aborts every independent dashboard request when unmounted", async () => {
  vi.mocked(getCatalogStatus).mockReturnValue(new Promise<never>(() => undefined));
  vi.mocked(getCollectionSummary).mockReturnValue(new Promise<never>(() => undefined));
  vi.mocked(getCollection).mockReturnValue(new Promise<never>(() => undefined));
  vi.mocked(listDecks).mockReturnValue(new Promise<never>(() => undefined));
  vi.mocked(getCollectionValueHistory).mockReturnValue(new Promise<never>(() => undefined));
  const rendered = view();
  await waitFor(() => expect(getCollectionValueHistory).toHaveBeenCalledTimes(1));
  const signals = [
    vi.mocked(getCatalogStatus).mock.calls[0][0],
    vi.mocked(getCollectionSummary).mock.calls[0][0],
    vi.mocked(getCollection).mock.calls[0][1],
    vi.mocked(listDecks).mock.calls[0][0],
    vi.mocked(getCollectionValueHistory).mock.calls[0][1],
  ];
  rendered.unmount();
  expect(signals).toHaveLength(5);
  for (const signal of signals) expect(signal?.aborted).toBe(true);
});

it("keeps healthy widgets visible and retries only a failed recent-cards widget", async () => {
  vi.mocked(getCollection).mockRejectedValueOnce(new Error("offline"));
  view();
  expect(await screen.findByText("$42.25", { selector: ".dashboard-value-metric strong" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Izzet Tempo" })).toBeVisible();
  const alert = screen.getByRole("alert", { name: /recent cards unavailable/i });
  expect(alert).toHaveTextContent(/could not load recent cards/i);
  fireEvent.click(screen.getByRole("button", { name: /retry recent cards/i }));
  expect(await screen.findByRole("heading", { name: "Lightning Bolt" })).toBeVisible();
  expect(getCollectionSummary).toHaveBeenCalledTimes(1);
  expect(listDecks).toHaveBeenCalledTimes(1);
  expect(getCollection).toHaveBeenCalledTimes(2);
});

it("gives an empty workspace a first-use checklist instead of empty metrics", async () => {
  vi.mocked(getCollectionSummary).mockResolvedValue({
    ...summary, total_copies: 0, distinct_items: 0, distinct_oracle_cards: 0,
    distinct_sets: 0, estimated_value_usd: "0.00", priced_copies: 0,
    unpriced_copies: 0, price_snapshot_at: null, finishes: [], conditions: [], sets: [],
  });
  vi.mocked(getCollection).mockResolvedValue(collectionPage([]));
  vi.mocked(listDecks).mockResolvedValue({ items: [], total: 0 });
  view();
  const checklist = await screen.findByRole("region", { name: /get started/i });
  expect(checklist).toHaveTextContent(/scan your first card/i);
  expect(checklist).toHaveTextContent(/import an existing collection/i);
  expect(checklist).toHaveTextContent(/create your first deck/i);
});

it.each(["owner", "admin"] as const)("shows the administration shortcut to a %s", async (role) => {
  authState.role = role;
  view();
  expect(await screen.findByRole("link", { name: /administration/i })).toHaveAttribute("href", "/admin");
});

it("does not show the administration shortcut to a member", async () => {
  authState.role = "member";
  view();
  await screen.findByText("$42.25", { selector: ".dashboard-value-metric strong" });
  expect(screen.queryByRole("link", { name: /administration/i })).not.toBeInTheDocument();
});

describe("truthful catalog availability", () => {
  it("reports the ready catalog", async () => {
    view();
    expect(await screen.findByRole("status", { name: /catalog status/i })).toHaveTextContent(/^catalog ready$/i);
  });

  it("reports stale data without hiding available browse tools", async () => {
    vi.mocked(getCatalogStatus).mockResolvedValue({ ...ready, stale: true });
    view();
    expect(await screen.findByRole("status", { name: /catalog status/i })).toHaveTextContent(/refresh recommended/i);
    expect(screen.getByRole("link", { name: /browse/i })).toHaveAttribute("href", "/cards");
  });

  it("reports an unavailable check without claiming the catalog is ready", async () => {
    vi.mocked(getCatalogStatus).mockRejectedValue(new Error("offline"));
    view();
    const status = await screen.findByRole("status", { name: /catalog status/i });
    expect(status).toHaveTextContent(/status unavailable/i);
    expect(status).not.toHaveTextContent(/^catalog ready$/i);
  });
});

it("uses the shared safe card-image fallback for recent cards", async () => {
  view();
  expect(await screen.findByRole("img", { name: /image unavailable for lightning bolt/i })).toBeVisible();
});

it("marks every inline dashboard action as a consistent touch target", async () => {
  view();
  await screen.findByText("$42.25", { selector: ".dashboard-value-metric strong" });
  const inlineActions = [
    screen.getByRole("link", { name: /view collection/i }),
    ...screen.getAllByRole("link", { name: /see all/i }),
  ];
  expect(inlineActions).toHaveLength(3);
  for (const action of inlineActions) expect(action).toHaveClass("dashboard-inline-action");
});

it("keeps dashboard widgets touch-friendly, responsive, and motion-safe", () => {
  const css = readFileSync("src/styles/global.css", "utf8");
  expect(css).toMatch(/\.dashboard-quick-actions[^}]*grid-template-columns:/s);
  expect(css).toMatch(/\.dashboard-quick-actions a[^}]*min-height:\s*44px/s);
  expect(css).toMatch(/\.dashboard-widget-retry[^}]*min-height:\s*44px/s);
  expect(css).toMatch(/\.dashboard-inline-action[^}]*min-height:\s*44px/s);
  expect(css).toMatch(/\.dashboard :where\(a, button\):focus-visible[^}]*outline:\s*3px solid var\(--focus\)/s);
  const mobile = css.match(/@media \(max-width: 640px\)[\s\S]*$/)?.[0] ?? "";
  expect(mobile).toMatch(/\.dashboard-metric-strip[^}]*grid-template-columns:\s*repeat\(2,\s*1fr\)/s);
  expect(mobile).toMatch(/\.dashboard-content-grid[^}]*grid-template-columns:\s*1fr/s);
  expect(mobile).toMatch(/\.dashboard-section-heading,\s*\.dashboard-widget-heading[^}]*flex-wrap:\s*wrap/s);
  const reduced = css.match(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\n\}/)?.[0] ?? "";
  expect(reduced).toMatch(/animation:\s*none\s*!important/);
});
