import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { HomePage } from "./HomePage";

const authState = vi.hoisted(() => ({ status: "authenticated" }));
vi.mock("../app/auth", () => ({ useAuth: () => ({ status: authState.status, user: null }) }));
vi.mock("../app/branding", () => ({ useBranding: () => ({ branding: {
  site_name: "WynterLabs", product_name: "CardVault", tagline: "Scan it. Sort it. Own it.",
} }) }));

beforeEach(() => {
  authState.status = "authenticated";
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [
    {
      kind: "card_added", occurred_at: "2026-09-02T12:00:00Z", display_name: "Collector",
      printing_id: "printing-1", card_name: "Sol Ring", set_name: "Commander", set_code: "CMM",
      collector_number: "396", image_uris: {}, game: "mtg", printing_count: null, set_count: null,
      released_at: null,
    },
    {
      kind: "catalog_updated", occurred_at: "2026-09-02T11:00:00Z", display_name: null,
      printing_id: null, card_name: null, set_name: null, set_code: null, collector_number: null,
      image_uris: {}, game: "pokemon", printing_count: 25000, set_count: 180, released_at: null,
    },
  ] }), { status: 200, headers: { "content-type": "application/json" } })));
});

afterEach(() => vi.unstubAllGlobals());

it("shows safe opted-in card and catalog activity to signed-in members", async () => {
  render(<MemoryRouter><HomePage /></MemoryRouter>);
  expect(await screen.findByRole("heading", { name: "What collectors are doing." })).toBeVisible();
  expect(await screen.findByRole("heading", { name: "Sol Ring" })).toBeVisible();
  expect(screen.getByText(/collector added commander/i)).toBeVisible();
  expect(screen.getByText(/25,000 printings across 180 sets/i)).toBeVisible();
});

it("does not request private activity for a signed-out visitor", async () => {
  authState.status = "unauthenticated";
  render(<MemoryRouter><HomePage /></MemoryRouter>);
  await waitFor(() => expect(fetch).not.toHaveBeenCalled());
  expect(screen.queryByRole("heading", { name: "What collectors are doing." })).not.toBeInTheDocument();
});

it("presents the completed V2.5 release and the focused V3 roadmap", () => {
  authState.status = "unauthenticated";
  render(<MemoryRouter><HomePage /></MemoryRouter>);
  expect(screen.getByRole("heading", { name: "V2.5 is ready." })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Custom cards" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Scanner workshop" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Solo tabletop practice" })).toBeVisible();
});
