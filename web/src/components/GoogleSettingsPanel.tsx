import { type FormEvent, useEffect, useState } from "react";
import { ApiError, apiRequest } from "../lib/api";
type Config = { enabled: boolean; client_id: string; site_url: string; has_secret: boolean; callback_path: string };
export function GoogleSettingsPanel() {
  const [config, setConfig] = useState<Config | null>(null);
  const [secret, setSecret] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    void apiRequest<Config>("/api/v1/admin/google", { signal: c.signal }).then(v => {
      if (!c.signal.aborted) setConfig({ ...v, site_url: v.site_url || window.location.origin });
    }).catch(() => { if (!c.signal.aborted) setError("Google settings could not be loaded."); });
    return () => c.abort();
  }, []);
  async function save(e: FormEvent) {
    e.preventDefault(); if (busy || !config) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const v = await apiRequest<Config>("/api/v1/admin/google", { method: "PUT", body: JSON.stringify({ enabled: config.enabled, client_id: config.client_id, site_url: config.site_url, client_secret: secret || null, current_password: password }) });
      setConfig(v); setSecret(""); setPassword("");
      setMessage(v.enabled ? "Saved. Link Google in Account, then test sign-in." : "Google disabled. Password sign-in remains available.");
    } catch (r) { setError(r instanceof ApiError ? r.message : "Could not save Google settings."); }
    finally { setBusy(false); }
  }
  return <section className="panel" aria-label="Google sign-in setup"><h2>Google sign-in — optional</h2>
    <p>Configure after Docker installation. Password login remains available; Google never grants administrator privileges.</p>
    <details><summary>Setup instructions</summary><ol>
      <li>Use a working HTTPS hostname. For private servers, keep DNS local; no public ports are needed.</li>
      <li>Create a Web application client in Google Auth Platform. In Testing, add your Google accounts under Audience → Test users.</li>
      <li>Register the exact redirect URI below. Enter the client ID and secret, enable, and save.</li>
      <li>In Account, link Google using your current CardVault password, then test signing in.</li>
    </ol></details>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {config && <form onSubmit={e => void save(e)}><fieldset disabled={busy}>
      <label><input type="checkbox" checked={config.enabled} onChange={e => setConfig({ ...config, enabled: e.target.checked })} />Enable Google sign-in</label>
      <label>Google client ID<input required autoComplete="off" value={config.client_id} onChange={e => setConfig({ ...config, client_id: e.target.value })} /></label>
      <label>Google client secret<input type="password" autoComplete="new-password" required={!config.has_secret} value={secret} placeholder={config.has_secret ? "Saved — leave blank to keep" : "Client secret"} onChange={e => setSecret(e.target.value)} /></label>
      <label>Google sign-in HTTPS address<input type="url" required value={config.site_url} onChange={e => setConfig({ ...config, site_url: e.target.value })} /></label>
      <p>Authorized redirect URI: <code>{config.site_url.replace(/\/$/, "")}{config.callback_path}</code></p>
      <label>Your current password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
      <button className="button primary">{busy ? "Saving…" : "Save Google settings"}</button>
    </fieldset></form>}
  </section>;
}
