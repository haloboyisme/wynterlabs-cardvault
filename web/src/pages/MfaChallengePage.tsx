import { type FormEvent, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../app/auth";
import { ApiError, apiRequest } from "../lib/api";
import type { User } from "../lib/types";

export function MfaChallengePage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<"totp" | "recovery">("totp");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const destination = (location.state as { from?: string } | null)?.from ?? "/dashboard";

  if (auth.status === "authenticated") return <Navigate to={destination} replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiRequest<User>(`/api/v1/auth/mfa/${mode}`, {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setCode("");
      await auth.refresh();
      navigate(destination, { replace: true });
    } catch (reason) {
      setCode("");
      setError(reason instanceof ApiError ? reason.message : "Two-step verification could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="auth-layout"><form className="auth-card" onSubmit={(event) => void submit(event)}>
    <div><p className="form-kicker">WynterLabs CardVault</p><h1>Two-step verification</h1><p>Enter a code from your authenticator or a recovery code.</p></div>
    {error && <div className="form-error" role="alert">{error}</div>}
    <fieldset><legend>Verification method</legend>
      <label><input type="radio" checked={mode === "totp"} onChange={() => { setMode("totp"); setCode(""); }} />Authenticator code</label>
      <label><input type="radio" checked={mode === "recovery"} onChange={() => { setMode("recovery"); setCode(""); }} />Recovery code</label>
    </fieldset>
    <label>{mode === "totp" ? "Authenticator code" : "Recovery code"}
      <input value={code} onChange={(event) => setCode(event.target.value)} autoComplete="one-time-code" inputMode={mode === "totp" ? "numeric" : "text"} pattern={mode === "totp" ? "[0-9]{6}" : undefined} required />
    </label>
    <button className="button primary wide" disabled={busy}>{busy ? "Verifying..." : "Continue"}</button>
  </form></section>;
}
