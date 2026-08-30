import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createAdministrator, resetAdministratorPassword, setAdministratorStatus } from "../lib/admin";
import { APPEARANCE_STORAGE_KEY, DEFAULT_APPEARANCE } from "../lib/appearance";
import { AdminPage } from "./AdminPage";

const authState = vi.hoisted(() => ({ role: "owner" as "owner" | "admin" | "member" }));

vi.mock("../app/auth", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: {
      id: `${authState.role}-id`, email: `${authState.role}@wynterlabs.com`,
      display_name: authState.role === "owner" ? "Owner" : "Administrator",
      role: authState.role, must_change_password: false, created_at: "2026-08-14T00:00:00Z",
    },
  }),
}));

vi.mock("../app/branding", () => ({
  useBranding: () => ({
    branding: {
      site_name: "WynterLabs", product_name: "CardVault",
      tagline: "Scan it. Sort it. Own your collection.",
      has_custom_logo: false, logo_revision: null,
    },
    refreshBranding: vi.fn(),
  }),
}));

const activeCatalog = {
  import_id: "11111111-1111-4111-8111-111111111111", status: "complete",
  source_updated_at: "2026-08-14T00:00:00Z", completed_at: "2026-08-14T00:05:00Z",
  total_records: 116703, imported_records: 116703, rejected_records: 0,
  set_count: 1047, oracle_count: 38626, printing_count: 116703, error_summary: null,
};
const failedAttempt = {
  ...activeCatalog, import_id: "22222222-2222-4222-8222-222222222222", status: "failed",
  source_updated_at: "2026-08-14T01:00:00Z",
  completed_at: "2026-08-14T01:05:00Z",
  set_count: 1046,
  oracle_count: 38625,
  printing_count: 116700,
  error_summary: "postgresql://secret-user:secret-password@database/cards",
};
const catalogStatus = {
  active_catalog: activeCatalog,
  latest_attempt: failedAttempt,
  games: {
    mtg: { active_catalog: activeCatalog, latest_attempt: failedAttempt },
    pokemon: { active_catalog: { ...activeCatalog, printing_count: 151 }, latest_attempt: null },
    yugioh: { active_catalog: null, latest_attempt: { ...failedAttempt, printing_count: 10000 } },
  },
};
const firstAdmin = {
  id: "33333333-3333-4333-8333-333333333333", email: "member-fca03c4a0d89@example.invalid",
  display_name: "Catalog Admin", role: "admin" as const, is_active: true,
  must_change_password: false, created_at: "2026-08-14T00:00:00Z", updated_at: "2026-08-14T00:00:00Z",
};
const secondAdmin = {
  ...firstAdmin,
  id: "55555555-5555-4555-8555-555555555555",
  email: "member-41d3c9af55cf@example.invalid",
  display_name: "Second Admin",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function errorJson(code: string, message: string, status: number) {
  return json({ error: { code, message, fields: null, request_id: "test-request" } }, status);
}
function requestPath(input: RequestInfo | URL) { return String(input); }
let administrators = [firstAdmin];

beforeEach(() => {
  authState.role = "owner";
  administrators = [firstAdmin];
  localStorage.clear();
  localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({
    ...DEFAULT_APPEARANCE,
    complexity: "advanced",
  }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = requestPath(input);
    if (path === "/api/v1/admin/catalog/status") return json(catalogStatus);
    if (path === "/api/v1/admin/catalog/refresh") return json({ status: "complete", import_id: activeCatalog.import_id, imported_records: 116703, rejected_records: 0, skipped: false });
    if (path === "/api/v1/admin/trade-moderation/reports") return json([]);
    if (path === "/api/v1/admin/users" && (!init?.method || init.method === "GET")) return json(administrators);
    if (path === "/api/v1/admin/users" && init?.method === "POST") {
      const payload = JSON.parse(String(init.body));
      const created = { ...firstAdmin, id: "44444444-4444-4444-8444-444444444444", email: payload.email, display_name: payload.display_name, must_change_password: true };
      administrators = [...administrators, created];
      return json(created, 201);
    }
    if (path.endsWith("/status") && init?.method === "PATCH") {
      const payload = JSON.parse(String(init.body));
      administrators = administrators.map((admin) => path.includes(encodeURIComponent(admin.id)) ? { ...admin, is_active: payload.is_active } : admin);
      return json(administrators[0]);
    }
    if (path.endsWith("/reset-password") && init?.method === "POST") {
      administrators = administrators.map((admin) => path.includes(encodeURIComponent(admin.id)) ? { ...admin, must_change_password: true } : admin);
      return json(administrators[0]);
    }
    return errorJson("not_found", "Not found.", 404);
  }));
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("derives the owner operational overview only from loaded catalog and administrator responses", async () => {
  render(<AdminPage />);

  await screen.findByText(firstAdmin.email);
  const overview = screen.getByRole("region", { name: /operational overview/i });
  expect(within(overview).getByText("Catalog status")).toBeVisible();
  expect(within(overview).getByText("Complete", { selector: "strong" })).toBeVisible();
  expect(within(overview).getByText("Source freshness")).toBeVisible();
  expect(within(overview).getByText(/aug 14, 2026, 12:00 am/i, { selector: "strong" })).toBeVisible();
  expect(within(overview).getByText("Printings")).toBeVisible();
  expect(within(overview).getByText("116,703", { selector: "strong" })).toBeVisible();
  expect(within(overview).getByText("Administrator count")).toBeVisible();
  expect(within(overview).getByText("1", { selector: "strong" })).toBeVisible();
});

it("reports unavailable source freshness instead of inventing a timestamp", async () => {
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const path = requestPath(input);
    if (path === "/api/v1/admin/catalog/status") {
      return json({
        active_catalog: { ...activeCatalog, source_updated_at: null },
        latest_attempt: failedAttempt,
      });
    }
    if (path === "/api/v1/admin/users") return json(administrators);
    if (path === "/api/v1/admin/trade-moderation/reports") return json([]);
    return errorJson("not_found", "Not found.", 404);
  });

  render(<AdminPage />);

  const overview = await screen.findByRole("region", { name: /operational overview/i });
  expect(within(overview).getByText("Unavailable", { selector: "strong" })).toBeVisible();
});

it("keeps secondary catalog and owner maintenance details closed in Simple mode", async () => {
  localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(DEFAULT_APPEARANCE));

  render(<AdminPage />);

  await screen.findByText(firstAdmin.email);
  expect(screen.getByText("Latest catalog attempt").closest("details")).not.toHaveAttribute("open");
  expect(screen.getByText("Owner maintenance").closest("details")).not.toHaveAttribute("open");
});

it("opens secondary catalog and owner maintenance details in Advanced mode", async () => {
  render(<AdminPage />);

  await screen.findByText(firstAdmin.email);
  expect(screen.getByText("Latest catalog attempt").closest("details")).toHaveAttribute("open");
  expect(screen.getByText("Owner maintenance").closest("details")).toHaveAttribute("open");
});

it("shows sanitized catalog status to an owner and reserves administrator management for the owner", async () => {
  render(<AdminPage />);
  expect(screen.getByRole("heading", { name: "Brand Studio" })).toBeVisible();
  expect(await screen.findByRole("heading", { name: /catalog database/i })).toBeVisible();
  expect(screen.getByRole("heading", { name: /administrators/i })).toBeVisible();
  expect(screen.getAllByText("116,703", { selector: "strong" })).toHaveLength(2);
  expect(screen.getByText("38,626", { selector: "strong" })).toBeVisible();
  expect(screen.getByText("1,047", { selector: "strong" })).toBeVisible();
  expect(screen.getAllByText(/aug 14, 2026/i).length).toBeGreaterThan(0);
  expect(screen.getByText(/latest attempt: failed/i)).toBeVisible();
  const latest = screen.getByText("Latest catalog attempt").closest("details");
  expect(latest).not.toBeNull();
  expect(within(latest!).getByText("116,700", { selector: "strong" })).toBeVisible();
  expect(within(latest!).getByText("38,625", { selector: "strong" })).toBeVisible();
  expect(within(latest!).getByText("1,046", { selector: "strong" })).toBeVisible();
  expect(within(latest!).getByText(/aug 14, 2026, 1:00 am/i)).toBeVisible();
  expect(screen.queryByText(/secret-user|secret-password|postgresql:/i)).not.toBeInTheDocument();
  expect(await screen.findByText(firstAdmin.email)).toBeVisible();
});

it("refreshes a selected game and shows per-game freshness", async () => {
  const user = userEvent.setup();
  render(<AdminPage />);
  await screen.findByText(firstAdmin.email);
  const gameStatus = screen.getByRole("region", { name: "Catalog status by game" });
  expect(within(gameStatus).getByText("Pokémon")).toBeVisible();
  expect(within(gameStatus).getByText("Yu-Gi-Oh!")).toBeVisible();
  await user.selectOptions(screen.getByLabelText("Catalog game"), "pokemon");
  await user.click(screen.getByRole("button", { name: /refresh card database/i }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input, init]) =>
    String(input) === "/api/v1/admin/catalog/refresh?game=pokemon" && init?.method === "POST",
  )).toBe(true));
});

it("uses the all-games refresh contract when requested", async () => {
  const user = userEvent.setup();
  render(<AdminPage />);
  await screen.findByText(firstAdmin.email);
  await user.selectOptions(screen.getByLabelText("Catalog game"), "all");
  await user.click(screen.getByRole("button", { name: /refresh card database/i }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input, init]) =>
    String(input) === "/api/v1/admin/catalog/refresh?game=all" && init?.method === "POST",
  )).toBe(true));
});

it("keeps the sanitized latest attempt visible when no active catalog exists", async () => {
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const path = requestPath(input);
    if (path === "/api/v1/admin/catalog/status") {
      return json({ active_catalog: null, latest_attempt: failedAttempt });
    }
    if (path === "/api/v1/admin/users") return json(administrators);
    return errorJson("not_found", "Not found.", 404);
  });

  render(<AdminPage />);

  expect(await screen.findByText(/no active card catalog is available yet/i)).toBeVisible();
  const latest = screen.getByText("Latest catalog attempt").closest("details");
  expect(latest).not.toBeNull();
  expect(within(latest!).getByText("116,700", { selector: "strong" })).toBeVisible();
  expect(screen.queryByText(/secret-user|secret-password|postgresql:/i)).not.toBeInTheDocument();
});

it("shows only catalog controls to an administrator and never requests or renders users", async () => {
  authState.role = "admin";
  render(<AdminPage />);
  expect(await screen.findByRole("heading", { name: /catalog database/i })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Brand Studio" })).toBeVisible();
  const overview = screen.getByRole("region", { name: /operational overview/i });
  expect(within(overview).queryByText("Administrator count")).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: /administrators/i })).not.toBeInTheDocument();
  expect(screen.queryByText("Owner maintenance")).not.toBeInTheDocument();
  expect(screen.queryByText(firstAdmin.email)).not.toBeInTheDocument();
  expect(vi.mocked(fetch).mock.calls.some(([input]) => requestPath(input).includes("/admin/users"))).toBe(false);
});

it("does not render or request private page data when the route guard supplies a member", () => {
  authState.role = "member";
  const { container } = render(<AdminPage />);
  expect(container).toBeEmptyDOMElement();
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps the newest catalog status when a pre-refresh load resolves last", async () => {
  const user = userEvent.setup();
  const requests: Array<{
    response: ReturnType<typeof deferred<Response>>;
    signal: AbortSignal | null | undefined;
  }> = [];
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = requestPath(input);
    if (path === "/api/v1/admin/catalog/status") {
      const response = deferred<Response>();
      requests.push({ response, signal: init?.signal });
      return response.promise;
    }
    if (path === "/api/v1/admin/catalog/refresh") {
      return json({ status: "complete", import_id: activeCatalog.import_id, imported_records: 200002, rejected_records: 0, skipped: false });
    }
    if (path === "/api/v1/admin/users") return json(administrators);
    return errorJson("not_found", "Not found.", 404);
  });

  render(<AdminPage />);
  await waitFor(() => expect(requests).toHaveLength(1));
  await user.click(screen.getByRole("button", { name: /refresh card database/i }));
  await waitFor(() => expect(requests).toHaveLength(2));

  expect(requests[0].signal?.aborted).toBe(true);
  expect(requests[1].signal?.aborted).toBe(false);
  requests[1].response.resolve(json({
    active_catalog: { ...activeCatalog, printing_count: 200002 },
    latest_attempt: { ...activeCatalog, printing_count: 200002 },
  }));
  expect(await screen.findAllByText("200,002", { selector: "strong" })).toHaveLength(3);

  requests[0].response.resolve(json({
    active_catalog: { ...activeCatalog, printing_count: 100001 },
    latest_attempt: { ...activeCatalog, printing_count: 100001 },
  }));
  await waitFor(() => expect(screen.queryAllByText("100,001", { selector: "strong" })).toHaveLength(0));
  expect(screen.getAllByText("200,002", { selector: "strong" })).toHaveLength(3);
});

it("keeps the newest administrator list across concurrent row mutations", async () => {
  const user = userEvent.setup();
  const requests: Array<{
    response: ReturnType<typeof deferred<Response>>;
    signal: AbortSignal | null | undefined;
  }> = [];
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = requestPath(input);
    if (path === "/api/v1/admin/catalog/status") return json(catalogStatus);
    if (path === "/api/v1/admin/users" && (!init?.method || init.method === "GET")) {
      const response = deferred<Response>();
      requests.push({ response, signal: init?.signal });
      return response.promise;
    }
    if (path.endsWith("/status") && init?.method === "PATCH") {
      return json(path.includes(firstAdmin.id) ? { ...firstAdmin, is_active: false } : { ...secondAdmin, is_active: false });
    }
    return errorJson("not_found", "Not found.", 404);
  });

  render(<AdminPage />);
  await waitFor(() => expect(requests).toHaveLength(1));
  requests[0].response.resolve(json([firstAdmin, secondAdmin]));
  await screen.findByText(secondAdmin.email);

  const firstRow = screen.getByText(firstAdmin.email).closest("li");
  const secondRow = screen.getByText(secondAdmin.email).closest("li");
  expect(firstRow).not.toBeNull();
  expect(secondRow).not.toBeNull();
  await user.click(within(firstRow!).getByRole("button", { name: /disable catalog admin/i }));
  await user.click(within(firstRow!).getByRole("button", { name: /confirm disable/i }));
  await waitFor(() => expect(requests).toHaveLength(2));
  await user.click(within(secondRow!).getByRole("button", { name: /disable second admin/i }));
  await user.click(within(secondRow!).getByRole("button", { name: /confirm disable/i }));
  await waitFor(() => expect(requests).toHaveLength(3));

  expect(requests[1].signal?.aborted).toBe(true);
  expect(requests[2].signal?.aborted).toBe(false);
  requests[2].response.resolve(json([
    { ...firstAdmin, is_active: false },
    { ...secondAdmin, is_active: false },
  ]));
  await waitFor(() => {
    expect(within(firstRow!).getByRole("button", { name: /reactivate catalog admin/i })).toBeVisible();
    expect(within(secondRow!).getByRole("button", { name: /reactivate second admin/i })).toBeVisible();
  });

  requests[1].response.resolve(json([
    { ...firstAdmin, is_active: false },
    secondAdmin,
  ]));
  await waitFor(() => expect(within(secondRow!).queryByRole("button", { name: /disable second admin/i })).not.toBeInTheDocument());
  expect(within(secondRow!).getByRole("button", { name: /reactivate second admin/i })).toBeVisible();
});

it("prevents duplicate refreshes, reports completion, and reloads status", async () => {
  const user = userEvent.setup();
  let releaseRefresh: ((value: Response) => void) | undefined;
  let statusCalls = 0;
  let refreshCalls = 0;
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = requestPath(input);
    if (path === "/api/v1/admin/catalog/status") { statusCalls += 1; return json(catalogStatus); }
    if (path === "/api/v1/admin/users") return json(administrators);
    if (path === "/api/v1/admin/catalog/refresh" && init?.method === "POST") {
      refreshCalls += 1;
      return new Promise<Response>((resolve) => { releaseRefresh = resolve; });
    }
    return errorJson("not_found", "Not found.", 404);
  });
  render(<AdminPage />);
  await screen.findByText(/latest attempt: failed/i);
  await user.click(screen.getByRole("button", { name: /refresh card database/i }));
  const pendingButton = screen.getByRole("button", { name: /refreshing card database/i });
  expect(pendingButton).toBeDisabled();
  expect(screen.getByText(/refreshing card database.*several minutes/i)).toHaveAttribute("aria-live", "polite");
  expect(screen.getByText(/refreshing card database.*several minutes/i)).not.toHaveAttribute("role", "alert");
  await user.click(pendingButton);
  expect(refreshCalls).toBe(1);
  releaseRefresh?.(json({ status: "complete", import_id: activeCatalog.import_id, imported_records: 116703, rejected_records: 0, skipped: false }));
  const completeMessage = await screen.findByText(/refresh complete.*latest card data is now active/i);
  expect(completeMessage).toBeVisible();
  expect(completeMessage).toHaveAttribute("aria-live", "polite");
  expect(completeMessage).not.toHaveAttribute("role", "alert");
  await waitFor(() => expect(statusCalls).toBe(2));
});

it.each([
  ["unchanged", json({ status: "unchanged", import_id: activeCatalog.import_id, imported_records: 116703, rejected_records: 0, skipped: true }), /already up to date.*no changes were needed/i],
  ["busy", errorJson("catalog_refresh_busy", "A catalog refresh is already running.", 409), /refresh is already running.*status has been reloaded/i],
])("shows a controlled %s refresh outcome without server detail", async (_outcome, response, expected) => {
  authState.role = "admin";
  const user = userEvent.setup();
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const path = requestPath(input);
    if (path === "/api/v1/admin/catalog/status") return json(catalogStatus);
    if (path === "/api/v1/admin/catalog/refresh") return response.clone();
    if (path === "/api/v1/admin/trade-moderation/reports") return json([]);
    return errorJson("not_found", "Not found.", 404);
  });
  render(<AdminPage />);
  await screen.findByText(/latest attempt: failed/i);
  await user.click(screen.getByRole("button", { name: /refresh card database/i }));
  const message = await screen.findByText(expected);
  expect(message).toBeVisible();
  expect(message).toHaveAttribute("aria-live", "polite");
  expect(message).not.toHaveAttribute("role", "alert");
  expect(screen.queryByText(/password leaked/i)).not.toBeInTheDocument();
});

it("announces a failed refresh as an alert without exposing server detail", async () => {
  authState.role = "admin";
  const user = userEvent.setup();
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const path = requestPath(input);
    if (path === "/api/v1/admin/catalog/status") return json(catalogStatus);
    if (path === "/api/v1/admin/catalog/refresh") {
      return errorJson("catalog_refresh_failed", "Internal database password leaked here.", 503);
    }
    if (path === "/api/v1/admin/trade-moderation/reports") return json([]);
    return errorJson("not_found", "Not found.", 404);
  });

  render(<AdminPage />);
  await screen.findByText(/latest attempt: failed/i);
  await user.click(screen.getByRole("button", { name: /refresh card database/i }));

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(/refresh failed.*previous working catalog remains active/i);
  expect(alert).not.toHaveAttribute("aria-live", "polite");
  expect(screen.queryByText(/password leaked/i)).not.toBeInTheDocument();
});

it("creates an administrator with the exact API shape then clears and never echoes the temporary password", async () => {
  const user = userEvent.setup();
  render(<AdminPage />);
  await screen.findByText(firstAdmin.email);
  await user.type(screen.getByLabelText(/administrator email/i), "member-1bfea178405a@example.invalid");
  await user.type(screen.getByLabelText(/administrator display name/i), "Second Admin");
  const password = screen.getByLabelText(/temporary password/i);
  await user.type(password, "TemporaryPassphrase!23");
  await user.click(screen.getByRole("button", { name: /create administrator/i }));
  expect(await screen.findByText("member-77880c1d069c@example.invalid")).toBeVisible();
  expect(fetch).toHaveBeenCalledWith("/api/v1/admin/users", expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "member-cda7177f2117@example.invalid", display_name: "Second Admin", temporary_password: "TemporaryPassphrase!23" }) }));
  expect(password).toHaveValue("");
  expect(screen.queryByText("TemporaryPassphrase!23")).not.toBeInTheDocument();
});

it("requires explicit confirmation to disable, reactivate, and reset an administrator", async () => {
  const user = userEvent.setup();
  render(<AdminPage />);
  const row = (await screen.findByText(firstAdmin.email)).closest("li");
  expect(row).not.toBeNull();
  const actions = within(row!);
  await user.click(actions.getByRole("button", { name: /disable catalog admin/i }));
  expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("/status"), expect.objectContaining({ method: "PATCH" }));
  expect(actions.getByText(/disable this administrator/i)).toBeVisible();
  await user.click(actions.getByRole("button", { name: /confirm disable/i }));
  await waitFor(() => expect(actions.getByRole("button", { name: /reactivate catalog admin/i })).toBeVisible());
  await user.click(actions.getByRole("button", { name: /reactivate catalog admin/i }));
  expect(actions.getByText(/reactivate this administrator/i)).toBeVisible();
  await user.click(actions.getByRole("button", { name: /confirm reactivate/i }));
  await waitFor(() => expect(actions.getByRole("button", { name: /disable catalog admin/i })).toBeVisible());
  await user.click(actions.getByRole("button", { name: /reset password for catalog admin/i }));
  expect(actions.getByText(/set a temporary password for catalog admin/i)).toBeVisible();
  const resetPassword = actions.getByLabelText(/new temporary password/i);
  await user.type(resetPassword, "AnotherTemporaryPass!23");
  await user.click(actions.getByRole("button", { name: /confirm password reset/i }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith(`/api/v1/admin/users/${encodeURIComponent(firstAdmin.id)}/reset-password`, expect.objectContaining({ method: "POST", body: JSON.stringify({ temporary_password: "AnotherTemporaryPass!23" }) })));
  expect(screen.queryByDisplayValue("AnotherTemporaryPass!23")).not.toBeInTheDocument();
  expect(screen.queryByText("AnotherTemporaryPass!23")).not.toBeInTheDocument();
});

it("clears an abandoned temporary password when switching away from reset", async () => {
  const user = userEvent.setup();
  render(<AdminPage />);
  const row = (await screen.findByText(firstAdmin.email)).closest("li");
  expect(row).not.toBeNull();
  const actions = within(row!);

  await user.click(actions.getByRole("button", { name: /reset password for catalog admin/i }));
  await user.type(actions.getByLabelText(/new temporary password/i), "AbandonedTemporaryPass!23");
  await user.click(actions.getByRole("button", { name: /disable catalog admin/i }));
  expect(actions.getByText(/disable this administrator/i)).toBeVisible();
  await user.click(actions.getByRole("button", { name: /reset password for catalog admin/i }));

  expect(actions.getByLabelText(/new temporary password/i)).toHaveValue("");
});

it("uses encoded user IDs and snake_case bodies in the typed client", async () => {
  vi.mocked(fetch).mockImplementation(async () => json(firstAdmin));
  await createAdministrator({ email: "member-8f75b0025e4d@example.invalid", display_name: "Catalog Admin", temporary_password: "TemporaryPassphrase!23" });
  await setAdministratorStatus("admin/id", false);
  await resetAdministratorPassword("admin/id", "AnotherTemporaryPass!23");
  expect(fetch).toHaveBeenNthCalledWith(1, "/api/v1/admin/users", expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "member-d0e98d21c8cd@example.invalid", display_name: "Catalog Admin", temporary_password: "TemporaryPassphrase!23" }) }));
  expect(fetch).toHaveBeenNthCalledWith(2, "/api/v1/admin/users/admin%2Fid/status", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ is_active: false }) }));
  expect(fetch).toHaveBeenNthCalledWith(3, "/api/v1/admin/users/admin%2Fid/reset-password", expect.objectContaining({ method: "POST", body: JSON.stringify({ temporary_password: "AnotherTemporaryPass!23" }) }));
});

it("renders controlled loading errors as alerts", async () => {
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => requestPath(input) === "/api/v1/admin/catalog/status" ? errorJson("request_failed", "Sensitive internal detail.", 500) : json(administrators));
  render(<AdminPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent(/could not load catalog status/i);
  expect(screen.queryByText(/sensitive internal detail/i)).not.toBeInTheDocument();
});
