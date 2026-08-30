import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { TradeModerationPanel } from "../components/TradeModerationPanel";
import { BrandStudio } from "../components/BrandStudio";
import { DisclosurePanel } from "../components/workspace/DisclosurePanel";
import { FeedbackBanner } from "../components/workspace/FeedbackBanner";
import { PageHeader } from "../components/workspace/PageHeader";
import { StatTile } from "../components/workspace/StatTile";
import { useAuth } from "../app/auth";
import { ApiError } from "../lib/api";
import {
  type AdminCatalogStatus,
  type Administrator,
  createAdministrator,
  getAdminCatalogStatus,
  getAdministrators,
  refreshAdminCatalog,
  resetAdministratorPassword,
  setAdministratorStatus,
} from "../lib/admin";
import { readAppearance } from "../lib/appearance";
import { CATALOG_GAMES, catalogGameName } from "../scanner/catalog-games";

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function formatCount(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDate(value: string | null) {
  if (!value) return "Unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

function formatStatus(value: string) {
  return value.length > 0 ? `${value[0].toUpperCase()}${value.slice(1)}` : "Unavailable";
}

interface AdministratorRowProps {
  administrator: Administrator;
  onUpdated: () => Promise<void>;
}

function AdministratorRow({ administrator, onUpdated }: AdministratorRowProps) {
  const [confirmation, setConfirmation] = useState<"disable" | "reactivate" | "reset" | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function changeConfirmation(next: typeof confirmation) {
    if (confirmation === "reset" && next !== "reset") setTemporaryPassword("");
    setConfirmation(next);
  }

  async function updateStatus() {
    const isActive = confirmation === "reactivate";
    setBusy(true);
    setError(null);
    try {
      await setAdministratorStatus(administrator.id, isActive);
      await onUpdated();
      changeConfirmation(null);
    } catch {
      setError("The administrator status could not be updated. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await resetAdministratorPassword(administrator.id, temporaryPassword);
      changeConfirmation(null);
      await onUpdated();
    } catch {
      setError("The temporary password could not be reset. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function cancelConfirmation() {
    changeConfirmation(null);
    setError(null);
  }

  return (
    <li className="admin-user-row">
      <div>
        <strong>{administrator.display_name}</strong>
        <span>{administrator.email}</span>
        <span>{administrator.is_active ? "Active" : "Disabled"}</span>
        {administrator.must_change_password && <span>Permanent password required</span>}
      </div>
      <div className="admin-actions workspace-danger-zone">
        <button
          className={administrator.is_active ? "admin-destructive" : ""}
          type="button"
          onClick={() => changeConfirmation(administrator.is_active ? "disable" : "reactivate")}
          disabled={busy}
        >
          {administrator.is_active ? `Disable ${administrator.display_name}` : `Reactivate ${administrator.display_name}`}
        </button>
        <button type="button" onClick={() => changeConfirmation("reset")} disabled={busy}>
          Reset password for {administrator.display_name}
        </button>
      </div>

      {(confirmation === "disable" || confirmation === "reactivate") && (
        <div className="admin-confirmation admin-warning">
          <p>
            {confirmation === "disable"
              ? "Disable this administrator? Their active sessions will be revoked."
              : "Reactivate this administrator? They will be able to sign in again."}
          </p>
          <div className="admin-actions workspace-danger-zone">
            <button
              className={confirmation === "disable" ? "admin-destructive" : ""}
              type="button"
              onClick={() => void updateStatus()}
              disabled={busy}
            >
              {busy ? "Updating administrator" : `Confirm ${confirmation}`}
            </button>
            <button type="button" onClick={cancelConfirmation} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}

      {confirmation === "reset" && (
        <form className="admin-confirmation admin-warning workspace-danger-zone" onSubmit={(event) => void resetPassword(event)}>
          <p>Set a temporary password for {administrator.display_name}. Their sessions will be revoked.</p>
          <label>
            New temporary password
            <input
              type="password"
              minLength={12}
              autoComplete="new-password"
              value={temporaryPassword}
              onChange={(event) => setTemporaryPassword(event.target.value)}
              required
            />
          </label>
          <div className="admin-actions">
            <button type="submit" disabled={busy}>
              {busy ? "Resetting password" : "Confirm password reset"}
            </button>
            <button type="button" onClick={cancelConfirmation} disabled={busy}>Cancel</button>
          </div>
        </form>
      )}
      {error && <FeedbackBanner tone="error" className="form-error">{error}</FeedbackBanner>}
    </li>
  );
}

function AdminContents({ isOwner }: { isOwner: boolean }) {
  const [catalog, setCatalog] = useState<AdminCatalogStatus | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [administrators, setAdministrators] = useState<Administrator[]>([]);
  const [administratorsLoaded, setAdministratorsLoaded] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshGame, setRefreshGame] = useState("mtg");
  const [refreshMessage, setRefreshMessage] = useState("");
  const [refreshFailed, setRefreshFailed] = useState(false);
  const refreshOpen = useRef(false);
  const catalogGeneration = useRef(0);
  const catalogController = useRef<AbortController | null>(null);
  const administratorsGeneration = useRef(0);
  const administratorsController = useRef<AbortController | null>(null);

  const loadCatalog = useCallback(async () => {
    catalogController.current?.abort();
    const controller = new AbortController();
    const generation = ++catalogGeneration.current;
    catalogController.current = controller;
    try {
      const status = await getAdminCatalogStatus(controller.signal);
      if (generation !== catalogGeneration.current || controller.signal.aborted) return;
      setCatalog(status);
      setCatalogError(null);
    } catch (error) {
      if (generation === catalogGeneration.current && !isAbort(error)) {
        setCatalogError("Could not load catalog status. The last displayed status is unchanged.");
      }
    } finally {
      if (generation === catalogGeneration.current) catalogController.current = null;
    }
  }, []);

  const loadAdministrators = useCallback(async () => {
    if (!isOwner) return;
    administratorsController.current?.abort();
    const controller = new AbortController();
    const generation = ++administratorsGeneration.current;
    administratorsController.current = controller;
    try {
      const users = await getAdministrators(controller.signal);
      if (generation !== administratorsGeneration.current || controller.signal.aborted) return;
      setAdministrators(users);
      setAdministratorsLoaded(true);
      setUsersError(null);
    } catch (error) {
      if (generation === administratorsGeneration.current && !isAbort(error)) {
        setUsersError("Could not load administrators. Try again.");
      }
    } finally {
      if (generation === administratorsGeneration.current) administratorsController.current = null;
    }
  }, [isOwner]);

  useEffect(() => {
    void loadCatalog();
    if (isOwner) void loadAdministrators();
    return () => {
      ++catalogGeneration.current;
      catalogController.current?.abort();
      ++administratorsGeneration.current;
      administratorsController.current?.abort();
    };
  }, [isOwner, loadAdministrators, loadCatalog]);

  const advanced = readAppearance().complexity === "advanced";

  async function refreshCatalog() {
    if (refreshOpen.current) return;
    refreshOpen.current = true;
    setRefreshing(true);
    setRefreshFailed(false);
    setRefreshMessage("Refreshing card database. This can take several minutes.");
    try {
      const result = await refreshAdminCatalog(refreshGame === "mtg" ? undefined : refreshGame);
      if (result.status === "unchanged" || result.skipped) {
        setRefreshMessage("Catalog already up to date. No changes were needed.");
      } else {
        setRefreshMessage("Catalog refresh complete. The latest card data is now active.");
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === "catalog_refresh_busy") {
        setRefreshMessage("A catalog refresh is already running. Status has been reloaded.");
      } else {
        setRefreshFailed(true);
        setRefreshMessage("Catalog refresh failed. The previous working catalog remains active.");
      }
    } finally {
      await loadCatalog();
      refreshOpen.current = false;
      setRefreshing(false);
    }
  }

  return (
    <section className="admin-page">
      <PageHeader
        eyebrow="Private administration"
        description="Maintain the WynterLabs card database and authorized administrators."
      >
        Admin controls
      </PageHeader>

      {(catalog || (isOwner && administratorsLoaded)) && (
        <section className="admin-operational-section" aria-labelledby="admin-operational-heading">
          <h2 id="admin-operational-heading">Operational overview</h2>
          <div className="admin-operational-overview">
            {catalog && (
              <StatTile
                label="Catalog status"
                value={catalog.active_catalog ? formatStatus(catalog.active_catalog.status) : "Unavailable"}
                detail="Current active catalog"
              />
            )}
            {catalog && (
              <StatTile
                label="Source freshness"
                value={formatDate(catalog.active_catalog?.source_updated_at ?? null)}
                detail="UTC"
              />
            )}
            {catalog?.active_catalog && (
              <StatTile
                label="Printings"
                value={formatCount(catalog.active_catalog.printing_count)}
                detail="In the active catalog"
              />
            )}
            {isOwner && administratorsLoaded && (
              <StatTile
                label="Administrator count"
                value={formatCount(administrators.length)}
                detail="Owner-authorized accounts"
              />
            )}
          </div>
        </section>
      )}

      <BrandStudio />

      <div className="admin-grid">
        <section className="admin-card" aria-labelledby="catalog-admin-heading">
          <div className="admin-card-header workspace-routine-actions">
            <div>
              <p className="eyebrow">Card data</p>
              <h2 id="catalog-admin-heading">Catalog database</h2>
            </div>
            <label>Catalog game<select value={refreshGame} onChange={(event) => setRefreshGame(event.target.value)} disabled={refreshing}>
              <option value="all">All supported games</option>
              {CATALOG_GAMES.map((game) => <option value={game.id} key={game.id}>{game.name}</option>)}
            </select></label>
            <button type="button" onClick={() => void refreshCatalog()} disabled={refreshing}>
              {refreshing ? "Refreshing card database" : "Refresh card database"}
            </button>
          </div>
          {refreshMessage && (
            <FeedbackBanner
              tone={refreshFailed ? "error" : refreshing ? "info" : "success"}
              className="admin-live"
            >
              {refreshMessage}
            </FeedbackBanner>
          )}
          {catalogError && <FeedbackBanner tone="error" className="form-error">{catalogError}</FeedbackBanner>}
          {catalog?.active_catalog ? (
            <>
              <div className="admin-status-grid">
                <div><span>Printings</span><strong>{formatCount(catalog.active_catalog.printing_count)}</strong></div>
                <div><span>Oracle cards</span><strong>{formatCount(catalog.active_catalog.oracle_count)}</strong></div>
                <div><span>Sets</span><strong>{formatCount(catalog.active_catalog.set_count)}</strong></div>
              </div>
              <dl className="admin-catalog-details">
                <div><dt>Active catalog completed</dt><dd>{formatDate(catalog.active_catalog.completed_at)}</dd></div>
                <div><dt>Source updated</dt><dd>{formatDate(catalog.active_catalog.source_updated_at)}</dd></div>
              </dl>
            </>
          ) : (
            <p>No active card catalog is available yet.</p>
          )}
          {catalog?.latest_attempt && (
            <DisclosurePanel
              title="Latest catalog attempt"
              defaultOpen={advanced}
              className="admin-attempt"
            >
              <p>Latest attempt: {catalog.latest_attempt.status}</p>
              <div className="admin-status-grid">
                <div><span>Printings</span><strong>{formatCount(catalog.latest_attempt.printing_count)}</strong></div>
                <div><span>Oracle cards</span><strong>{formatCount(catalog.latest_attempt.oracle_count)}</strong></div>
                <div><span>Sets</span><strong>{formatCount(catalog.latest_attempt.set_count)}</strong></div>
              </div>
              <dl className="admin-catalog-details">
                <div><dt>Source updated</dt><dd>{formatDate(catalog.latest_attempt.source_updated_at)}</dd></div>
                <div><dt>Completed</dt><dd>{formatDate(catalog.latest_attempt.completed_at)}</dd></div>
              </dl>
            </DisclosurePanel>
          )}
          {catalog && <section className="admin-game-status" aria-label="Catalog status by game">
            <h3>Catalog status by game</h3>
            <ul>
              {CATALOG_GAMES.map((game) => {
                const status = catalog.games?.[game.id] ?? (game.id === "mtg" ? {
                  active_catalog: catalog.active_catalog,
                  latest_attempt: catalog.latest_attempt,
                } : undefined);
                const attempt = status?.active_catalog ?? status?.latest_attempt;
                return <li key={game.id}>
                  <strong>{catalogGameName(game.id)}</strong>
                  <span>{attempt ? `${formatStatus(attempt.status)} · ${formatDate(attempt.source_updated_at)}` : "Not imported yet"}</span>
                </li>;
              })}
            </ul>
          </section>}
          <p className="admin-note">If a refresh fails, the previous working catalog stays active.</p>
        </section>

        <TradeModerationPanel />
        {isOwner && (
          <DisclosurePanel
            title="Owner maintenance"
            defaultOpen={advanced}
            className="admin-owner-maintenance"
          >
            <div className="admin-owner-maintenance-grid">
              <OwnerInvitationPanel />
              <OwnerAdministratorPanel
                administrators={administrators}
                loadAdministrators={loadAdministrators}
                loadError={usersError}
              />
            </div>
          </DisclosurePanel>
        )}
      </div>
    </section>
  );
}

interface OwnerAdministratorPanelProps {
  administrators: Administrator[];
  loadAdministrators: () => Promise<void>;
  loadError: string | null;
}

function OwnerAdministratorPanel({ administrators, loadAdministrators, loadError }: OwnerAdministratorPanelProps) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await createAdministrator({ email, display_name: displayName, temporary_password: temporaryPassword });
      setTemporaryPassword("");
      setEmail("");
      setDisplayName("");
      await loadAdministrators();
    } catch {
      setFormError("The administrator could not be created. Check the details and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="admin-card" aria-labelledby="administrator-heading">
      <p className="eyebrow">Owner only</p>
      <h2 id="administrator-heading">Administrators</h2>
      <p>Create and maintain administrator access. New administrators must replace their temporary password after signing in.</p>
      <form className="admin-create-form workspace-routine-actions" onSubmit={(event) => void create(event)}>
        <label>Administrator email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>Administrator display name<input type="text" minLength={2} maxLength={64} autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label>
        <label>Temporary password<input type="password" minLength={12} maxLength={256} autoComplete="new-password" value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} required /></label>
        <button type="submit" disabled={submitting}>{submitting ? "Creating administrator" : "Create administrator"}</button>
      </form>
      {formError && <FeedbackBanner tone="error" className="form-error">{formError}</FeedbackBanner>}
      {loadError && <FeedbackBanner tone="error" className="form-error">{loadError}</FeedbackBanner>}
      <ul className="admin-user-list" aria-label="Administrator accounts">
        {administrators.map((administrator) => (
          <AdministratorRow key={administrator.id} administrator={administrator} onUpdated={loadAdministrators} />
        ))}
      </ul>
    </section>
  );
}

export function AdminPage() {
  const { user } = useAuth();
  if (user?.role !== "owner" && user?.role !== "admin") return null;
  return <AdminContents isOwner={user.role === "owner"} />;
}
import {
  type Invitation,
  createInvitation,
  listInvitations,
  revokeInvitation,
} from "../lib/invitations";

export function OwnerInvitationPanel() {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [oneTimeLink, setOneTimeLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);

  const load = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController();
    const current = ++generation.current;
    controller.current = request;
    try {
      const rows = await listInvitations(request.signal);
      if (generation.current !== current || request.signal.aborted) return;
      setInvitations(rows);
      setError(null);
    } catch (caught) {
      if (generation.current === current && !isAbort(caught)) {
        setError("Invitation links could not be loaded. Try again.");
      }
    } finally {
      if (generation.current === current) controller.current = null;
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      ++generation.current;
      controller.current?.abort();
      setOneTimeLink("");
    };
  }, [load]);

  async function createLink() {
    setBusy(true);
    setError(null);
    setCopied(false);
    setOneTimeLink("");
    try {
      const created = await createInvitation();
      const { raw_token: rawToken, ...invitation } = created;
      setInvitations((current) => [invitation, ...current]);
      setOneTimeLink(
        `${window.location.origin}/accept-invitation#token=${encodeURIComponent(rawToken)}`,
      );
    } catch {
      setError("The invitation link could not be created. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    const link = oneTimeLink;
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setOneTimeLink("");
      setCopied(true);
    } catch {
      setError("Copy failed. Select the link and copy it manually.");
    }
  }

  async function revoke(row: Invitation) {
    setBusy(true);
    setError(null);
    try {
      const updated = await revokeInvitation(row.id, row.revision);
      setInvitations((current) =>
        current.map((item) => item.id === updated.id ? updated : item),
      );
    } catch {
      setError("The invitation could not be revoked. Refresh and try again.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-card invitation-admin" aria-labelledby="invitation-heading">
      <p className="eyebrow">Owner only</p>
      <div className="admin-card-header workspace-routine-actions">
        <div>
          <h2 id="invitation-heading">Member invitations</h2>
          <p>Create a private single-use link that expires after seven days.</p>
        </div>
        <button type="button" onClick={() => void createLink()} disabled={busy}>
          {busy ? "Working" : "Create invitation link"}
        </button>
      </div>
      {oneTimeLink && (
        <div className="invitation-copy workspace-routine-actions">
          <label>
            New invitation link
            <input value={oneTimeLink} readOnly onFocus={(event) => event.target.select()} />
          </label>
          <button type="button" onClick={() => void copyLink()}>Copy invitation link</button>
          <p>This is the only time the private link will be shown.</p>
        </div>
      )}
      {copied && <FeedbackBanner tone="success" className="form-success">Invitation link copied and cleared.</FeedbackBanner>}
      {error && <FeedbackBanner tone="error" className="form-error">{error}</FeedbackBanner>}
      <ul className="invitation-list" aria-label="Invitation links">
        {invitations.map((invitation) => (
          <li key={invitation.id} className={invitation.status === "active" ? "workspace-danger-zone" : undefined}>
            <div>
              <strong>{invitation.status}</strong>
              <span>Created {formatDate(invitation.created_at)}</span>
              <span>Expires {formatDate(invitation.expires_at)}</span>
            </div>
            {invitation.status === "active" && (
              <button
                className="admin-destructive"
                type="button"
                disabled={busy}
                onClick={() => void revoke(invitation)}
              >
                Revoke invitation
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
