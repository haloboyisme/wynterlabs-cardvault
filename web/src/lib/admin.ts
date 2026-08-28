import { apiRequest } from "./api";

export interface AdminCatalogAttempt {
  import_id: string;
  status: string;
  source_updated_at: string;
  completed_at: string | null;
  total_records: number;
  imported_records: number;
  rejected_records: number;
  set_count: number;
  oracle_count: number;
  printing_count: number;
  error_summary: string | null;
}

export interface AdminCatalogStatus {
  active_catalog: AdminCatalogAttempt | null;
  latest_attempt: AdminCatalogAttempt | null;
  games: Partial<Record<string, {
    active_catalog: AdminCatalogAttempt | null;
    latest_attempt: AdminCatalogAttempt | null;
  }>>;
}

export interface AdminCatalogRefresh {
  status: string;
  import_id: string | null;
  imported_records: number;
  rejected_records: number;
  skipped: boolean;
}

export interface Administrator {
  id: string;
  email: string;
  display_name: string;
  role: "admin";
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateAdministratorPayload {
  email: string;
  display_name: string;
  temporary_password: string;
}

export function getAdminCatalogStatus(signal?: AbortSignal) {
  return apiRequest<AdminCatalogStatus>("/api/v1/admin/catalog/status", { signal });
}

export function refreshAdminCatalog(game?: string) {
  return apiRequest<AdminCatalogRefresh>(
    `/api/v1/admin/catalog/refresh${game ? `?game=${encodeURIComponent(game)}` : ""}`,
    { method: "POST" },
  );
}

export function getAdministrators(signal?: AbortSignal) {
  return apiRequest<Administrator[]>("/api/v1/admin/users", { signal });
}

export function createAdministrator(payload: CreateAdministratorPayload) {
  return apiRequest<Administrator>("/api/v1/admin/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function setAdministratorStatus(userId: string, isActive: boolean) {
  return apiRequest<Administrator>(
    `/api/v1/admin/users/${encodeURIComponent(userId)}/status`,
    { method: "PATCH", body: JSON.stringify({ is_active: isActive }) },
  );
}

export function resetAdministratorPassword(userId: string, temporaryPassword: string) {
  return apiRequest<Administrator>(
    `/api/v1/admin/users/${encodeURIComponent(userId)}/reset-password`,
    { method: "POST", body: JSON.stringify({ temporary_password: temporaryPassword }) },
  );
}
