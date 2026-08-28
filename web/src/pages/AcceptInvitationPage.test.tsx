import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import { AcceptInvitationPage } from "./AcceptInvitationPage"

const refresh = vi.fn()
vi.mock("../app/auth", () => ({ useAuth: () => ({ refresh }) }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.history.replaceState({}, "", "/")
})

it("captures and clears the fragment, accepts chosen credentials, and clears the secret", async () => {
  window.history.replaceState({}, "", "/accept-invitation#token=private-link-token")
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
    id: "member-id",
    email: "member@example.com",
    display_name: "Member Player",
    role: "member",
    must_change_password: false,
    created_at: "2026-08-15T00:00:00Z",
  }), { status: 201, headers: { "content-type": "application/json" } }))
  vi.stubGlobal("fetch", fetchMock)
  const user = userEvent.setup()

  render(<AcceptInvitationPage />)
  expect(window.location.hash).toBe("")
  await user.type(screen.getByLabelText(/email/i), "member@example.com")
  await user.type(screen.getByLabelText(/display name/i), "Member Player")
  await user.type(screen.getByLabelText(/^password$/i), "a ready winter password")
  await user.type(screen.getByLabelText(/confirm password/i), "a ready winter password")
  await user.click(screen.getByRole("button", { name: /accept invitation/i }))

  await waitFor(() => expect(refresh).toHaveBeenCalled())
  const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
  expect(body.token).toBe("private-link-token")
  expect(document.body).not.toHaveTextContent("private-link-token")
  expect(window.location.href).not.toContain("private-link-token")
})

it("rejects mismatched passwords locally and handles a missing link", async () => {
  const user = userEvent.setup()
  const missing = render(<AcceptInvitationPage />)
  expect(screen.getByRole("alert")).toHaveTextContent(/missing or no longer available/i)
  missing.unmount()
  window.history.replaceState({}, "", "/accept-invitation#token=private-link-token")
  render(<AcceptInvitationPage />)
  await user.type(screen.getByLabelText(/email/i), "member@example.com")
  await user.type(screen.getByLabelText(/display name/i), "Member Player")
  await user.type(screen.getByLabelText(/^password$/i), "a ready winter password")
  await user.type(screen.getByLabelText(/confirm password/i), "different winter password")
  await user.click(screen.getByRole("button", { name: /accept invitation/i }))
  expect(screen.getByRole("alert")).toHaveTextContent(/passwords must match/i)
})
