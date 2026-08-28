import { afterEach, expect, it, vi } from "vitest"

import { acceptInvitation } from "./invitations"

afterEach(() => vi.unstubAllGlobals())

it("posts the secret only in the acceptance body and preserves AbortError", async () => {
  const abort = new DOMException("superseded", "AbortError")
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({
      id: "member-id",
      email: "member@example.com",
      display_name: "Member",
      role: "member",
      must_change_password: false,
      created_at: "2026-08-15T00:00:00Z",
    }), { status: 201, headers: { "content-type": "application/json" } }))
    .mockRejectedValueOnce(abort)
  vi.stubGlobal("fetch", fetchMock)

  await acceptInvitation({
    token: "test-only-credential-080d6e42d53b",
    email: "member@example.com",
    display_name: "Member",
    password: "test-only-credential-5453876797d8",
  })
  expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/invitations/accept")
  expect(fetchMock.mock.calls[0][0]).not.toContain("private-token")
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
    token: "test-only-credential-7b8e5392ad16",
  })
  await expect(acceptInvitation({
    token: "test-only-credential-01f4e61ac6ed",
    email: "other@example.com",
    display_name: "Other",
    password: "test-only-credential-82b3f79d9f9a",
  })).rejects.toBe(abort)
})
