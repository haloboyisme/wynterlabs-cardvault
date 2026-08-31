import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, vi } from "vitest";

import { App } from "./App";

const emptyDashboardSummary = {
  total_copies: 0,
  distinct_items: 0,
  distinct_oracle_cards: 0,
  distinct_sets: 0,
  estimated_value_usd: "0.00",
  priced_copies: 0,
  unpriced_copies: 0,
  price_snapshot_at: null,
  finishes: [],
  conditions: [],
  sets: [],
};

function dashboardDataResponse(url: string, headers: HeadersInit) {
  let body: unknown;
  if (url.endsWith("/api/v1/collection/summary")) {
    body = emptyDashboardSummary;
  } else if (url.includes("/api/v1/collection?")) {
    body = { items: [], page: 1, page_size: 25, total: 0, pages: 0 };
  } else if (url.endsWith("/api/v1/decks")) {
    body = { items: [], total: 0 };
  } else {
    return undefined;
  }
  return new Response(JSON.stringify(body), { status: 200, headers });
}


function renderAt(path: string) {
  window.history.pushState({}, "", path);
  return render(<App />);
}


beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v1/auth/me")) {
        return new Response(
          JSON.stringify({
            error: {
              code: "not_authenticated",
              message: "Sign in to continue.",
              fields: null,
              request_id: "test-request",
            },
          }),
          { status: 401, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ available: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});


afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0, writable: true });
  vi.unstubAllGlobals();
});


it("renders the WynterLabs product homepage", async () => {
  renderAt("/");
  expect(
    screen.getByRole("heading", { name: /scan it\. sort it\. own your collection/i }),
  ).toBeVisible();
  expect(screen.getByText(/private card workspace built for real collections/i)).toBeVisible();
  const heroActions = within(document.querySelector(".hero-actions") as HTMLElement);
  expect(heroActions.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  expect(heroActions.getByRole("link", { name: /see what is new/i })).toHaveAttribute("href", "#whats-new");

  const quickActions = screen.getByRole("navigation", { name: /explore wynterlabs cardvault/i });
  expect(within(quickActions).getByRole("link", { name: /browse cards/i })).toHaveAttribute("href", "/cards");
  expect(within(quickActions).getByRole("link", { name: /scan cards/i })).toHaveAttribute("href", "/scan");
  expect(screen.getByRole("heading", { name: /what's new in your workspace/i })).toBeVisible();
  expect(screen.getByRole("heading", { name: /built in public, released with care/i })).toBeVisible();
  expect(screen.getByText(/marketplace planning/i)).toBeVisible();
  expect(screen.getByText(/trading stays paused/i)).toBeVisible();
  expect(screen.queryByText("Private trading")).not.toBeInTheDocument();
  expect(screen.queryByText(/Phase 2/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Phase 5/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Phase 6/i)).not.toBeInTheDocument();
  expect(within(document.querySelector(".site-footer") as HTMLElement).getByText("WynterLabs CardVault")).toBeVisible();
  expect(document.body.textContent).not.toContain("�");
  await waitFor(() => expect(fetch).toHaveBeenCalled());
});


it("hides the header after eighteen idle seconds while the page is scrolled", async () => {
  renderAt("/");
  await screen.findByRole("heading", { name: /scan it\. sort it\. own your collection/i });
  const header = screen.getByRole("banner");
  Object.defineProperty(window, "scrollY", { configurable: true, value: 240, writable: true });
  vi.useFakeTimers();

  fireEvent.scroll(window);
  act(() => vi.advanceTimersByTime(17_999));
  expect(header).not.toHaveClass("is-idle-hidden");

  act(() => vi.advanceTimersByTime(1));
  expect(header).toHaveClass("is-idle-hidden");
});


it("reveals an idle-hidden header when the pointer reaches the top edge", async () => {
  renderAt("/");
  await screen.findByRole("heading", { name: /scan it\. sort it\. own your collection/i });
  const header = screen.getByRole("banner");
  Object.defineProperty(window, "scrollY", { configurable: true, value: 240, writable: true });
  vi.useFakeTimers();

  fireEvent.scroll(window);
  act(() => vi.advanceTimersByTime(18_000));
  expect(header).toHaveClass("is-idle-hidden");

  fireEvent.mouseMove(window, { clientY: 2 });
  expect(header).not.toHaveClass("is-idle-hidden");
});


it("keeps the scrolled header visible while hovered and restarts the timer on leave", async () => {
  renderAt("/");
  await screen.findByRole("heading", { name: /scan it\. sort it\. own your collection/i });
  const header = screen.getByRole("banner");
  Object.defineProperty(window, "scrollY", { configurable: true, value: 240, writable: true });
  vi.useFakeTimers();

  fireEvent.scroll(window);
  fireEvent.mouseEnter(header);
  act(() => vi.advanceTimersByTime(20_000));
  expect(header).not.toHaveClass("is-idle-hidden");

  fireEvent.mouseLeave(header);
  act(() => vi.advanceTimersByTime(18_000));
  expect(header).toHaveClass("is-idle-hidden");
});


it("reveals the hidden header for keyboard navigation", async () => {
  renderAt("/");
  await screen.findByRole("heading", { name: /scan it\. sort it\. own your collection/i });
  const header = screen.getByRole("banner");
  Object.defineProperty(window, "scrollY", { configurable: true, value: 240, writable: true });
  vi.useFakeTimers();

  fireEvent.scroll(window);
  act(() => vi.advanceTimersByTime(18_000));
  expect(header).toHaveClass("is-idle-hidden");

  fireEvent.keyDown(window, { key: "Tab" });
  expect(header).not.toHaveClass("is-idle-hidden");
});


it("reveals the hidden header from a touch at the top edge", async () => {
  renderAt("/");
  await screen.findByRole("heading", { name: /scan it\. sort it\. own your collection/i });
  const header = screen.getByRole("banner");
  Object.defineProperty(window, "scrollY", { configurable: true, value: 240, writable: true });
  vi.useFakeTimers();

  fireEvent.scroll(window);
  act(() => vi.advanceTimersByTime(18_000));
  expect(header).toHaveClass("is-idle-hidden");

  fireEvent.touchStart(window, { touches: [{ clientY: 2 }] });
  expect(header).not.toHaveClass("is-idle-hidden");
});


it("gives a signed-in member direct Home shortcuts and identity feedback", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith("/api/v1/auth/me")) {
      return new Response(JSON.stringify({
        id: "member-id", email: "member-ea28fda2ddaf@example.invalid", display_name: "Winter Collector",
        role: "member", created_at: "2026-08-20T00:00:00Z",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
  }));

  renderAt("/");

  expect(await screen.findByText("Winter Collector", { selector: ".header-account-name" })).toBeVisible();
  expect(screen.getByText("Member workspace", { selector: ".header-account-role" })).toBeVisible();
  const heroActions = within(document.querySelector(".hero-actions") as HTMLElement);
  expect(heroActions.getByRole("link", { name: /open dashboard/i })).toHaveAttribute("href", "/dashboard");
  expect(heroActions.getByRole("link", { name: /scan a card/i })).toHaveAttribute("href", "/scan");
});


it("renders the owner login route", async () => {
  renderAt("/login");
  expect(screen.getByRole("heading", { name: /welcome back/i })).toBeVisible();
  await waitFor(() => expect(fetch).toHaveBeenCalled());
});

it("keeps one-time setup copy host-neutral", async () => {
  renderAt("/setup");
  expect(await screen.findByText(/bootstrap secret stays on this server/i)).toBeVisible();
  expect(document.body.textContent).not.toContain("dblite");
});


it("redirects an unauthenticated dashboard visitor to login", async () => {
  renderAt("/dashboard");
  expect(await screen.findByRole("heading", { name: /welcome back/i })).toBeVisible();
});
it("redirects an unauthenticated cards visitor to login", async () => {
  renderAt("/cards");
  expect(await screen.findByRole("heading", { name: /welcome back/i })).toBeVisible();
});
it("redirects an unauthenticated collection visitor to login", async () => {
  renderAt("/collection");
  expect(await screen.findByRole("heading", { name: /welcome back/i })).toBeVisible();
});
it("redirects an unauthenticated collection import visitor to login", async () => {
  renderAt("/collection/import");
  expect(await screen.findByRole("heading", { name: /welcome back/i })).toBeVisible();
});

it("lets a signed-in member research and fill a missing collection price", async () => {
  const user = userEvent.setup();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = { "content-type": "application/json" };
    if (url.endsWith("/api/v1/auth/me")) {
      return new Response(JSON.stringify({
        id: "member-id", email: "member-a74e32d5bb65@example.invalid", display_name: "Collector",
        role: "member", created_at: "2026-08-20T00:00:00Z", must_change_password: false,
      }), { status: 200, headers });
    }
    if (url.includes("/api/v1/collection/pricing/missing?")) {
      return new Response(JSON.stringify({
        items: [{
          id: "i1", printing_id: "p1", finish: "foil", condition: "near_mint",
          quantity: 2, revision: 1, manual_price_usd: null,
          source_uri: "https://scryfall.com/card/lea/161/lightning-bolt",
          card: {
            printing_id: "p1", oracle_id: "o1", name: "Lightning Bolt", mana_cost: "{R}",
            type_line: "Instant", collector_number: "161", rarity: "common",
            released_at: "1993-08-05", language: "en", layout: "normal", image_uris: {},
            prices: { usd: "3.50", usd_foil: null }, finishes: ["nonfoil", "foil"],
            colors: ["R"], active: true,
            set: { id: "s1", code: "LEA", name: "Limited Edition Alpha", set_type: "core", released_at: "1993-08-05", card_count: 295, digital: false, icon_svg_uri: null, game: 'mtg' },
          },
        }],
        page: 1, page_size: 25, total: 1, pages: 1,
      }), { status: 200, headers });
    }
    if (url.endsWith("/api/v1/collection/pricing/items/i1") && init?.method === "PUT") {
      return new Response(JSON.stringify({ manual_price_usd: "4.25", revision: 2 }), {
        status: 200, headers,
      });
    }
    return new Response(JSON.stringify({}), { status: 200, headers });
  }));

  renderAt("/collection/pricing");
  expect(await screen.findByRole("heading", { name: /cards needing prices/i })).toBeVisible();
  expect(await screen.findByRole("link", { name: /find a price for lightning bolt/i }))
    .toHaveAttribute("href", "/cards/p1");
  await user.type(screen.getByLabelText(/manual usd price per copy for lightning bolt/i), "4.25");
  await user.click(screen.getByRole("button", { name: /save price for lightning bolt/i }));
  expect(await screen.findByText(/price saved.*collection totals updated/i)).toBeVisible();
  expect(screen.getByText(/every copy in this collection has a price/i)).toBeVisible();
});

it("does not expose the paused member trading route", async () => {
  renderAt("/trades");
  expect(await screen.findByRole("heading", { name: /this card is not in the deck/i })).toBeVisible();
  expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("/api/v1/trades"), expect.anything());
});

it("shows Cards navigation and catalog to an authenticated owner", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const headers = { "content-type": "application/json" };
    if (url.endsWith("/api/v1/auth/me")) return new Response(JSON.stringify({
      id: "owner-id", email: "member-752e2e7c31a1@example.invalid", display_name: "Owner",
      role: "owner", created_at: "2026-08-12T00:00:00Z",
    }), { status: 200, headers });
    if (url.includes("/catalog/status")) return new Response(JSON.stringify({
      ready: false, stale: false, source_updated_at: null, completed_at: null,
      counts: { sets: 0, oracle_cards: 0, printings: 0 },
    }), { status: 200, headers });
    if (url.includes("/catalog/sets")) return new Response(JSON.stringify({
      items: [], page: 1, page_size: 200, total: 0, pages: 0,
    }), { status: 200, headers });
    return new Response(JSON.stringify({}), { status: 200, headers });
  }));
  renderAt("/cards");
  expect(await screen.findByRole("heading", { name: /card catalog/i })).toBeVisible();
  const cardsLink = screen.getByRole("link", { name: "Cards" });
  expect(cardsLink).toHaveAttribute("href", "/cards");
  expect(cardsLink).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: /skip to content/i })).toHaveAttribute("href", "#main");
  const navigation = screen.getByRole("navigation", { name: /primary navigation/i });
  expect(navigation).toHaveClass("primary-nav");
  const enabledRoutes = [
    ["Home", "/"],
    ["Dashboard", "/dashboard"],
    ["Cards", "/cards"],
    ["Collection", "/collection"],
    ["Scan", "/scan"],
    ["Decks", "/decks"],
    ["Account", "/account"],
    ["Admin", "/admin"],
  ] as const;
  for (const [name, href] of enabledRoutes) {
    expect(within(navigation).getByRole("link", { name })).toHaveAttribute("href", href);
  }
  expect(screen.queryByRole("link", { name: "Trades" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign out" })).toBeVisible();
});

it("presents the scanner but not paused member trading as a dashboard tool", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const headers = { "content-type": "application/json" };
    if (url.endsWith("/api/v1/auth/me")) return new Response(JSON.stringify({
      id: "owner-id", email: "member-a1a3be47b8b2@example.invalid", display_name: "Owner",
      role: "owner", created_at: "2026-08-12T00:00:00Z",
    }), { status: 200, headers });
    if (url.includes("/catalog/status")) return new Response(JSON.stringify({
      ready: true, stale: false, source_updated_at: "2026-08-12T21:05:44Z",
      completed_at: "2026-08-12T21:12:00Z",
      counts: { sets: 1, oracle_cards: 1, printings: 1 },
    }), { status: 200, headers });
    return dashboardDataResponse(url, headers) ?? new Response(JSON.stringify({}), { status: 200, headers });
  }));

  renderAt("/dashboard");

  expect(await screen.findByRole("heading", { name: /good (morning|afternoon|evening), owner/i })).toBeVisible();
  expect(await screen.findByText(/card catalog is ready/i)).toBeVisible();
  const actions = within(screen.getByRole("navigation", { name: "Quick actions" }));
  expect(actions.getByRole("link", { name: "Browse" })).toHaveAttribute("href", "/cards");
  expect(screen.getByRole("status", { name: "Catalog status" })).toHaveClass("state-ready");
  expect(actions.getByRole("link", { name: "Scan" })).toHaveAttribute("href", "/scan");
  expect(screen.queryByRole("link", { name: "Trades" })).not.toBeInTheDocument();
  expect(screen.queryByText("Trades", { selector: "strong" })).not.toBeInTheDocument();
});

it.each([
  [{ ready: false, stale: false, source_updated_at: null, completed_at: null, counts: { sets: 0, oracle_cards: 0, printings: 0 } }, /catalog is preparing/i, /catalog preparing/i, "state-preparing"],
  [{ ready: true, stale: true, source_updated_at: null, completed_at: null, counts: { sets: 1, oracle_cards: 1, printings: 1 } }, /refresh is recommended/i, /refresh recommended/i, "state-stale"],
])("reports truthful catalog state without false operational claims", async (catalog, copy, chip, stateClass) => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const headers = { "content-type": "application/json" };
    if (url.endsWith("/api/v1/auth/me")) return new Response(JSON.stringify({
      id: "owner-id", email: "member-b306ba77201f@example.invalid", display_name: "Owner",
      role: "owner", created_at: "2026-08-12T00:00:00Z",
    }), { status: 200, headers });
    if (url.includes("/catalog/status")) return new Response(JSON.stringify(catalog), { status: 200, headers });
    return dashboardDataResponse(url, headers) ?? new Response(JSON.stringify({}), { status: 200, headers });
  }));
  renderAt("/dashboard");
  expect((await screen.findAllByText(copy)).length).toBeGreaterThan(0);
  expect(screen.getByRole("status", { name: "Catalog status" })).toHaveTextContent(chip);
  expect(screen.getByRole("status", { name: "Catalog status" })).toHaveClass(stateClass);
  expect(screen.queryByText(/all systems operational/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/card catalog is ready with/i)).not.toBeInTheDocument();
});

it("stays neutral while catalog status is loading or unavailable", async () => {
  let rejectStatus: ((reason: Error) => void) | undefined;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const headers = { "content-type": "application/json" };
    if (url.endsWith("/api/v1/auth/me")) return new Response(JSON.stringify({
      id: "owner-id", email: "member-3f8c97b2f4aa@example.invalid", display_name: "Owner",
      role: "owner", created_at: "2026-08-12T00:00:00Z",
    }), { status: 200, headers });
    if (url.includes("/catalog/status")) return new Promise<Response>((_resolve, reject) => {
      rejectStatus = reject;
    });
    return dashboardDataResponse(url, headers) ?? new Response(JSON.stringify({}), { status: 200, headers });
  }));
  renderAt("/dashboard");
  expect(await screen.findByRole("status", { name: "Catalog status" })).toHaveClass("state-loading");
  expect(screen.queryByText(/all systems operational|catalog is ready/i)).not.toBeInTheDocument();
  await waitFor(() => expect(rejectStatus).toBeTypeOf("function"));
  rejectStatus!(new Error("offline"));
  await waitFor(() => expect(screen.getByRole("status", { name: "Catalog status" })).toHaveTextContent(/catalog status unavailable/i));
  expect(screen.getByRole("status", { name: "Catalog status" })).toHaveTextContent(/status unavailable/i);
  expect(screen.getByRole("status", { name: "Catalog status" })).toHaveClass("state-unavailable");
  expect(screen.queryByText(/account and saved data/i)).not.toBeInTheDocument();
});

const readyUser = (role: "owner" | "super_admin" | "admin" | "member") => ({
  id: `${role}-id`,
  email: `${role}@wynterlabs.com`,
  display_name: role === "owner" ? "Owner" : role === "super_admin" ? "Super administrator" : role === "admin" ? "Administrator" : "Member",
  role,
  must_change_password: false,
  created_at: "2026-08-14T00:00:00Z",
});

function stubAuthenticatedUser(user: ReturnType<typeof readyUser>) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const headers = { "content-type": "application/json" };
    if (url.endsWith("/api/v1/auth/me")) {
      return new Response(JSON.stringify(user), { status: 200, headers });
    }
    if (url.includes("/catalog/status")) {
      return new Response(JSON.stringify({
        ready: true,
        stale: false,
        source_updated_at: "2026-08-14T00:00:00Z",
        completed_at: "2026-08-14T00:01:00Z",
        counts: { sets: 1, oracle_cards: 1, printings: 1 },
      }), { status: 200, headers });
    }
    if (url.includes("/catalog/sets")) {
      return new Response(JSON.stringify({
        items: [], page: 1, page_size: 200, total: 0, pages: 0,
      }), { status: 200, headers });
    }
    if (url.includes("/catalog/cards")) {
      return new Response(JSON.stringify({
        items: [], page: 1, page_size: 25, total: 0, pages: 0,
      }), { status: 200, headers });
    }
    return dashboardDataResponse(url, headers) ?? new Response(JSON.stringify({}), { status: 200, headers });
  }));
}

it.each(["owner", "admin"] as const)("shows Admin navigation to a ready %s", async (role) => {
  stubAuthenticatedUser(readyUser(role));

  renderAt("/dashboard");

  expect(await screen.findByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin");
});

it("labels the super administrator workspace without an underscore", async () => {
  stubAuthenticatedUser(readyUser("super_admin"));

  renderAt("/dashboard");

  expect(await screen.findByText("Super admin workspace", { selector: ".header-account-role" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin");
});

it("never shows Admin navigation to a member", async () => {
  stubAuthenticatedUser(readyUser("member"));

  renderAt("/dashboard");

  expect(await screen.findByRole("heading", { name: /good (morning|afternoon|evening), member/i })).toBeVisible();
  expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
});

it("shows a stable not-authorized state when a member opens Admin directly", async () => {
  stubAuthenticatedUser(readyUser("member"));

  renderAt("/admin");

  expect(await screen.findByRole("heading", { name: /not authorized/i })).toBeVisible();
  expect(screen.getByText(/owner or administrator access is required/i)).toBeVisible();
});

it("redirects a forced administrator from Cards to password setup", async () => {
  stubAuthenticatedUser({
    ...readyUser("admin"),
    must_change_password: true,
  });

  renderAt("/cards");

  expect(await screen.findByRole("heading", { name: /set your permanent password/i })).toBeVisible();
  expect(screen.getByRole("link", { name: "Home" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Sign out" })).toBeVisible();
  for (const name of ["Dashboard", "Cards", "Collection", "Decks", "Account", "Admin"]) {
    expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
  }
});

it("redirects a ready user away from the password-change route", async () => {
  stubAuthenticatedUser(readyUser("admin"));

  renderAt("/change-password");

  expect(await screen.findByRole("heading", { name: /good (morning|afternoon|evening), administrator/i })).toBeVisible();
  expect(screen.queryByRole("heading", { name: /set your permanent password/i })).not.toBeInTheDocument();
});

it("keeps forced users in the password flow when they open Admin directly", async () => {
  stubAuthenticatedUser({
    ...readyUser("admin"),
    must_change_password: true,
  });

  renderAt("/admin");

  expect(await screen.findByRole("heading", { name: /set your permanent password/i })).toBeVisible();
  expect(screen.queryByRole("heading", { name: /not authorized/i })).not.toBeInTheDocument();
});
