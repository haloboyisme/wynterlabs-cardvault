import { type FormEvent, useEffect, useState } from "react";

import type { User } from "../lib/types";
import {
  cancelAccountDeletion,
  changeAccountEmail,
  getAccountPreferences,
  getDeletionRequest,
  requestAccountDeletion,
  updateAccountPreferences,
  type AccountDeletionRequest,
} from "../lib/account";
import { ApiError } from "../lib/api";
import { FeedbackBanner } from "./workspace/FeedbackBanner";

export function AccountManagementPanel({ user }: { user: User }) {
  const [shareActivity, setShareActivity] = useState(false);
  const [deletion, setDeletion] = useState<AccountDeletionRequest | null>(null);
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      getAccountPreferences(controller.signal),
      getDeletionRequest(controller.signal),
    ]).then(([preferences, request]) => {
      setShareActivity(Boolean(preferences?.share_activity));
      setDeletion(request?.id ? request : null);
    }).catch(() => undefined);
    return () => controller.abort();
  }, []);

  async function savePrivacy(next: boolean) {
    setShareActivity(next);
    setError("");
    try {
      const saved = await updateAccountPreferences(next);
      setShareActivity(saved.share_activity);
      setMessage(saved.share_activity ? "Your activity can now appear in the private member feed." : "Your activity is hidden from the member feed.");
    } catch {
      setShareActivity(!next);
      setError("Your activity privacy setting could not be saved.");
    }
  }

  async function submitEmail(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      await changeAccountEmail(email, password);
      window.location.assign("/login?email-changed=1");
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "Your email could not be changed.");
      setBusy(false);
    }
  }

  async function submitDeletion(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const request = await requestAccountDeletion(deletePassword);
      setDeletion(request); setDeletePassword("");
      setMessage("Deletion requested. The owner must approve it before anything is removed.");
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "The deletion request could not be created.");
    } finally { setBusy(false); }
  }

  async function cancelDeletion() {
    setBusy(true); setError("");
    try {
      await cancelAccountDeletion(); setDeletion(null);
      setMessage("Your account deletion request was canceled.");
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "The request could not be canceled.");
    } finally { setBusy(false); }
  }

  return <section className="account-management-card" aria-labelledby="account-management-heading">
    <div className="account-card-heading"><div><p className="eyebrow">Identity and privacy</p><h2 id="account-management-heading">Account controls</h2></div><p>No email service required</p></div>
    {message && <FeedbackBanner tone="success">{message}</FeedbackBanner>}
    {error && <FeedbackBanner tone="error">{error}</FeedbackBanner>}
    <div className="account-management-grid">
      <form onSubmit={(event) => void submitEmail(event)}>
        <h3>Change email</h3><p>Confirm with your password. You will be signed out on every device.</p>
        <label>New email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>Current password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        <button type="submit" disabled={busy}>Save email and sign out</button>
      </form>
      <div>
        <h3>Private activity feed</h3><p>Off by default. Prices, conditions, notes, email, and scanner photos are never shown.</p>
        <label className="account-privacy-toggle"><input type="checkbox" checked={shareActivity} onChange={(event) => void savePrivacy(event.target.checked)} />Show my display name and recent card additions to signed-in members</label>
      </div>
    </div>
    <div className="account-delete-zone">
      <h3>Account deletion</h3>
      {user.role === "owner" ? <p>The owner account is protected. Transfer or retire the server outside this page.</p> : deletion ? <>
        <p>Your deletion request is pending owner review. Your account remains available until approval.</p>
        <button type="button" onClick={() => void cancelDeletion()} disabled={busy}>Cancel deletion request</button>
      </> : <form onSubmit={(event) => void submitDeletion(event)}>
        <p>This requests permanent deletion. The owner must review and approve it.</p>
        <label>Current password<input type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} required /></label>
        <button className="admin-destructive" type="submit" disabled={busy}>Request account deletion</button>
      </form>}
    </div>
  </section>;
}
