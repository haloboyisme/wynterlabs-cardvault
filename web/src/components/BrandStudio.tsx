import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";

import { useBranding } from "../app/branding";
import { deleteBrandLogo, resetBranding, updateBranding, type Branding } from "../lib/branding";
import { FeedbackBanner } from "./workspace/FeedbackBanner";

const ACCEPTED_LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const FALLBACK_LOGO = "/cardvault-mark.svg";

interface BrandStudioProps {
  onBrandingUpdated?: (branding: Branding) => void;
}

export function BrandStudio({ onBrandingUpdated }: BrandStudioProps) {
  const { branding, applyBranding } = useBranding();
  const [siteName, setSiteName] = useState(branding.site_name);
  const [productName, setProductName] = useState(branding.product_name);
  const [tagline, setTagline] = useState(branding.tagline);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [syncedBranding, setSyncedBranding] = useState(branding);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const draftIsDirty = siteName !== syncedBranding.site_name
    || productName !== syncedBranding.product_name
    || tagline !== syncedBranding.tagline
    || logoDataUrl !== null;

  function synchronizeDraft(current: Branding) {
    setSiteName(current.site_name);
    setProductName(current.product_name);
    setTagline(current.tagline);
    setLogoDataUrl(null);
    setSyncedBranding(current);
  }

  useEffect(() => {
    if (draftIsDirty) return;
    synchronizeDraft(branding);
  }, [branding, draftIsDirty]);

  const previewSource = logoDataUrl
    ?? (branding.has_custom_logo && branding.logo_revision
      ? `/api/v1/branding/logo?v=${encodeURIComponent(branding.logo_revision)}`
      : FALLBACK_LOGO);

  function finish(current: Branding, text: string) {
    applyBranding(current);
    onBrandingUpdated?.(current);
    synchronizeDraft(current);
    setMessage({ tone: "success", text });
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setMessage(null);
    if (!ACCEPTED_LOGO_TYPES.has(file.type)) {
      setMessage({ tone: "error", text: "Choose a PNG, JPG, JPEG, or WebP logo." });
      event.target.value = "";
      return;
    }
    if (file.size > 524288) {
      setMessage({ tone: "error", text: "Choose a logo no larger than 512 KB." });
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogoDataUrl(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => setMessage({ tone: "error", text: "The logo could not be read. Choose another file and try again." });
    reader.readAsDataURL(file);
  }

  function validatedDraft() {
    const draft = { site_name: siteName.trim(), product_name: productName.trim(), tagline: tagline.trim() };
    if (draft.site_name.length < 2 || draft.site_name.length > 48 || draft.product_name.length < 2 || draft.product_name.length > 48 || draft.tagline.length > 100) {
      setMessage({ tone: "error", text: "Use a 2–48 character site and product name, and a tagline of 100 characters or fewer." });
      return null;
    }
    return draft;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const draft = validatedDraft();
    if (!draft) return;
    setBusy(true); setMessage({ tone: "info", text: "Saving brand settings…" });
    try {
      const current = await updateBranding({ ...draft, logo_data_url: logoDataUrl });
      finish(current, "Brand settings saved.");
    } catch {
      setMessage({ tone: "error", text: "Brand settings could not be saved. Review the details and try again." });
    } finally { setBusy(false); }
  }

  async function removeLogo() {
    setBusy(true); setMessage({ tone: "info", text: "Removing custom logo…" });
    try {
      const current = await deleteBrandLogo();
      finish(current, "Custom logo removed.");
    }
    catch { setMessage({ tone: "error", text: "Custom logo could not be removed. Try again." }); }
    finally { setBusy(false); }
  }

  async function restoreDefaults() {
    setBusy(true); setMessage({ tone: "info", text: "Restoring defaults…" });
    try {
      const current = await resetBranding();
      finish(current, "Brand defaults restored.");
      setConfirmReset(false);
    } catch { setMessage({ tone: "error", text: "Brand defaults could not be restored. Try again." }); }
    finally { setBusy(false); }
  }

  return (
    <section className="admin-card brand-studio" aria-labelledby="brand-studio-heading">
      <p className="eyebrow">Shared workspace identity</p>
      <h2 id="brand-studio-heading">Brand Studio</h2>
      <p>Set the safe text and optional logo shown across this private workspace.</p>
      <div className="brand-studio-preview">
        <img src={previewSource} alt="Current logo preview" onError={(event) => { event.currentTarget.src = FALLBACK_LOGO; }} />
      </div>
      <form className="admin-create-form workspace-routine-actions" onSubmit={(event) => void save(event)}>
        <label>Site name<input value={siteName} onChange={(event) => setSiteName(event.target.value)} minLength={2} maxLength={48} required disabled={busy} /></label>
        <label>Product name<input value={productName} onChange={(event) => setProductName(event.target.value)} minLength={2} maxLength={48} required disabled={busy} /></label>
        <label>Tagline<input value={tagline} onChange={(event) => setTagline(event.target.value)} maxLength={100} disabled={busy} /></label>
        <label>Logo file<input aria-label="Logo file" type="file" accept=".png,.jpg,.jpeg,.webp" onChange={onFileChange} disabled={busy} /></label>
        <button type="submit" disabled={busy}>{busy ? "Saving brand settings" : "Save"}</button>
      </form>
      <div className="admin-actions workspace-danger-zone">
        <button type="button" onClick={() => void removeLogo()} disabled={busy || !branding.has_custom_logo}>Remove custom logo</button>
        <button className="admin-destructive" type="button" onClick={() => setConfirmReset(true)} disabled={busy}>Restore defaults</button>
      </div>
      {confirmReset && <div className="admin-confirmation admin-warning">
        <p>Restore the default name, product, tagline, and logo?</p>
        <button className="admin-destructive" type="button" onClick={() => void restoreDefaults()} disabled={busy}>Confirm restore defaults</button>
        <button type="button" onClick={() => setConfirmReset(false)} disabled={busy}>Cancel</button>
      </div>}
      {message && <FeedbackBanner tone={message.tone === "error" ? "error" : message.tone === "success" ? "success" : "info"} className={message.tone === "error" ? "form-error" : message.tone === "success" ? "form-success" : "admin-live"}>{message.text}</FeedbackBanner>}
    </section>
  );
}
