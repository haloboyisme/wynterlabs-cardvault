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
  type AdminCatalogSchedule,
  type Administrator,
  createAdministrator,
  getAdminCatalogStatus,
  getAdminCatalogSchedule,
  getAdministrators,
  refreshAdminCatalog,
  resetAdministratorPassword,
  setAdministratorStatus,
  setUserRole,
  updateAdminCatalogSchedule,
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
  managerRole: "owner" | "super_admin";
  onUpdated: () => Promise<void>;
}

function roleName(role: Administrator["role"]) {
  if (role === "super_admin") return "Super Administrator";
  if (role === "admin") return "Administrator";
  return "Member";
}

function availableRoles(
  managerRole: "owner" | "super_admin",
  currentRole: Administrator["role"],
): Administrator["role"][] {
  if (managerRole === "owner") {
    return (["member", "admin", "super_admin"] as const).filter((role) => role !== currentRole);
  }
  if (currentRole === "member") return ["admin"];
  if (currentRole === "admin") return ["member"];
  return [];
}

function AdministratorRow({ administrator, managerRole, onUpdated }: AdministratorRowProps) {
  const [confirmation, setConfirmation] = useState<"disable" | "reactivate" | "reset" | "role" | null>(null);
  const [nextRole, setNextRole] = useState<Administrator["role"] | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function changeConfirmation(next: typeof confirmation) {
    if (confirmation === "reset" && next !== "reset") setTemporaryPassword("");
    if (confirmation === "role" && next !== "role") setNextRole(null);
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

  async function updateRole() {
    if (nextRole === null) return;
    setBusy(true);
    setError(null);
    try {
      await setUserRole(administrator.id, nextRole);
      await onUpdated();
      changeConfirmation(null);
    } catch {
      setError("The account role could not be updated. Try again.");
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
        <span>{roleName(administrator.role)}</span>
        <span>{administrator.is_active ? "Active" : "Disabled"}</span>
        {administrator.must_change_password && <span>Permanent password required</span>}
      </div>
      <div className="admin-actions workspace-danger-zone">
        {availableRoles(managerRole, administrator.role).map((role) => (
          <button
            key={role}
            type="button"
            onClick={() => {
              setNextRole(role);
              changeConfirmation("role");
            }}
            disabled={busy}
          >
            Make {administrator.display_name} {role === "admin" ? "an" : "a"} {roleName(role)}
          </button>
        ))}
        {managerRole === "owner" && administrator.role === "admin" && <>
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
        </>}
      </div>

      {confirmation === "role" && nextRole !== null && (
        <div className="admin-confirmation admin-warning">
          <p>Make {administrator.display_name} {nextRole === "admin" ? "an" : "a"} {roleName(nextRole)}? Their active sessions will be revoked.</p>
          <div className="admin-actions workspace-danger-zone">
            <button type="button" onClick={() => void updateRole()} disabled={busy}>
              {busy ? "Updating account role" : `Confirm ${roleName(nextRole)}`}
            </button>
            <button type="button" onClick={() => changeConfirmation(null)} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}

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

function AdminContents({ role }: { role: "owner" | "super_admin" | "admin" }) {
  const isOwner = role === "owner";
  const isRoleManager = role === "owner" || role === "super_admin";
  const [catalog, setCatalog] = useState<AdminCatalogStatus | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogSchedule, setCatalogSchedule] = useState<AdminCatalogSchedule | null>(null);
  const [scheduleMessage, setScheduleMessage] = useState("");
  const [scheduleSaving, setScheduleSaving] = useState(false);
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
  const scheduleController = useRef<AbortController | null>(null);

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

  const loadSchedule = useCallback(async () => {
    scheduleController.current?.abort();
    const controller = new AbortController();
    scheduleController.current = controller;
    try {
      const value = await getAdminCatalogSchedule(controller.signal);
      if (!controller.signal.aborted) setCatalogSchedule(value);
    } catch (error) {
      if (!isAbort(error)) setScheduleMessage("Could not load the automatic refresh schedule.");
    } finally {
      if (scheduleController.current === controller) scheduleController.current = null;
    }
  }, []);

  const loadAdministrators = useCallback(async () => {
    if (!isRoleManager) return;
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
  }, [isRoleManager]);

  useEffect(() => {
    void loadCatalog();
    void loadSchedule();
    if (isRoleManager) void loadAdministrators();
    return () => {
      ++catalogGeneration.current;
      catalogController.current?.abort();
      scheduleController.current?.abort();
      ++administratorsGeneration.current;
      administratorsController.current?.abort();
    };
  }, [isRoleManager, loadAdministrators, loadCatalog, loadSchedule]);

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

  async function saveCatalogSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (catalogSchedule === null) return;
    setScheduleSaving(true);
    setScheduleMessage("Saving automatic refresh schedule.");
    try {
      const saved = await updateAdminCatalogSchedule(catalogSchedule);
      setCatalogSchedule(saved);
      setScheduleMessage(saved.enabled
        ? `Schedule saved. Next refresh: ${formatDate(saved.next_run_at)}.`
        : "Schedule saved. Automatic refresh is off.");
    } catch {
      setScheduleMessage("The refresh schedule could not be saved. Check the time zone and try again.");
    } finally {
      setScheduleSaving(false);
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

      {(catalog || (isRoleManager && administratorsLoaded)) && (
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
            {isRoleManager && administratorsLoaded && (
              <StatTile
                label="Account count"
                value={formatCount(administrators.length)}
                detail="Managed accounts"
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
          {catalogSchedule && (
            <form className="admin-catalog-schedule" onSubmit={(event) => void saveCatalogSchedule(event)}>
              <fieldset>
                <legend>Automatic catalog refresh</legend>
                <label className="admin-schedule-enabled">
                  <input
                    type="checkbox"
                    checked={catalogSchedule.enabled}
                    onChange={(event) => setCatalogSchedule({ ...catalogSchedule, enabled: event.target.checked })}
                  />
                  Enable automatic refresh
                </label>
                <div className="admin-schedule-grid">
                  <label>Frequency<select value={catalogSchedule.cadence} onChange={(event) => setCatalogSchedule({ ...catalogSchedule, cadence: event.target.value as AdminCatalogSchedule["cadence"] })}>
                    <option value="hours">Every number of hours</option>
                    <option value="daily">Every day</option>
                    <option value="weekly">Every week</option>
                  </select></label>
                  {catalogSchedule.cadence === "hours" && <label>Hours between refreshes<input type="number" min="1" max="168" value={catalogSchedule.interval_hours} onChange={(event) => setCatalogSchedule({ ...catalogSchedule, interval_hours: Number(event.target.value) })} /></label>}
                  {catalogSchedule.cadence === "weekly" && <label>Day of week<select value={catalogSchedule.weekday} onChange={(event) => setCatalogSchedule({ ...catalogSchedule, weekday: Number(event.target.value) })}>
                    {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day, index) => <option value={index} key={day}>{day}</option>)}
                  </select></label>}
                  {catalogSchedule.cadence !== "hours" && <label>24-hour time<input type="time" value={catalogSchedule.time_24h} onChange={(event) => setCatalogSchedule({ ...catalogSchedule, time_24h: event.target.value })} required /></label>}
                  <label>Time zone<input value={catalogSchedule.timezone} onChange={(event) => setCatalogSchedule({ ...catalogSchedule, timezone: event.target.value })} placeholder="America/Indiana/Indianapolis" required /></label>
                  <label>Scheduled catalog game<select value={catalogSchedule.game} onChange={(event) => setCatalogSchedule({ ...catalogSchedule, game: event.target.value })}>
                    <option value="all">All supported games</option>
                    {CATALOG_GAMES.map((game) => <option value={game.id} key={game.id}>{game.name}</option>)}
                  </select></label>
                </div>
                <button type="submit" disabled={scheduleSaving}>{scheduleSaving ? "Saving refresh schedule" : "Save refresh schedule"}</button>
                {catalogSchedule.next_run_at && <p>Next automatic refresh: {formatDate(catalogSchedule.next_run_at)}</p>}
                {catalogSchedule.last_status && <p>Last automatic refresh: {formatStatus(catalogSchedule.last_status)} · {formatDate(catalogSchedule.last_finished_at)}</p>}
                {scheduleMessage && <FeedbackBanner tone={scheduleMessage.includes("could not") ? "error" : "success"}>{scheduleMessage}</FeedbackBanner>}
              </fieldset>
            </form>
          )}
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
        {isRoleManager && (
          <DisclosurePanel
            title={isOwner ? "Owner maintenance" : "Account access"}
            defaultOpen={advanced}
            className="admin-owner-maintenance"
          >
            <div className="admin-owner-maintenance-grid">
              {isOwner && <OwnerInvitationPanel />}
              {!isOwner && <SuperAdministratorInvitationPanel />}
              <AccountAccessPanel
                administrators={administrators}
                loadAdministrators={loadAdministrators}
                loadError={usersError}
                managerRole={role}
              />
            </div>
          </DisclosurePanel>
        )}
      </div>
    </section>
  );
}

interface AccountAccessPanelProps {
  administrators: Administrator[];
  loadAdministrators: () => Promise<void>;
  loadError: string | null;
  managerRole: "owner" | "super_admin" | "admin";
}

function AccountAccessPanel({ administrators, loadAdministrators, loadError, managerRole }: AccountAccessPanelProps) {
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
      <p className="eyebrow">{managerRole === "owner" ? "Owner access" : "Super administrator access"}</p>
      <h2 id="administrator-heading">Account access</h2>
      <p>Maintain roles and account status. Role changes revoke active sessions.</p>
      {managerRole === "owner" && <form className="admin-create-form workspace-routine-actions" onSubmit={(event) => void create(event)}>
        <label>Administrator email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>Administrator display name<input type="text" minLength={2} maxLength={64} autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label>
        <label>Temporary password<input type="password" minLength={12} maxLength={256} autoComplete="new-password" value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} required /></label>
        <button type="submit" disabled={submitting}>{submitting ? "Creating administrator" : "Create administrator"}</button>
      </form>}
      {formError && <FeedbackBanner tone="error" className="form-error">{formError}</FeedbackBanner>}
      {loadError && <FeedbackBanner tone="error" className="form-error">{loadError}</FeedbackBanner>}
      <ul className="admin-user-list" aria-label="Managed accounts">
        {administrators.map((administrator) => (
          <AdministratorRow key={administrator.id} administrator={administrator} managerRole={managerRole as "owner" | "super_admin"} onUpdated={loadAdministrators} />
        ))}
      </ul>
    </section>
  );
}

export function AdminPage() {
  const { user } = useAuth();
  if (user?.role !== "owner" && user?.role !== "super_admin" && user?.role !== "admin") return null;
  return <AdminContents role={user.role} />;
}
import {
  type Invitation,
  createInvitation,
  listInvitations,
  revokeInvitation,
} from "../lib/invitations";

export function SuperAdministratorInvitationPanel() {
  const [oneTimeLink, setOneTimeLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createLink() {
    setBusy(true);
    setError(null);
    setOneTimeLink("");
    try {
      const created = await createInvitation("admin");
      setOneTimeLink(
        `${window.location.origin}/signup#token=${encodeURIComponent(created.raw_token)}`,
      );
    } catch {
      setError("The administrator invitation link could not be created. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-card invitation-admin" aria-labelledby="super-admin-invitation-heading">
      <p className="eyebrow">Super administrator access</p>
      <div className="admin-card-header workspace-routine-actions">
        <div>
          <h2 id="super-admin-invitation-heading">Administrator invitations</h2>
          <p>Create a private single-use administrator link that expires after seven days.</p>
        </div>
        <button type="button" onClick={() => void createLink()} disabled={busy}>
          {busy ? "Working" : "Create administrator invitation link"}
        </button>
      </div>
      {oneTimeLink && (
        <div className="invitation-copy workspace-routine-actions">
          <label>
            New administrator invitation link
            <input value={oneTimeLink} readOnly onFocus={(event) => event.target.select()} />
          </label>
          <p>This is the only time the private link will be shown.</p>
        </div>
      )}
      {error && <FeedbackBanner tone="error" className="form-error">{error}</FeedbackBanner>}
    </section>
  );
}

export function OwnerInvitationPanel() {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [oneTimeLink, setOneTimeLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [targetRole, setTargetRole] = useState<Invitation["target_role"]>("member");
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
      const created = await createInvitation(targetRole);
      const { raw_token: rawToken, ...invitation } = created;
      setInvitations((current) => [invitation, ...current]);
      setOneTimeLink(
        `${window.location.origin}/signup#token=${encodeURIComponent(rawToken)}`,
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
          <h2 id="invitation-heading">Account invitations</h2>
          <p>Create a private single-use link that expires after seven days.</p>
        </div>
        <label>
          Invitation account type
          <select value={targetRole} onChange={(event) => setTargetRole(event.target.value as Invitation["target_role"])} disabled={busy}>
            <option value="member">Member</option>
            <option value="admin">Administrator</option>
          </select>
        </label>
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
              <span>{invitation.target_role === "admin" ? "Administrator" : "Member"}</span>
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
