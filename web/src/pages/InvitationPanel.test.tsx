import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { OwnerInvitationPanel } from "./AdminPage"

const invitation = {
  id: "invite-id",
  expires_at: "2026-08-22T00:00:00Z",
  revoked_at: null,
  used_at: null,
  used_by_user_id: null,
  revision: 1,
  created_at: "2026-08-15T00:00:00Z",
  status: "active",
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    if (path === "/api/v1/admin/invitations" && (!init?.method || init.method === "GET")) {
      return new Response(JSON.stringify([invitation]), { status: 200, headers: { "content-type": "application/json" } })
    }
    if (path === "/api/v1/admin/invitations" && init?.method === "POST") {
      return new Response(JSON.stringify({ ...invitation, id: "created-invite", raw_token: "one-time-private-token" }), { status: 201, headers: { "content-type": "application/json" } })
    }
    if (path.endsWith("/revoke")) {
      return new Response(JSON.stringify({ ...invitation, status: "revoked", revision: 2, revoked_at: "2026-08-15T01:00:00Z" }), { status: 200, headers: { "content-type": "application/json" } })
    }
    throw new Error("unexpected request")
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it("creates a one-time copy field, clears it after copy, and revision-revokes", async () => {
  const user = userEvent.setup()
  render(<OwnerInvitationPanel />)
  const copySpy = vi.spyOn(navigator.clipboard, "writeText")
  expect(await screen.findByText(/active/i)).toBeVisible()
  await user.click(screen.getByRole("button", { name: /create invitation link/i }))
  const field = await screen.findByLabelText(/new invitation link/i)
  expect((field as HTMLInputElement).value).toContain("#token=one-time-private-token")
  await user.click(screen.getByRole("button", { name: /copy invitation link/i }))
  expect(copySpy).toHaveBeenCalled()
  await waitFor(() => expect(screen.queryByLabelText(/new invitation link/i)).not.toBeInTheDocument())
  await user.click(screen.getAllByRole("button", { name: /revoke invitation/i })[0])
  await waitFor(() => expect(screen.getByText(/revoked/i)).toBeVisible())
  const revoke = vi.mocked(fetch).mock.calls.find(([path]) => String(path).endsWith("/revoke"))
  expect(JSON.parse(String(revoke?.[1]?.body))).toEqual({ expected_revision: 1 })
})
