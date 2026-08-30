import { apiRequest } from "./api";

export interface Branding {
  site_name: string;
  product_name: string;
  tagline: string;
  has_custom_logo: boolean;
  logo_revision: string | null;
}

export interface BrandingUpdate {
  site_name: string;
  product_name: string;
  tagline: string;
  logo_data_url: string | null;
}

export const DEFAULT_BRANDING: Branding = {
  site_name: "WynterLabs",
  product_name: "CardVault",
  tagline: "Scan it. Sort it. Own your collection.",
  has_custom_logo: false,
  logo_revision: null,
};

function isBranding(value: unknown): value is Branding {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Branding>;
  return (
    typeof candidate.site_name === "string" &&
    typeof candidate.product_name === "string" &&
    typeof candidate.tagline === "string" &&
    typeof candidate.has_custom_logo === "boolean" &&
    (candidate.logo_revision === null || typeof candidate.logo_revision === "string")
  );
}

export async function getBranding(signal?: AbortSignal) {
  const branding = await apiRequest<unknown>("/api/v1/branding", { signal });
  return isBranding(branding) ? branding : DEFAULT_BRANDING;
}

export function updateBranding(payload: BrandingUpdate) {
  return apiRequest<Branding>("/api/v1/admin/branding", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteBrandLogo() {
  return apiRequest<Branding>("/api/v1/admin/branding/logo", { method: "DELETE" });
}

export function resetBranding() {
  return apiRequest<Branding>("/api/v1/admin/branding/reset", { method: "POST" });
}
