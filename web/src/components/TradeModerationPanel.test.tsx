import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TradeModerationPanel } from "./TradeModerationPanel";

const report = {
  id: "r1",
  incident_reference: "WL-ABC123",
  reporter_display_name: "Reporter",
  reported_user_id: "u2",
  reported_display_name: "Trader Beta",
  reported_trading_status: "active",
  reported_active_strikes: 1,
  reported_trading_revision: 2,
  listing_id: "l1",
  listing_revision: 4,
  reason: "spam",
  details: "Repeated false listing",
  status: "open",
  revision: 1,
  created_at: "2026-08-15T00:00:00Z",
};

beforeEach(() => {
  vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal("fetch", vi.fn(async (input, init) => {
    const path = String(input);
    if (init?.method === "POST" && path.includes("/reports/")) {
      return new Response(JSON.stringify({ ...report, status: "upheld", revision: 2 }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    if (init?.method === "POST") return new Response(null, { status: 204 });
    return new Response(JSON.stringify([report]), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }));
});

afterEach(() => vi.unstubAllGlobals());

it("lets owner or admin review reports, suspend trading, and deactivate ordinary members", async () => {
  render(<TradeModerationPanel />);
  expect(await screen.findByText("WL-ABC123")).toBeVisible();
  expect(screen.getByText("Trader Beta")).toBeVisible();
  expect(screen.getByText(/1 of 3 active strikes/i)).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: /uphold report/i }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) =>
    String(url).includes("/reports/r1") && init?.method === "POST",
  )).toBe(true));

  fireEvent.click(screen.getByRole("button", { name: /suspend trading/i }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) =>
    String(url).includes("/users/u2/trading") && init?.method === "POST",
  )).toBe(true));

  fireEvent.click(screen.getByRole("button", { name: /deactivate account/i }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) =>
    String(url).includes("/users/u2/account-status") && init?.method === "POST",
  )).toBe(true));
});

it("lets owner or admin void an upheld strike after an appeal", async () => {
  const upheld = {
    ...report,
    status: "upheld",
    revision: 2,
    strike_id: "s1",
    strike_revision: 1,
    strike_status: "active",
  };
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const path = String(input);
    if (init?.method === "POST" && path.includes("/strikes/s1/void")) {
      return new Response(JSON.stringify({
        status: "active", active_strikes: 0, revision: 3,
        suspended_at: null, support_email: "member-b0c073de2d44@example.invalid",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify([upheld]), {
      status: 200, headers: { "content-type": "application/json" },
    });
  });

  render(<TradeModerationPanel />);
  fireEvent.click(await screen.findByRole("button", { name: /void strike after appeal/i }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) =>
    String(url).includes("/strikes/s1/void") && init?.method === "POST",
  )).toBe(true));
});
