import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TradingPage } from "./TradingPage";

let tradingStatus: "active" | "suspended";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  tradingStatus = "active";
  vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal("fetch", vi.fn(async (input, init) => {
    const path = String(input);
    if (path.includes("/trading/account")) {
      return json({
        status: tradingStatus,
        active_strikes: tradingStatus === "suspended" ? 3 : 0,
        revision: 1,
        suspended_at: tradingStatus === "suspended" ? "2026-08-16T12:00:00Z" : null,
        support_email: "member-d6e70b32796e@example.invalid",
      });
    }
    if (path.startsWith("/api/v1/collection")) {
      return json({ items: [{ id: "ci1", quantity: 3, revision: 1, finish: "nonfoil", condition: "near_mint", card: { name: "Lightning Bolt", set: { code: "lea" }, collector_number: "161" } }], page: 1, page_size: 100, total: 1, pages: 1 });
    }
    if (path.includes("/trade-matches")) {
      return json({ items: [{ want_id: "w1", listing_id: "l2", member_display_name: "Trader Beta", printing_id: "p1", oracle_id: "o1", card_name: "Lightning Bolt", set_code: "lea", set_name: "Limited Edition Alpha", collector_number: "161", finish: "nonfoil", condition: "near_mint", available_quantity: 2 }], page: 1, page_size: 25, total: 1, pages: 1 });
    }
    if (path.startsWith("/api/v1/trades?")) {
      return json({ items: [{ id: "t1", collection_item_id: "ci1", printing_id: "p1", oracle_id: "o1", card_name: "Lightning Bolt", set_code: "lea", set_name: "Limited Edition Alpha", collector_number: "161", finish: "nonfoil", condition: "near_mint", owned_quantity: 3, quantity: 1, status: "active", revision: 1 }], page: 1, page_size: 100, total: 1, pages: 1 });
    }
    if (path.startsWith("/api/v1/wants?")) {
      return json({ items: [{ id: "w1", oracle_id: "o1", printing_id: null, finish: null, condition: null, quantity: 1, card_name: "Black Lotus", status: "active", revision: 1 }], page: 1, page_size: 100, total: 1, pages: 1 });
    }
    if (path === "/api/v1/trade-reports" && init?.method !== "POST") {
      return json([{ id: "r1", incident_reference: "WL-2026-0001", listing_id: "l2", reason: "spam", details: null, status: "open", revision: 1, created_at: "2026-08-15T12:00:00Z" }]);
    }
    if (init?.method === "POST") return json({ id: "new" }, 201);
    return json({ items: [], page: 1, page_size: 25, total: 0, pages: 0 });
  }));
});

afterEach(() => vi.unstubAllGlobals());

it("shows private match details without messaging or personal contact information", async () => {
  render(<MemoryRouter><TradingPage /></MemoryRouter>);
  expect(await screen.findByRole("heading", { name: /private trades/i })).toBeVisible();
  expect(await screen.findByText("Trader Beta")).toBeVisible();
  expect(screen.getByText(/limited edition alpha/i)).toBeVisible();
  expect(screen.queryByText(/email trader/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/message trader/i)).not.toBeInTheDocument();
  expect(screen.queryAllByText(/active trading strikes|WL-2026|appeal/i)).toHaveLength(0);
  expect(vi.mocked(fetch).mock.calls.some(([path]) =>
    String(path) === "/api/v1/trade-reports",
  )).toBe(false);
});

it("shows only a generic Account link when trading is suspended", async () => {
  tradingStatus = "suspended";
  render(<MemoryRouter><TradingPage /></MemoryRouter>);

  expect(await screen.findByRole("heading", { name: /trading is unavailable/i })).toBeVisible();
  expect(screen.getByRole("link", { name: /review trading status in account/i }))
    .toHaveAttribute("href", "/account");
  expect(screen.queryAllByText(/active trading strikes|WL-2026|appeal/i)).toHaveLength(0);
  expect(screen.getByRole("button", { name: /list card for trade/i })).toBeDisabled();
  expect(screen.getByRole("button", { name: /remove lightning bolt/i })).toBeDisabled();
  expect(screen.getByRole("button", { name: /remove wanted black lotus/i })).toBeDisabled();
  expect(screen.getByRole("button", { name: /report listing/i })).toBeDisabled();
});

it("offers an owned card and reports a compatible listing", async () => {
  render(<MemoryRouter><TradingPage /></MemoryRouter>);
  await screen.findByText("Trader Beta");
  fireEvent.change(screen.getByLabelText(/owned card/i), { target: { value: "ci1" } });
  fireEvent.click(screen.getByRole("button", { name: /list card for trade/i }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) =>
    String(url) === "/api/v1/trades" && init?.method === "POST",
  )).toBe(true));

  fireEvent.click(screen.getByRole("button", { name: /report listing/i }));
  fireEvent.change(screen.getByLabelText(/report reason/i), { target: { value: "spam" } });
  fireEvent.click(screen.getByRole("button", { name: /submit report/i }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) =>
    String(url) === "/api/v1/trade-reports" && init?.method === "POST",
  )).toBe(true));
});
