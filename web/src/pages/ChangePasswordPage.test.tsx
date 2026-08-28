import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, vi } from "vitest";

import { App } from "../app/App";

const forcedAdmin = {
  id: "admin-id",
  email: "member-fe8a92d9beeb@example.invalid",
  display_name: "Administrator",
  role: "admin",
  must_change_password: true,
  created_at: "2026-08-14T00:00:00Z",
};

function renderPasswordChange() {
  window.history.pushState({}, "", "/change-password");
  return render(<App />);
}

function stubPasswordApi(
  changeResponse: () => Response | Promise<Response> = () => new Response(null, { status: 204 }),
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/v1/auth/me")) {
      return new Response(JSON.stringify(forcedAdmin), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith("/api/v1/auth/change-password")) {
      return changeResponse();
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function completeForm(
  user: ReturnType<typeof userEvent.setup>,
  confirmation = "permanent winter password",
) {
  await user.type(
    await screen.findByLabelText(/temporary password/i),
    "temporary winter admin",
  );
  await user.type(screen.getByLabelText(/^new password$/i), "permanent winter password");
  await user.type(screen.getByLabelText(/confirm new password/i), confirmation);
}

beforeEach(() => {
  window.history.pushState({}, "", "/");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("changes the password with exact API fields, clears auth, and returns to login", async () => {
  const fetchMock = stubPasswordApi();
  const user = userEvent.setup();
  renderPasswordChange();

  await completeForm(user);
  await user.click(screen.getByRole("button", { name: /set permanent password/i }));

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/change-password",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          current_password: "test-only-credential-35b231b8da9a",
          new_password: "test-only-credential-976634524f60",
        }),
      }),
    );
  });
  expect(await screen.findByRole("heading", { name: /welcome back/i })).toBeVisible();
  expect(window.history.state).toMatchObject({
    usr: { message: "Your new password is ready. Sign in to continue." },
  });
  expect(screen.getByText(/new password is ready/i)).toBeVisible();
  expect(screen.getByRole("link", { name: /sign in/i })).toBeVisible();
  expect(window.location.pathname).toBe("/login");
});

it("rejects mismatched confirmation without calling the password endpoint", async () => {
  const fetchMock = stubPasswordApi();
  const user = userEvent.setup();
  renderPasswordChange();

  await completeForm(user, "a different permanent password");
  await user.click(screen.getByRole("button", { name: /set permanent password/i }));

  expect(await screen.findByRole("alert")).toHaveTextContent(/passwords do not match/i);
  expect(
    fetchMock.mock.calls.some(([input]) =>
      String(input).endsWith("/api/v1/auth/change-password"),
    ),
  ).toBe(false);
});

it("rejects a new password shorter than twelve characters without a request", async () => {
  const fetchMock = stubPasswordApi();
  const user = userEvent.setup();
  renderPasswordChange();

  await user.type(await screen.findByLabelText(/temporary password/i), "temporary winter admin");
  await user.type(screen.getByLabelText(/^new password$/i), "too short");
  await user.type(screen.getByLabelText(/confirm new password/i), "too short");
  await user.click(screen.getByRole("button", { name: /set permanent password/i }));

  expect(await screen.findByRole("alert")).toHaveTextContent(/at least 12 characters/i);
  expect(
    fetchMock.mock.calls.some(([input]) =>
      String(input).endsWith("/api/v1/auth/change-password"),
    ),
  ).toBe(false);
});

it("renders API failures in a live alert", async () => {
  stubPasswordApi(() => new Response(
    JSON.stringify({
      error: {
        code: "invalid_current_password",
        message: "The temporary password is incorrect.",
        fields: null,
        request_id: "test-request",
      },
    }),
    {
      status: 400,
      headers: { "content-type": "application/json" },
    },
  ));
  const user = userEvent.setup();
  renderPasswordChange();

  await completeForm(user);
  await user.click(screen.getByRole("button", { name: /set permanent password/i }));

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveAttribute("aria-live", "assertive");
  expect(alert).toHaveTextContent("The temporary password is incorrect.");
  expect(screen.getByRole("heading", { name: /set your permanent password/i })).toBeVisible();
});

it("uses password-manager autocomplete hints for all password fields", async () => {
  stubPasswordApi();
  renderPasswordChange();

  expect(await screen.findByLabelText(/temporary password/i)).toHaveAttribute(
    "autocomplete",
    "current-password",
  );
  expect(screen.getByLabelText(/^new password$/i)).toHaveAttribute(
    "autocomplete",
    "new-password",
  );
  expect(screen.getByLabelText(/confirm new password/i)).toHaveAttribute(
    "autocomplete",
    "new-password",
  );
});
