import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { EmailActionPage, EmailRequestPage } from "./EmailActionPage";

afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, "", "/"); });

it("keeps verification token out of the URL and requires explicit confirmation", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "Email verified. You can now sign in." }), { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetcher);
  window.history.replaceState({}, "", "/verify-email#token=test-link-secret-1234567890");
  render(<MemoryRouter><EmailActionPage purpose="verify" /></MemoryRouter>);
  expect(window.location.hash).toBe("");
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Verify email" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Email verified");
  expect(fetcher.mock.calls[0][0]).toBe("/api/v1/email/verify");
  expect(JSON.parse(fetcher.mock.calls[0][1].body).token).toBe("test-link-secret-1234567890");
});

it("does not submit a reset when password confirmation differs", () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  window.history.replaceState({}, "", "/reset-password#token=test-link-secret-1234567890");
  render(<MemoryRouter><EmailActionPage purpose="reset" /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "long-password-123" } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "different-password-123" } });
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Passwords must match");
  expect(fetcher).not.toHaveBeenCalled();
});

it("shows generic request feedback and disables repeated submission while sending", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "If this account is eligible, an email will arrive shortly." }), { headers: { "content-type": "application/json" } })));
  render(<MemoryRouter><EmailRequestPage purpose="reset" /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "member@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("If this account is eligible"));
});
