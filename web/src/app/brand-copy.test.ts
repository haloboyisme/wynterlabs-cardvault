import { createElement } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BrandProvider, useBranding } from "./branding";
import { AppShell } from "../components/AppShell";
import { HomePage } from "../pages/HomePage";

vi.mock("./auth", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: { display_name: "Owner", role: "owner", must_change_password: false },
    logout: vi.fn(),
  }),
}));

function renderBrandedHome() {
  return render(
    createElement(
      MemoryRouter,
      null,
      createElement(BrandProvider, null, createElement(AppShell, null, createElement(HomePage))),
    ),
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function RefreshBrandingButton() {
  const { refreshBranding } = useBranding();
  return createElement("button", { type: "button", onClick: () => void refreshBranding() }, "Refresh branding");
}

describe("shared branding", () => {
  beforeEach(() => {
    document.title = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the fallback brand visible when its request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Unavailable", { status: 503 })));

    renderBrandedHome();

    expect(screen.getByRole("link", { name: "WynterLabs CardVault home" })).toBeVisible();
    expect(screen.getByText("WynterLabs", { selector: "strong" })).toBeVisible();
    expect(screen.getByText("CARDVAULT")).toBeVisible();
    await waitFor(() => expect(document.title).toBe("WynterLabs CardVault"));
  });

  it("updates shared labels, home copy, footer, and title from branding data", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input).endsWith("/api/v1/community/activity") ? { items: [] } : {
      site_name: "Winter Lab",
      product_name: "Card Archive",
      tagline: "Keep every card close.",
      has_custom_logo: false,
      logo_revision: null,
    }), { headers: { "content-type": "application/json" } })));

    renderBrandedHome();

    expect(await screen.findByRole("link", { name: "Winter Lab Card Archive home" })).toBeVisible();
    expect(screen.getByText("Winter Lab", { selector: "strong" })).toBeVisible();
    expect(screen.getByText("CARD ARCHIVE")).toBeVisible();
    expect(screen.getByText("Winter Lab Card Archive · Private by design")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Keep every card close." })).toBeVisible();
    await waitFor(() => expect(document.title).toBe("Winter Lab Card Archive"));
  });

  it("keeps a newer refresh when the initial branding response resolves last", async () => {
    const initial = deferred<Response>();
    const refreshed = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(() => initial.promise)
      .mockImplementationOnce(() => refreshed.promise));

    render(createElement(BrandProvider, null, createElement(RefreshBrandingButton)));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    screen.getByRole("button", { name: "Refresh branding" }).click();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    refreshed.resolve(new Response(JSON.stringify({
      site_name: "Fresh Lab", product_name: "Fresh Archive", tagline: "Fresh.",
      has_custom_logo: false, logo_revision: null,
    }), { headers: { "content-type": "application/json" } }));
    await waitFor(() => expect(document.title).toBe("Fresh Lab Fresh Archive"));

    await act(async () => {
      initial.resolve(new Response(JSON.stringify({
        site_name: "Stale Lab", product_name: "Stale Archive", tagline: "Stale.",
        has_custom_logo: false, logo_revision: null,
      }), { headers: { "content-type": "application/json" } }));
      await initial.promise;
    });
    expect(document.title).toBe("Fresh Lab Fresh Archive");
  });
});
