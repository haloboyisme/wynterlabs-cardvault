import { apiRequest } from "./api"
import type { User } from "./types"

export interface Invitation {
  id: string
  expires_at: string
  revoked_at: string | null
  used_at: string | null
  used_by_user_id: string | null
  revision: number
  created_at: string
  target_role: "member" | "admin"
  status: "active" | "used" | "revoked" | "expired"
}

export interface CreatedInvitation extends Invitation {
  raw_token: string
}

export interface InvitationAcceptance {
  token: string
  email: string
  display_name: string
  password: string
}

export interface MemberRegistration {
  email: string
  display_name: string
  password: string
}

export function registerMember(payload: MemberRegistration, signal?: AbortSignal) {
  return apiRequest<User>("/api/v1/registration", {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
  })
}

export function listInvitations(signal?: AbortSignal) {
  return apiRequest<Invitation[]>("/api/v1/admin/invitations", { signal })
}

export function createInvitation(targetRole: Invitation["target_role"]) {
  return apiRequest<CreatedInvitation>("/api/v1/admin/invitations", {
    method: "POST",
    body: JSON.stringify({ target_role: targetRole }),
  })
}

export function revokeInvitation(id: string, expectedRevision: number) {
  return apiRequest<Invitation>(
    `/api/v1/admin/invitations/${encodeURIComponent(id)}/revoke`,
    { method: "POST", body: JSON.stringify({ expected_revision: expectedRevision }) },
  )
}

export function acceptInvitation(payload: InvitationAcceptance, signal?: AbortSignal) {
  return apiRequest<User>("/api/v1/invitations/accept", {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
  })
}
