import type { Branding } from "../lib/branding";

export function LogoMark({ branding }: { branding: Branding }) {
  const customSource = branding.has_custom_logo && branding.logo_revision
    ? `/api/v1/branding/logo?v=${encodeURIComponent(branding.logo_revision)}`
    : "/cardvault-mark.svg";

  return (
    <img
      className="logo-mark"
      src={customSource}
      alt=""
      aria-hidden="true"
      onError={(event) => { event.currentTarget.src = "/cardvault-mark.svg"; }}
    />
  );
}
