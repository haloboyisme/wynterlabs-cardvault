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

it("creates a member account from /signup without sending an invitation token or role", async () => {
  window.history.replaceState({}, "", "/signup")
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
  await user.type(screen.getByLabelText(/email/i), "member@example.com")
  await user.type(screen.getByLabelText(/display name/i), "Member Player")
  await user.type(screen.getByLabelText(/^password$/i), "a ready winter password")
  await user.type(screen.getByLabelText(/confirm password/i), "a ready winter password")
  expect(screen.getByRole("button", { name: /create member account/i })).toBeEnabled()
  expect(screen.queryByText(/owner invitation is required/i)).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: /create member account/i }))

  await waitFor(() => expect(refresh).toHaveBeenCalled())
  expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/registration")
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
    email: "member@example.com",
    display_name: "Member Player",
    password: "a ready winter password",
  })
  expect(screen.getByRole("status")).toHaveTextContent(/^Your account is ready\.$/)
  expect(screen.getByRole("status")).not.toHaveTextContent(/member|admin/i)
  expect(screen.getByRole("link", { name: /continue to dashboard/i })).toHaveAttribute(
    "href",
    "/dashboard",
  )
})

it("captures and clears the fragment, accepts chosen credentials, and clears the secret", async () => {
  window.history.replaceState({}, "", "/signup#token=private-link-token")
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
    id: "member-id",
    email: "member@example.com",
    display_name: "Member Player",
    role: "admin",
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
  expect(screen.getByRole("heading", { name: /create your account/i })).toBeVisible()
  await user.click(screen.getByRole("button", { name: /create account/i }))

  await waitFor(() => expect(refresh).toHaveBeenCalled())
  expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/invitations/accept")
  const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
  expect(body.token).toBe("private-link-token")
  expect(document.body).not.toHaveTextContent("private-link-token")
  expect(window.location.href).not.toContain("private-link-token")
  expect(screen.getByRole("status")).toHaveTextContent(/^Your account is ready\.$/)
  expect(screen.getByRole("status")).not.toHaveTextContent(/member|admin/i)
  expect(screen.getByRole("link", { name: /continue to dashboard/i })).toHaveAttribute(
    "href",
    "/dashboard",
  )
})

it("keeps a failed token submission in invitation mode on repeated submit", async () => {
  window.history.replaceState({}, "", "/signup#token=private-link-token")
  const invalidInvitation = () => new Response(JSON.stringify({
    error: { code: "invitation_invalid", message: "This invitation link is invalid or no longer available.", fields: null, request_id: "test-request" },
  }), { status: 400, headers: { "content-type": "application/json" } })
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(invalidInvitation())
    .mockResolvedValueOnce(invalidInvitation())
  vi.stubGlobal("fetch", fetchMock)
  const user = userEvent.setup()

  render(<AcceptInvitationPage />)
  await user.type(screen.getByLabelText(/email/i), "member@example.com")
  await user.type(screen.getByLabelText(/display name/i), "Member Player")
  await user.type(screen.getByLabelText(/^password$/i), "a ready winter password")
  await user.type(screen.getByLabelText(/confirm password/i), "a ready winter password")
  await user.click(screen.getByRole("button", { name: /create account/i }))

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/invitations/accept")
  expect(screen.getByRole("alert")).toHaveTextContent(/invitation link is invalid/i)
  await user.click(screen.getByRole("button", { name: /create account/i }))

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/invitations/accept")
  expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/v1/registration")).toBe(false)
})

it("rejects mismatched passwords locally in invitation mode", async () => {
  const user = userEvent.setup()
  window.history.replaceState({}, "", "/accept-invitation#token=private-link-token")
  render(<AcceptInvitationPage />)
  await user.type(screen.getByLabelText(/email/i), "member@example.com")
  await user.type(screen.getByLabelText(/display name/i), "Member Player")
  await user.type(screen.getByLabelText(/^password$/i), "a ready winter password")
  await user.type(screen.getByLabelText(/confirm password/i), "different winter password")
  await user.click(screen.getByRole("button", { name: /create account/i }))
  expect(screen.getByRole("alert")).toHaveTextContent(/passwords must match/i)
})
