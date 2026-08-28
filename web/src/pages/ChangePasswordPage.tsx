import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../app/auth";
import { ApiError } from "../lib/api";

export function ChangePasswordPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");

    if (newPassword.length < 12) {
      setError("Your new password must be at least 12 characters.");
      return;
    }
    if (newPassword !== confirmation) {
      setError("The new passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      await auth.changePassword(currentPassword, newPassword);
      navigate("/login", {
        replace: true,
        state: { message: "Your new password is ready. Sign in to continue." },
      });
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason.message
          : "Your password could not be changed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-layout">
      <div className="auth-aside">
        <p className="eyebrow">Administrator security</p>
        <h1>Set your permanent password.</h1>
        <p>
          Replace the temporary password before opening the private Cards workspace.
        </p>
      </div>
      <form className="auth-card" onSubmit={(event) => void submit(event)}>
        <div>
          <p className="form-kicker">WynterLabs CardVault</p>
          <h2>Secure your account</h2>
          <p>Your permanent password must contain at least 12 characters.</p>
        </div>
        {error && (
          <div className="form-error" role="alert" aria-live="assertive">
            {error}
          </div>
        )}
        <label>
          Temporary password
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
        </label>
        <label>
          New password
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
            minLength={12}
          />
        </label>
        <label>
          Confirm new password
          <input
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            required
            minLength={12}
          />
        </label>
        <button className="button primary wide" disabled={busy}>
          {busy ? "Setting permanent password..." : "Set permanent password"}
        </button>
      </form>
    </section>
  );
}
