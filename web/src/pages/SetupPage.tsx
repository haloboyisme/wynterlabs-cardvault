import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError, apiRequest } from "../lib/api";
import type { User } from "../lib/types";

export function SetupPage() {
  const navigate = useNavigate();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [secret, setSecret] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiRequest<{ available: boolean }>("/api/v1/setup/status")
      .then((result) => {
        if (!result.available) {
          navigate("/login", { replace: true, state: { message: "Setup is already complete." } });
          return;
        }
        setAvailable(true);
      })
      .catch(() => setError("Setup status is unavailable."));
  }, [navigate]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiRequest<User>("/api/v1/setup/owner", {
        method: "POST",
        headers: { "X-Bootstrap-Secret": secret },
        body: JSON.stringify({ email, display_name: displayName, password }),
      });
      navigate("/login", { replace: true });
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "Owner setup failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-layout setup-layout">
      <div className="auth-aside">
        <p className="eyebrow">One-time setup</p>
        <h1>Create the WynterLabs owner account.</h1>
        <p>The bootstrap secret stays on this server. It is used once and never becomes your password.</p>
      </div>
      <form className="auth-card" onSubmit={(event) => void submit(event)}>
        <div><p className="form-kicker">Secure initialization</p><h2>Owner details</h2></div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <label>Bootstrap secret<input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} required /></label>
        <label>Email address<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Display name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} minLength={2} required /></label>
        <label>Password<input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={12} required /></label>
        <label>Confirm password<input type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required /></label>
        <button className="button primary wide" disabled={busy || available === null}>{busy ? "Creating owner..." : "Create owner account"}</button>
      </form>
    </section>
  );
}
