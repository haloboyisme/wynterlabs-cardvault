import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { App } from "../app/App";

const user = {
  id: "owner-id", email: "member-ea81e9205c63@example.invalid", display_name: "Owner", role: "owner",
  must_change_password: false, created_at: "2026-08-26T00:00:00Z",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

beforeEach(() => {
  // BrowserRouter reads location state from the `usr` history field.
  window.history.pushState({ usr: { from: "/account" }, key: "mfa-test" }, "", "/mfa-challenge");
  let authenticated = false;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === "/api/v1/auth/me") return authenticated ? json(user) : json({ error: { code: "not_authenticated" } }, 401);
    if (path === "/api/v1/auth/mfa/totp" && init?.method === "POST") {
      authenticated = true;
      return json(user);
    }
    return json({ error: { code: "mfa_challenge_invalid", message: "Two-step verification could not be completed." } }, 401);
  }));
});
afterEach(() => vi.unstubAllGlobals());

it("submits a TOTP, clears the input, and continues only after refresh", async () => {
  render(<App />);
  await screen.findByRole("heading", { name: "Two-step verification" });
  const input = screen.getAllByLabelText("Authenticator code")[1];
  fireEvent.change(input, { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([path]) => String(path) === "/api/v1/auth/mfa/totp")).toBe(true));
  await waitFor(() => expect(window.location.pathname).toBe("/account"));
});

it("switches to recovery entry and clears a rejected code", async () => {
  render(<App />);
  await screen.findByRole("heading", { name: "Two-step verification" });
  fireEvent.click(screen.getAllByLabelText("Recovery code")[0]);
  const input = screen.getAllByLabelText("Recovery code")[1];
  fireEvent.change(input, { target: { value: "ABCDE-FGHIJ-KLMNO-PQRST" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Two-step verification could not be completed.");
  expect(input).toHaveValue("");
});
