import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { App } from "../app/App";
import { APPEARANCE_ACCENTS, APPEARANCE_STORAGE_KEY } from "../lib/appearance";
import {
  COLLECTION_DISPLAY_STORAGE_KEY,
  DEFAULT_COLLECTION_DISPLAY,
} from "../lib/collection-display";
import { CAPTURE_SHORTCUT_STORAGE_KEY } from "../scanner/capture-shortcut";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

let failedSessionLoads = 0;
let accountSignals: AbortSignal[] = [];
let pendingDelete: Promise<Response> | null = null;

const user = {
  id: "member-id",
  email: "member-86b6eb087ae7@example.invalid",
  display_name: "Member One",
  role: "member",
  must_change_password: false,
  created_at: "2026-08-15T00:00:00Z",
};

beforeEach(() => {
  failedSessionLoads = 0;
  accountSignals = [];
  pendingDelete = null;
  window.history.pushState({}, "", "/account");
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-theme-choice");
  document.documentElement.removeAttribute("data-density");
  document.documentElement.removeAttribute("data-accent");
  document.documentElement.removeAttribute("data-complexity");
  document.documentElement.removeAttribute("data-text-scale");
  document.documentElement.removeAttribute("data-contrast");
  document.documentElement.removeAttribute("data-motion");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith("/api/v1/auth/me")) return json(user);
    if (path === "/api/v1/account/sessions" && init?.method !== "DELETE") {
      if (init?.signal) accountSignals.push(init.signal);
      if (failedSessionLoads > 0) {
        failedSessionLoads -= 1;
        return json({
          error: { code: "account_unavailable", message: "Account details unavailable." },
        }, 503);
      }
      return json([{
        id: "session-1",
        created_at: "2026-08-15T00:00:00Z",
        expires_at: "2026-08-22T00:00:00Z",
        last_seen_at: "2026-08-16T20:00:00Z",
        client_ip: "192.0.2.171",
        user_agent: "Test browser",
        current: false,
      }]);
    }
    if (path === "/api/v1/account/sessions/session-1" && init?.method === "DELETE") {
      if (pendingDelete) return pendingDelete;
      return new Response(null, { status: 204 });
    }
    if (path === "/api/v1/trading/account") {
      if (init?.signal) accountSignals.push(init.signal);
      return json({
        status: "suspended",
        active_strikes: 2,
        revision: 3,
        suspended_at: "2026-08-16T12:00:00Z",
        support_email: "member-417aa5e90597@example.invalid",
      });
    }
    if (path === "/api/v1/trade-reports") {
      if (init?.signal) accountSignals.push(init.signal);
      return json([{
        id: "report-1",
        incident_reference: "WL-2026-0001",
        reporter_display_name: "Member One",
        reported_user_id: "member-2",
        reported_display_name: "Member Two",
        listing_id: "listing-1",
        reason: "spam",
        details: null,
        status: "upheld",
        revision: 2,
        created_at: "2026-08-16T12:00:00Z",
      }]);
    }
    return json({});
  }));
});

afterEach(() => vi.unstubAllGlobals());

it("shows private trading enforcement details only on Account", async () => {
  render(<App />);

  expect(await screen.findByRole("heading", { name: "Member One" })).toBeVisible();
  expect(await screen.findByText(/2 of 3 active trading strikes/i)).toBeVisible();
  expect(screen.getByText(/trading suspended/i)).toBeVisible();
  expect(screen.getByRole("link", { name: /appeal trading suspension/i }))
    .toHaveAttribute("href", expect.stringContaining("member-417aa5e90597@example.invalid"));
  expect(screen.queryByText("WL-2026-0001")).not.toBeInTheDocument();
  expect(vi.mocked(fetch).mock.calls.some(([path]) =>
    String(path) === "/api/v1/trade-reports")).toBe(false);
  expect(screen.getByText(/192\.0\.2\.171/)).toBeVisible();
  expect(document.body.textContent).not.toContain("�");

  fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([path, init]) =>
    String(path).endsWith("/account/sessions/session-1") && init?.method === "DELETE",
  )).toBe(true));
});

it("lets the member set a browser-local scanner capture shortcut", async () => {
  render(<App />);
  expect(await screen.findByRole("heading", { name: "Member One" })).toBeVisible();

  const change = screen.getByRole("button", { name: /change capture shortcut/i });
  const defaultShortcut = screen.getByText("Space", { selector: "kbd" });
  expect(defaultShortcut.closest("p")).toHaveTextContent("Current shortcut: Space");
  fireEvent.click(change);
  expect(screen.getByText(/press one key now/i)).toBeVisible();
  fireEvent.keyDown(change, { code: "KeyK", key: "k" });

  expect(localStorage.getItem(CAPTURE_SHORTCUT_STORAGE_KEY)).toBe("KeyK");
  const customShortcut = screen.getByText("K", { selector: "kbd" });
  expect(customShortcut.closest("p")).toHaveTextContent("Current shortcut: K");

  fireEvent.click(screen.getByRole("button", { name: /reset capture shortcut/i }));
  expect(localStorage.getItem(CAPTURE_SHORTCUT_STORAGE_KEY)).toBeNull();
  const resetShortcut = screen.getByText("Space", { selector: "kbd" });
  expect(resetShortcut.closest("p")).toHaveTextContent("Current shortcut: Space");
});

it("shows a retryable account failure and clears it after a successful retry", async () => {
  failedSessionLoads = 1;
  render(<App />);

  expect(await screen.findByRole("alert")).toHaveTextContent("Account details unavailable.");
  fireEvent.click(screen.getByRole("button", { name: /retry account details/i }));

  expect(await screen.findByText(/2 of 3 active trading strikes/i)).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
});

it("aborts all private Account requests when the page unmounts", async () => {
  const view = render(<App />);
  expect(await screen.findByText(/2 of 3 active trading strikes/i)).toBeVisible();
  expect(accountSignals).toHaveLength(2);

  view.unmount();

  for (const signal of accountSignals) expect(signal.aborted).toBe(true);
});

it("does not reload Account after an in-flight revocation outlives the page", async () => {
  let finishDelete: (response: Response) => void = () => undefined;
  pendingDelete = new Promise((resolve) => { finishDelete = resolve; });
  const view = render(<App />);
  expect(await screen.findByText(/2 of 3 active trading strikes/i)).toBeVisible();
  const initialSessionLoads = vi.mocked(fetch).mock.calls.filter(([path, init]) =>
    String(path) === "/api/v1/account/sessions" && init?.method !== "DELETE",
  ).length;

  fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([path, init]) =>
    String(path).endsWith("/account/sessions/session-1") && init?.method === "DELETE",
  )).toBe(true));
  view.unmount();
  finishDelete(new Response(null, { status: 204 }));
  await Promise.resolve();
  await Promise.resolve();

  expect(vi.mocked(fetch).mock.calls.filter(([path, init]) =>
    String(path) === "/api/v1/account/sessions" && init?.method !== "DELETE",
  )).toHaveLength(initialSessionLoads);
});

it("offers a simple personalization center with a named accent palette", async () => {
  render(<App />);

  expect(await screen.findByRole("heading", { name: "Personalization" })).toBeVisible();
  expect(screen.getByText("Saved in this browser")).toBeVisible();
  const preview = screen.getByLabelText("Appearance preview");
  const previewDetail = preview.querySelector("small");
  expect(previewDetail).toHaveTextContent("Selected color #5BE7E7");
  expect(preview).toContainElement(previewDetail);
  for (const name of [
    "System", "Midnight", "Frost", "Light", "Aurora", "Amethyst", "Ember", "Forest",
    "Sandstone", "Slate",
  ]) {
    expect(screen.getByDisplayValue(name.toLowerCase())).toBeVisible();
  }
  expect(screen.getAllByRole("radio", { name: /accent/i })).toHaveLength(48);
  const accentGroup = screen.getByRole("group", { name: "Accent color" });
  for (const accent of APPEARANCE_ACCENTS) {
    expect(accentGroup).toHaveTextContent(accent[0].toUpperCase() + accent.slice(1));
  }
  expect(screen.getByRole("radio", { name: /^System/i })).toBeChecked();
  expect(screen.getByLabelText("Simple workspace")).toBeChecked();
  expect(screen.queryByLabelText("Custom accent color")).not.toBeInTheDocument();
});

it("shows a visual preview for every base mode and applies a new mode immediately", async () => {
  const user = userEvent.setup();
  render(<App />);
  expect(await screen.findByRole("heading", { name: "Personalization" })).toBeVisible();

  const baseModes = screen.getByRole("group", { name: "Base mode" });
  expect(baseModes.querySelectorAll(".theme-option-preview")).toHaveLength(10);

  await user.click(screen.getByRole("radio", { name: /^Aurora/i }));
  expect(document.documentElement.dataset.theme).toBe("aurora");
  expect(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? "{}")).toMatchObject({
    theme: "aurora",
  });
});

it("applies and persists personalization choices immediately without an API call", async () => {
  const user = userEvent.setup();
  render(<App />);
  expect(await screen.findByRole("heading", { name: "Personalization" })).toBeVisible();
  await screen.findByText(/2 of 3 active trading strikes/i);
  const callsBeforeAppearance = vi.mocked(fetch).mock.calls.length;

  await user.click(screen.getByLabelText("Advanced workspace"));
  await user.selectOptions(screen.getByLabelText("Text size"), "extra-large");
  await user.click(screen.getByLabelText("High contrast"));
  await user.type(screen.getByLabelText("Custom accent color"), "#7c3aed");
  await user.click(screen.getByRole("button", { name: "Apply custom color" }));

  expect(document.documentElement.dataset.complexity).toBe("advanced");
  expect(document.documentElement.dataset.textScale).toBe("extra-large");
  expect(document.documentElement.dataset.contrast).toBe("high");
  expect(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? "{}")).toMatchObject({
    accent: "custom",
    customAccent: "#7C3AED",
    complexity: "advanced",
    textScale: "extra-large",
    contrast: "high",
  });
  expect(vi.mocked(fetch).mock.calls).toHaveLength(callsBeforeAppearance);
});

it("uses Density as the only compact control and resets optional motion", async () => {
  render(<App />);
  expect(await screen.findByRole("heading", { name: "Personalization" })).toBeVisible();

  fireEvent.click(screen.getByLabelText("Advanced workspace"));
  expect(screen.queryByRole("checkbox", { name: /compact layout/i })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "Compact" }));
  fireEvent.click(screen.getByRole("checkbox", { name: /reduced motion/i }));

  expect(document.documentElement.dataset.density).toBe("compact");
  expect(document.documentElement.dataset.motion).toBe("reduced");
  expect(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? "null")).toEqual({
    theme: "system",
    accent: "frost",
    customAccent: null,
    complexity: "advanced",
    density: "compact",
    textScale: "standard",
    contrast: "standard",
    motion: "reduced",
  });

  fireEvent.click(screen.getByRole("button", { name: "Reset appearance" }));

  expect(screen.getByRole("radio", { name: /^System/i })).toBeChecked();
  expect(screen.queryByRole("checkbox", { name: /compact layout/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox", { name: /reduced motion/i })).not.toBeInTheDocument();
  expect(localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBeNull();
  expect(document.documentElement.dataset.density).toBe("comfortable");
  expect(document.documentElement.dataset.motion).toBe("system");
});

it("updates its controlled choices when another browser tab changes appearance", async () => {
  render(<App />);
  expect(await screen.findByRole("heading", { name: "Personalization" })).toBeVisible();
  const next = {
    theme: "light",
    accent: "frost",
    customAccent: null,
    complexity: "advanced",
    density: "compact",
    textScale: "standard",
    contrast: "standard",
    motion: "reduced",
  } as const;
  localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(next));

  fireEvent(window, new StorageEvent("storage", {
    key: APPEARANCE_STORAGE_KEY,
    newValue: JSON.stringify(next),
  }));

  await waitFor(() => expect(screen.getByRole("radio", { name: /^Light/i })).toBeChecked());
  expect(document.documentElement.dataset.theme).toBe("light");
  fireEvent.click(screen.getByLabelText("Advanced workspace"));
  expect(screen.getByRole("radio", { name: "Compact" })).toBeChecked();
  expect(screen.queryByRole("checkbox", { name: /compact layout/i })).not.toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: /reduced motion/i })).toBeChecked();
});

it("keeps collection display choices private and optional inside Advanced", async () => {
  render(<App />);
  expect(await screen.findByRole("heading", { name: "Personalization" })).toBeVisible();
  await screen.findByText(/2 of 3 active trading strikes/i);
  const callsBeforeDisplay = vi.mocked(fetch).mock.calls.length;

  fireEvent.click(screen.getByLabelText("Advanced workspace"));

  expect(screen.getByRole("group", { name: "Collection display" })).toBeVisible();
  expect(screen.getByText("Collection choices are saved only in this browser.")).toBeVisible();
  expect(screen.getByRole("radio", { name: "Compact grid" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Medium cards" })).toBeChecked();
  for (const label of [
    "Show set and collector number",
    "Show language",
    "Show type and rarity",
    "Show informational prices",
    "Animate expanded details",
  ]) expect(screen.getByRole("checkbox", { name: label })).toBeChecked();

  fireEvent.click(screen.getByRole("radio", { name: "Detailed list" }));
  fireEvent.click(screen.getByRole("radio", { name: "Large cards" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Show language" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Show informational prices" }));

  expect(JSON.parse(localStorage.getItem(COLLECTION_DISPLAY_STORAGE_KEY) ?? "null")).toEqual({
    ...DEFAULT_COLLECTION_DISPLAY,
    view: "list",
    size: "large",
    showLanguage: false,
    showPrices: false,
  });
  expect(vi.mocked(fetch).mock.calls).toHaveLength(callsBeforeDisplay);

  fireEvent.click(screen.getByRole("button", { name: "Reset collection display" }));
  expect(screen.getByRole("radio", { name: "Compact grid" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Medium cards" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Show language" })).toBeChecked();
  expect(localStorage.getItem(COLLECTION_DISPLAY_STORAGE_KEY)).toBeNull();
});

it("synchronizes controlled collection display choices from another tab", async () => {
  render(<App />);
  expect(await screen.findByRole("heading", { name: "Personalization" })).toBeVisible();
  fireEvent.click(screen.getByLabelText("Advanced workspace"));
  const next = {
    ...DEFAULT_COLLECTION_DISPLAY,
    view: "list",
    size: "small",
    showSet: false,
    animateDetails: false,
  } as const;
  localStorage.setItem(COLLECTION_DISPLAY_STORAGE_KEY, JSON.stringify(next));

  fireEvent(window, new StorageEvent("storage", {
    key: COLLECTION_DISPLAY_STORAGE_KEY,
    newValue: JSON.stringify(next),
  }));

  await waitFor(() => expect(screen.getByRole("radio", { name: "Detailed list" })).toBeChecked());
  expect(screen.getByRole("radio", { name: "Small cards" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Show set and collector number" }))
    .not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Animate expanded details" }))
    .not.toBeChecked();
});

it("rejects an invalid custom accent without replacing the selected curated accent", async () => {
  const user = userEvent.setup();
  render(<App />);
  expect(await screen.findByRole("heading", { name: "Personalization" })).toBeVisible();
  await user.click(screen.getByLabelText("Advanced workspace"));
  await user.click(screen.getByLabelText("Violet accent"));
  const callsBeforeCustomInput = vi.mocked(fetch).mock.calls.length;

  await user.type(screen.getByLabelText("Custom accent color"), "violet");
  await user.click(screen.getByRole("button", { name: "Apply custom color" }));

  expect(screen.getByRole("alert")).toHaveTextContent("Enter a six-digit hex color such as #7C3AED.");
  expect(screen.getByLabelText("Violet accent")).toBeChecked();
  expect(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? "{}")).toMatchObject({
    accent: "violet",
    customAccent: null,
  });
  expect(vi.mocked(fetch).mock.calls).toHaveLength(callsBeforeCustomInput);
});

it("identifies the Advanced custom hex control as a full text input", async () => {
  render(<App />);
  expect(await screen.findByRole("heading", { name: "Personalization" })).toBeVisible();
  fireEvent.click(screen.getByLabelText("Advanced workspace"));

  expect(screen.getByLabelText("Custom accent color"))
    .toHaveAttribute("type", "text");
  expect(screen.getByLabelText("Custom accent color"))
    .toHaveClass("custom-accent-hex");
});
