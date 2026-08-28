import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { MfaSettings } from "./MfaSettings";

vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(async () => "data:image/png;base64,fixture-qr") } }));

const json = (body: unknown) => new Response(JSON.stringify(body), {
  headers: { "content-type": "application/json" },
});
const fixtureSecret = "test-only-credential-6333a5b04aab";
const fixtureOtpAuthUri = ["otpauth://totp/example?", "secret=", fixtureSecret].join("");

beforeEach(() => {
  let enabled = false;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/v1/account/mfa" && !init?.method) {
      return json({ eligible: true, enabled, recovery_codes_remaining: enabled ? 1 : 0 });
    }
    if (url === "/api/v1/account/mfa/enrollment") {
      return json({ secret: fixtureSecret, otpauth_uri: fixtureOtpAuthUri, expires_at: "2026-08-26T12:05:00Z" });
    }
    if (url === "/api/v1/account/mfa/enrollment/confirm") {
      enabled = true;
      return json({ recovery_codes: ["ABCDE-FGHIJ-KLMNO-PQRST"] });
    }
    return json({});
  }));
});

afterEach(() => vi.unstubAllGlobals());

it("does not render account MFA controls for members", () => {
  render(<MfaSettings role="member" />);
  expect(screen.queryByRole("heading", { name: "Two-step verification" })).toBeNull();
});

it("shows a browser-generated QR with manual fallback and clears a cancelled ceremony", async () => {
  render(<MfaSettings role="owner" />);
  await screen.findByRole("button", { name: "Set up two-step verification" });
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "owner password" } });
  fireEvent.click(screen.getByRole("button", { name: "Set up two-step verification" }));
  await screen.findByText("ABCDEFGHIJKLMNOP");
  expect(await screen.findByRole("img", { name: "Authenticator setup QR code" })).toHaveAttribute("src", "data:image/png;base64,fixture-qr");
  expect(screen.getByText(/created only in this browser/i)).toBeVisible();
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.getByRole("button", { name: "Copy authenticator setup URI" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Cancel setup" }));
  await waitFor(() => expect(screen.queryByText("ABCDEFGHIJKLMNOP")).toBeNull());
});

it("requires acknowledgement before clearing one-time recovery codes", async () => {
  render(<MfaSettings role="owner" />);
  await screen.findByRole("button", { name: "Set up two-step verification" });
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "owner password" } });
  fireEvent.click(screen.getByRole("button", { name: "Set up two-step verification" }));
  await screen.findByText("ABCDEFGHIJKLMNOP");
  fireEvent.change(screen.getByLabelText("Authenticator code"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm and show recovery codes" }));
  await screen.findByText("ABCDE-FGHIJ-KLMNO-PQRST");
  await waitFor(() => expect(screen.getAllByRole("status").some((item) => item.textContent?.includes("Enabled. 1 recovery codes remain."))).toBe(true));
  expect(screen.queryByRole("button", { name: /clear recovery codes/i })).toBeNull();
  fireEvent.click(screen.getByLabelText("I saved these codes somewhere safe."));
  fireEvent.click(screen.getByRole("button", { name: /clear recovery codes/i }));
  await waitFor(() => expect(screen.queryByText("ABCDE-FGHIJ-KLMNO-PQRST")).toBeNull());
});
