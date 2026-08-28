import { type FormEvent, useEffect, useState } from "react";
import QRCode from "qrcode";

import { ApiError, apiRequest } from "../lib/api";
import type { MfaEnrollment, MfaStatus } from "../lib/types";

function EnrollmentQrCode({ uri }: { uri: string }) {
  const [source, setSource] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setSource("");
    setFailed(false);
    void QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 2, width: 280 })
      .then((result) => { if (active) setSource(result); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [uri]);

  if (failed) return <p role="status">The QR code could not be created. Use the manual setup key below.</p>;
  return <div className="mfa-qr-panel"><p><strong>Scan with your authenticator app</strong></p>{source ? <img className="mfa-qr-code" src={source} alt="Authenticator setup QR code" /> : <p role="status">Creating secure QR code…</p>}<p className="muted">The QR code is created only in this browser and disappears when setup ends.</p></div>;
}

export function MfaSettings({ role }: { role: "owner" | "admin" | "member" }) {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  function clearOneTimeMaterial() {
    setEnrollment(null);
    setRecoveryCodes(null);
    setSaved(false);
    setCode("");
  }

  useEffect(() => {
    if (role === "member") return;
    void apiRequest<MfaStatus>("/api/v1/account/mfa").then(setStatus).catch(() => setError("Two-step verification settings could not be loaded."));
  }, [role]);
  if (role === "member") return null;

  async function begin(event: FormEvent) {
    event.preventDefault(); setError(""); clearOneTimeMaterial();
    try { setEnrollment(await apiRequest<MfaEnrollment>("/api/v1/account/mfa/enrollment", { method: "POST", body: JSON.stringify({ current_password: password }) })); setPassword(""); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : "Enrollment could not be started."); }
  }
  async function confirm(event: FormEvent) {
    event.preventDefault(); setError("");
    try { const result = await apiRequest<{ recovery_codes: string[] }>("/api/v1/account/mfa/enrollment/confirm", { method: "POST", body: JSON.stringify({ code }) }); setRecoveryCodes(result.recovery_codes); setEnrollment(null); setCode(""); setStatus(await apiRequest<MfaStatus>("/api/v1/account/mfa")); }
    catch (reason) { setCode(""); setError(reason instanceof ApiError ? reason.message : "Authenticator code could not be verified."); }
  }
  async function copyProvisioningUri() {
    if (!enrollment) return;
    try {
      await navigator.clipboard.writeText(enrollment.otpauth_uri);
    } catch {
      setError("The setup URI could not be copied. Enter the displayed secret manually.");
    }
  }
  async function regenerate(event: FormEvent) {
    event.preventDefault(); setError(""); clearOneTimeMaterial();
    try { const result = await apiRequest<{ recovery_codes: string[] }>("/api/v1/account/mfa/recovery-codes", { method: "POST", body: JSON.stringify({ current_password: password, code }) }); setRecoveryCodes(result.recovery_codes); setPassword(""); setCode(""); setStatus(await apiRequest<MfaStatus>("/api/v1/account/mfa")); }
    catch (reason) { setCode(""); setError(reason instanceof ApiError ? reason.message : "Recovery codes could not be replaced."); }
  }

  return <section className="sessions-card" aria-labelledby="mfa-heading"><div><p className="eyebrow">Privileged account</p><h2 id="mfa-heading">Two-step verification</h2></div>
    {error && <p role="alert">{error}</p>}
    {status?.enabled && <p role="status">Enabled. {status.recovery_codes_remaining} recovery codes remain.</p>}
    {!status?.enabled && !enrollment && <form onSubmit={(event) => void begin(event)}><label>Current password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label><button className="button ghost">Set up two-step verification</button></form>}
    {enrollment && <form onSubmit={(event) => void confirm(event)}><EnrollmentQrCode uri={enrollment.otpauth_uri} /><p>Or enter this one-time setup key manually. It will not be shown again.</p><code>{enrollment.secret}</code><p><button type="button" className="button ghost" onClick={() => void copyProvisioningUri()}>Copy authenticator setup URI</button></p><label>Authenticator code<input value={code} onChange={(event) => setCode(event.target.value)} autoComplete="one-time-code" inputMode="numeric" required /></label><button className="button primary">Confirm and show recovery codes</button><button type="button" className="button ghost" onClick={clearOneTimeMaterial}>Cancel setup</button></form>}
    {status?.enabled && !enrollment && <form onSubmit={(event) => void regenerate(event)}><h3>Replace recovery codes</h3><label>Current password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label><label>Authenticator code<input value={code} onChange={(event) => setCode(event.target.value)} autoComplete="one-time-code" inputMode="numeric" required /></label><button className="button ghost">Replace recovery codes</button></form>}
    {recoveryCodes && <div role="status"><h3>Save recovery codes now</h3><ul>{recoveryCodes.map((item) => <li key={item}><code>{item}</code></li>)}</ul><label><input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />I saved these codes somewhere safe.</label>{saved && <button type="button" className="button primary" onClick={clearOneTimeMaterial}>I saved them — clear recovery codes</button>}</div>}
  </section>;
}
