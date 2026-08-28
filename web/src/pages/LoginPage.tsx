import { type FormEvent, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../app/auth";
import { ApiError } from "../lib/api";

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const message = (location.state as { message?: string } | null)?.message;

  if (auth.status === "authenticated") {
    return <Navigate to="/dashboard" replace />;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const destination = (location.state as { from?: string } | null)?.from ?? "/dashboard";
      const status = await auth.login(email, password);
      navigate(status === "mfa_required" ? "/mfa-challenge" : destination, {
        replace: true,
        state: status === "mfa_required" ? { from: destination } : undefined,
      });
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "Sign in could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-layout">
      <div className="auth-aside">
        <p className="eyebrow">Private access</p>
        <h1>Welcome back to your collection.</h1>
        <p>This private foundation is available only from your local network.</p>
        <blockquote>Build the calm place first. Then fill it with every card.</blockquote>
      </div>
      <form className="auth-card" onSubmit={(event) => void submit(event)}>
        <div>
          <p className="form-kicker">WynterLabs Cards</p>
          <h2>Sign in</h2>
          <p>Use your WynterLabs account.</p>
        </div>
        {message && <div className="form-note" role="status">{message}</div>}
        {error && <div className="form-error" role="alert">{error}</div>}
        <label>Email address<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <button className="button primary wide" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
        <p className="form-note">First visit? <Link to="/setup">Complete owner setup</Link></p>
      </form>
    </section>
  );
}
