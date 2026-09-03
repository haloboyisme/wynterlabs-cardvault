import { type FormEvent, useEffect, useState } from "react";
import { ApiError, apiRequest } from "../lib/api";

interface EmailSettings {
  enabled: boolean; host: string; port: number; username: string;
  from_address: string; site_url: string; has_password: boolean;
}
const initial: EmailSettings = { enabled: false, host: "smtp.gmail.com", port: 587, username: "", from_address: "", site_url: window.location.origin, has_password: false };

export function EmailSettingsPanel() {
  const [config, setConfig] = useState(initial);
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void apiRequest<EmailSettings | null>("/api/v1/admin/email", { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) { if (value) setConfig(value); setLoaded(true); } })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof ApiError ? reason.message : "Email settings could not be loaded."); });
    return () => controller.abort();
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setMessage(""); setError("");
    try {
      const { has_password: _hasPassword, ...values } = config;
      const result = await apiRequest<EmailSettings>("/api/v1/admin/email", { method: "PUT", body: JSON.stringify({ ...values, password, current_password: currentPassword }) });
      setConfig(result); setPassword("");
      setMessage(result.enabled ? "Email enabled. New public signups will verify their email; existing accounts keep working." : "Email disabled. Existing unverified accounts still need verification; re-enable email to resend their links.");
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : "Could not save email settings."); }
    finally { setCurrentPassword(""); setBusy(false); }
  }
  async function sendTest() {
    if (busy || !currentPassword) { setError("Enter your current CardVault password first."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await apiRequest<{ message: string }>("/api/v1/admin/email/test", { method: "POST", body: JSON.stringify({ current_password: currentPassword }) });
      setMessage(result.message);
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : "Test email could not be sent."); }
    finally { setCurrentPassword(""); setBusy(false); }
  }
  return <section className="admin-card" aria-labelledby="email-settings-heading">
    <p className="eyebrow">Account email</p><h2 id="email-settings-heading">Verification & recovery</h2>
    <p>Send account links through your own provider. Only owners and superadmins can change these settings. Google sign-in is separate.</p>
    {message && <p role="status" className="form-success">{message}</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {!loaded ? <p>Loading email settings…</p> : <form onSubmit={(event) => void save(event)}>
      <fieldset disabled={busy}><legend>Mail provider</legend>
        <label>Provider<select value={config.host === "smtp.gmail.com" ? "gmail" : "custom"} onChange={(event) => setConfig({ ...config, host: event.target.value === "gmail" ? "smtp.gmail.com" : "", port: 587 })}><option value="gmail">Gmail / Google Workspace</option><option value="custom">Other provider (SMTP)</option></select></label>
        <div className="admin-grid">
          <label>SMTP host<input required value={config.host} onChange={(event) => setConfig({ ...config, host: event.target.value })} /></label>
          <label>Secure connection<select value={config.port} onChange={(event) => setConfig({ ...config, port: Number(event.target.value) })}><option value={587}>587 — STARTTLS</option><option value={465}>465 — TLS</option></select></label>
          <label>SMTP username<input required autoComplete="off" value={config.username} onChange={(event) => setConfig({ ...config, username: event.target.value })} /></label>
          <label>From email address<input type="email" required value={config.from_address} onChange={(event) => setConfig({ ...config, from_address: event.target.value })} /></label>
          <label>Provider app password<input type="password" autoComplete="new-password" value={password} placeholder={config.has_password ? "Saved — leave blank to keep" : "App password or SMTP password"} onChange={(event) => setPassword(event.target.value)} /></label>
          <label>CardVault HTTPS address<input type="url" required value={config.site_url} onChange={(event) => setConfig({ ...config, site_url: event.target.value })} /></label>
        </div>
        <p className="form-note">Use an app password for Gmail, not your Google password. Links use the HTTPS address above; a private address only works on your network. Keep your separate server encryption key when restoring backups.</p>
        <label><input type="checkbox" checked={config.enabled} onChange={(event) => setConfig({ ...config, enabled: event.target.checked })} /> Enable verification and recovery email</label>
        <label>Your current CardVault password<input type="password" required autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
        <div className="workspace-routine-actions"><button className="button primary" type="submit">{busy ? "Working…" : "Save email settings"}</button><button className="button" type="button" onClick={() => void sendTest()}>Send test using saved settings</button></div>
      </fieldset>
    </form>}
  </section>;
}
