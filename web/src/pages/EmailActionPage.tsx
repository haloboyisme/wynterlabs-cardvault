import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, apiRequest } from "../lib/api";

type Purpose = "verify" | "reset";
const failure = (reason: unknown) => reason instanceof ApiError ? reason.message : "The request could not be completed. Please try again.";

export function EmailActionPage({ purpose }: { purpose: Purpose }) {
  const [token, setToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { window.history.replaceState({}, "", window.location.pathname); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (purpose === "reset" && password !== confirmation) { setError("Passwords must match."); return; }
    setBusy(true); setError("");
    try {
      const result = await apiRequest<{ message: string }>(`/api/v1/email/${purpose}`, {
        method: "POST", body: JSON.stringify({ token, ...(purpose === "reset" ? { password } : {}) }),
      });
      setMessage(result.message); setToken(""); setPassword(""); setConfirmation("");
    } catch (reason) { setError(failure(reason)); }
    finally { setBusy(false); }
  }
  return <section className="auth-layout"><div className="auth-aside">
    <p className="eyebrow">WynterLabs CardVault</p><h1>{purpose === "verify" ? "One step to your collection." : "Get back to your collection."}</h1>
    <p>Your link works once. Never share it. Resetting your password does not turn off two-step verification.</p>
  </div><form className="auth-card" onSubmit={(event) => void submit(event)}>
    <h2>{purpose === "verify" ? "Verify email" : "Reset password"}</h2>
    {message ? <><p className="form-success" role="status">{message}</p><Link className="button primary" to="/login">Sign in</Link></> : token ? <>
      {purpose === "reset" && <>
        <label>New password<input type="password" autoComplete="new-password" minLength={12} maxLength={256} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label>Confirm password<input type="password" autoComplete="new-password" minLength={12} maxLength={256} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
      </>}
      <button className="button primary wide" disabled={busy}>{busy ? "Working…" : purpose === "verify" ? "Verify email" : "Change password"}</button>
    </> : <p>Open the full link from your email to continue.</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {!message && <Link to={purpose === "verify" ? "/resend-verification" : "/forgot-password"}>Request a new link</Link>}
  </form></section>;
}

export function EmailRequestPage({ purpose }: { purpose: Purpose }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await apiRequest<{ message: string }>(`/api/v1/email/request-${purpose === "verify" ? "verification" : "reset"}`, { method: "POST", body: JSON.stringify({ email }) });
      setMessage(result.message);
    } catch (reason) { setError(failure(reason)); }
    finally { setBusy(false); }
  }
  return <section className="auth-layout"><div className="auth-aside"><p className="eyebrow">Account help</p>
    <h1>{purpose === "verify" ? "Check your inbox." : "Forgot your password?"}</h1>
    <p>Your server owner must enable email delivery. If no email arrives, check spam or contact your owner. The link must be opened where you can reach this server.</p>
  </div><form className="auth-card" onSubmit={(event) => void submit(event)}>
    <h2>{purpose === "verify" ? "Resend verification" : "Password recovery"}</h2>
    <label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    <button className="button primary wide" disabled={busy}>{busy ? "Requesting…" : purpose === "verify" ? "Send verification link" : "Send reset link"}</button>
    {message && <p role="status" className="form-success">{message}</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <Link to="/login">Back to sign in</Link>
  </form></section>;
}
