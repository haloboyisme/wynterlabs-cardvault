import { apiRequest } from "./api";

export interface AccountPreferences { share_activity: boolean }
export interface AccountDeletionRequest {
  id: string;
  status: "pending" | "rejected" | "canceled";
  requested_at: string;
  updated_at: string;
}

export function getAccountPreferences(signal?: AbortSignal) {
  return apiRequest<AccountPreferences>("/api/v1/account/preferences", { signal });
}

export function updateAccountPreferences(shareActivity: boolean) {
  return apiRequest<AccountPreferences>("/api/v1/account/preferences", {
    method: "PUT", body: JSON.stringify({ share_activity: shareActivity }),
  });
}

export function changeAccountEmail(newEmail: string, currentPassword: string) {
  return apiRequest<void>("/api/v1/account/email", {
    method: "PUT", body: JSON.stringify({ new_email: newEmail, current_password: currentPassword }),
  });
}

export function getDeletionRequest(signal?: AbortSignal) {
  return apiRequest<AccountDeletionRequest | null>("/api/v1/account/deletion", { signal });
}

export function requestAccountDeletion(currentPassword: string) {
  return apiRequest<AccountDeletionRequest>("/api/v1/account/deletion", {
    method: "POST",
    body: JSON.stringify({ current_password: currentPassword, confirmation: "DELETE MY ACCOUNT" }),
  });
}

export function cancelAccountDeletion() {
  return apiRequest<void>("/api/v1/account/deletion", { method: "DELETE" });
}
