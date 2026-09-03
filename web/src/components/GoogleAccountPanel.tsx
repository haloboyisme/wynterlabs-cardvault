import { type FormEvent, useEffect, useState } from "react";
import { ApiError, apiRequest } from "../lib/api";
export function GoogleAccountPanel() {
  const [state, setState] = useState<{ enabled: boolean; linked: boolean } | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const result = new URLSearchParams(window.location.search).get("google");
  const [message, setMessage] = useState(result === "linked" ? "Google account linked successfully." : result === "conflict" ? "A different Google link already exists. Unlink it first." : "");
  useEffect(() => {
    const c = new AbortController();
    void apiRequest<{ enabled: boolean; linked: boolean }>("/api/v1/account/google", { signal: c.signal }).then(v => { if (!c.signal.aborted) setState(v); }).catch(() => {});
    return () => c.abort();
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy || !state) return;
    setBusy(true); setError("");
    try {
      const payload = { method: "POST", body: JSON.stringify({ current_password: password }) };
      if (state.linked) {
        await apiRequest<void>("/api/v1/account/google/unlink", payload);
        setState({ ...state, linked: false }); setPassword(""); setMessage("Google unlinked. Your password still works.");
      } else {
        const r = await apiRequest<{ url: string }>("/api/v1/auth/google/link", payload);
        window.location.assign(r.url);
      }
    } catch (r) { setError(r instanceof ApiError ? r.message : "Could not update Google link."); }
    finally { setBusy(false); }
  }
  if (!state || (!state.enabled && !state.linked)) return null;
  return <section className="panel" aria-label="Linked sign-in methods"><h2>Linked sign-in methods</h2>
    <p>Google: {state.linked ? "Linked" : "Not linked"}. Your password and CardVault MFA remain in place.</p>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    <form onSubmit={e => void submit(e)}><label>Current CardVault password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
    <button className="button secondary" disabled={busy}>{busy ? "Working…" : state.linked ? "Unlink Google" : "Link Google account"}</button></form>
  </section>;
}
