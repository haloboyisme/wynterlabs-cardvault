import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "../app/auth";
import { FeedbackBanner } from "../components/workspace/FeedbackBanner";
import { AutoScannerSettingsPanel } from "../components/AutoScannerSettings";
import { MfaSettings } from "../components/MfaSettings";
import { PageHeader } from "../components/workspace/PageHeader";
import { ApiError, apiRequest } from "../lib/api";
import {
  APPEARANCE_STORAGE_KEY,
  APPEARANCE_ACCENTS,
  type AppearancePreference,
  type AppearanceTheme,
  applyAppearance,
  readAppearance,
  resetAppearance,
  writeAppearance,
} from "../lib/appearance";
import { ACCENT_BASE, parseCustomAccent } from "../lib/appearance-colors";
import {
  COLLECTION_DISPLAY_STORAGE_KEY,
  type CollectionDisplayPreference,
  readCollectionDisplay,
  resetCollectionDisplay,
  writeCollectionDisplay,
} from "../lib/collection-display";
import type { Session } from "../lib/types";
import { getTradingAccount, type TradingAccount } from "../lib/trading";
import {
  captureShortcutLabel,
  readCaptureShortcut,
  resetCaptureShortcut,
  writeCaptureShortcut,
} from "../scanner/capture-shortcut";

const THEME_OPTIONS: ReadonlyArray<{ value: AppearanceTheme; name: string; detail: string }> = [
  { value: "system", name: "System", detail: "Follow this browser or device." },
  { value: "midnight", name: "Midnight", detail: "Deep, calm WynterLabs dark." },
  { value: "frost", name: "Frost", detail: "Brighter blue-gray dark surfaces." },
  { value: "light", name: "Light", detail: "Clean light workspace." },
  { value: "aurora", name: "Aurora", detail: "Deep navy with a teal-green glow." },
  { value: "amethyst", name: "Amethyst", detail: "Rich plum and violet surfaces." },
  { value: "ember", name: "Ember", detail: "Warm charcoal with ember light." },
  { value: "forest", name: "Forest", detail: "Deep evergreen workspace." },
  { value: "sandstone", name: "Sandstone", detail: "Warm cream and natural neutrals." },
  { value: "slate", name: "Slate", detail: "Balanced blue-gray workspace." },
];

function isAbort(reason: unknown) {
  return reason instanceof DOMException && reason.name === "AbortError";
}

function roleLabel(role: string | undefined) {
  if (role === "owner") return "Platform owner";
  if (role === "admin") return "Administrator account";
  return "Member account";
}

export function AccountPage() {
  const { user } = useAuth();
  const request = useRef<AbortController | null>(null);
  const revokeRequest = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [trading, setTrading] = useState<TradingAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState("");
  const [error, setError] = useState("");
  const [appearance, setAppearance] = useState<AppearancePreference>(() => readAppearance());
  const [customAccentDraft, setCustomAccentDraft] = useState(() => {
    const current = readAppearance();
    return current.accent === "custom" ? current.customAccent ?? "" : "";
  });
  const [customAccentError, setCustomAccentError] = useState("");
  const [collectionDisplay, setCollectionDisplay] = useState<CollectionDisplayPreference>(
    () => readCollectionDisplay(),
  );
  const [captureShortcut, setCaptureShortcut] = useState(readCaptureShortcut);
  const [choosingCaptureShortcut, setChoosingCaptureShortcut] = useState(false);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const current = ++generation.current;
    setLoading(true);
    try {
      const [nextSessions, nextTrading] = await Promise.all([
        apiRequest<Session[]>("/api/v1/account/sessions", { signal: controller.signal }),
        getTradingAccount(controller.signal),
      ]);
      if (current !== generation.current || controller.signal.aborted) return;
      setSessions(nextSessions);
      setTrading(nextTrading);
      setError("");
    } catch (reason) {
      if (current === generation.current && !isAbort(reason)) {
        setError(reason instanceof ApiError ? reason.message : "Account details could not be loaded.");
      }
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      ++generation.current;
      request.current?.abort();
      revokeRequest.current?.abort();
    };
  }, [load]);

  useEffect(() => {
    const syncBrowserPreferences = (event: StorageEvent) => {
      if (event.key === APPEARANCE_STORAGE_KEY || event.key === null) {
        const next = readAppearance();
        setAppearance(next);
        applyAppearance(next);
        setCustomAccentDraft(next.accent === "custom" ? next.customAccent ?? "" : "");
      }
      if (event.key === COLLECTION_DISPLAY_STORAGE_KEY || event.key === null) {
        setCollectionDisplay(readCollectionDisplay());
      }
    };
    window.addEventListener("storage", syncBrowserPreferences);
    return () => window.removeEventListener("storage", syncBrowserPreferences);
  }, []);

  function updateAppearance(next: AppearancePreference) {
    setAppearance(next);
    writeAppearance(next);
    applyAppearance(next);
  }

  function applyCustomAccent() {
    const customAccent = parseCustomAccent(customAccentDraft);
    if (!customAccent) {
      setCustomAccentError("Enter a six-digit hex color such as #7C3AED.");
      return;
    }
    setCustomAccentDraft(customAccent);
    setCustomAccentError("");
    updateAppearance({ ...appearance, accent: "custom", customAccent });
  }

  const selectedAccent = appearance.accent === "custom"
    ? appearance.customAccent ?? ACCENT_BASE.frost
    : ACCENT_BASE[appearance.accent];

  function updateCollectionDisplay(next: CollectionDisplayPreference) {
    setCollectionDisplay(next);
    writeCollectionDisplay(next);
  }

  async function revoke(id: string) {
    revokeRequest.current?.abort();
    const controller = new AbortController();
    revokeRequest.current = controller;
    const current = generation.current;
    setRevoking(id);
    setError("");
    try {
      await apiRequest<void>(`/api/v1/account/sessions/${id}`, {
        method: "DELETE",
        signal: controller.signal,
      });
      if (current !== generation.current || controller.signal.aborted) return;
      setRevoking("");
      await load();
    } catch (reason) {
      if (current === generation.current && !isAbort(reason)) {
        setError(reason instanceof ApiError ? reason.message : "The session could not be revoked.");
      }
    } finally {
      if (revokeRequest.current === controller) {
        revokeRequest.current = null;
        if (current === generation.current) setRevoking("");
      }
    }
  }

  return (
    <section className="account-page">
      <PageHeader eyebrow="Account security" description={user?.email}>
        {user?.display_name}
      </PageHeader>
      <div className="account-grid">
        <article className="profile-card"><span className="avatar">{user?.display_name.slice(0, 1).toUpperCase()}</span><div><strong>{user?.display_name}</strong><p>{roleLabel(user?.role)}</p></div></article>
        <section className="account-appearance-card" aria-labelledby="account-appearance-heading">
          <div className="account-card-heading">
            <div>
              <p className="eyebrow">Personal workspace</p>
              <h2 id="account-appearance-heading">Personalization</h2>
            </div>
            <p>Saved in this browser</p>
          </div>
          <div className="personalization-preview" aria-label="Appearance preview">
            <span className="personalization-preview-swatch" style={{ background: selectedAccent }} />
            <span><strong>{appearance.theme === "system" ? "System" : appearance.theme} base</strong><small>Selected color {selectedAccent}</small></span>
          </div>
          <fieldset className="personalization-complexity">
            <legend>Workspace controls</legend>
            <label><input type="radio" name="appearance-complexity" checked={appearance.complexity === "simple"} onChange={() => updateAppearance({ ...appearance, complexity: "simple" })} />Simple workspace</label>
            <label><input type="radio" name="appearance-complexity" checked={appearance.complexity === "advanced"} onChange={() => updateAppearance({ ...appearance, complexity: "advanced" })} />Advanced workspace</label>
          </fieldset>
          <fieldset className="theme-options">
            <legend>Base mode</legend>
            {THEME_OPTIONS.map((option) => (
              <label className="theme-option" key={option.value}>
                <input
                  type="radio"
                  name="appearance-theme"
                  value={option.value}
                  checked={appearance.theme === option.value}
                  onChange={() => updateAppearance({ ...appearance, theme: option.value })}
                />
                <span className="theme-option-preview" data-preview-theme={option.value} aria-hidden="true">
                  <i /><i /><i />
                </span>
                <span>
                  <strong>{option.name}</strong>
                  <small>{option.detail}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <fieldset className="accent-options">
            <legend>Accent color</legend>
            <div className="accent-swatch-grid">
              {APPEARANCE_ACCENTS.map((accent) => {
                const accentName = accent[0].toUpperCase() + accent.slice(1);
                return (
                  <label className="accent-swatch-option" key={accent}>
                    <input
                      type="radio"
                      name="appearance-accent"
                      aria-label={`${accentName} accent`}
                      checked={appearance.accent === accent}
                      onChange={() => updateAppearance({ ...appearance, accent, customAccent: null })}
                    />
                    <span className="accent-swatch-color" style={{ background: ACCENT_BASE[accent] }} aria-hidden="true" />
                    <span className="accent-swatch-name" aria-hidden="true">{accentName}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          {appearance.complexity === "advanced" && (
            <div className="appearance-advanced-controls">
              <div className="custom-accent-controls">
                <label>Custom accent color
                  <input className="custom-accent-hex" type="text" value={customAccentDraft} onChange={(event) => { setCustomAccentDraft(event.target.value); setCustomAccentError(""); }} inputMode="text" placeholder="#7C3AED" />
                </label>
                <label>Custom accent color picker
                  <input type="color" value={parseCustomAccent(customAccentDraft) ?? selectedAccent} onChange={(event) => { setCustomAccentDraft(event.target.value.toUpperCase()); setCustomAccentError(""); }} />
                </label>
                <button type="button" className="button ghost" onClick={applyCustomAccent}>Apply custom color</button>
              </div>
              {customAccentError && <FeedbackBanner tone="error">{customAccentError}</FeedbackBanner>}
              <fieldset className="density-options">
                <legend>Density</legend>
                {(["comfortable", "compact", "spacious"] as const).map((density) => (
                  <label key={density}><input type="radio" name="appearance-density" checked={appearance.density === density} onChange={() => updateAppearance({ ...appearance, density })} />{density[0].toUpperCase() + density.slice(1)}</label>
                ))}
              </fieldset>
              <label>Text size
                <select value={appearance.textScale} onChange={(event) => updateAppearance({ ...appearance, textScale: event.target.value as AppearancePreference["textScale"] })}>
                  <option value="standard">Standard</option><option value="large">Large</option><option value="extra-large">Extra large</option>
                </select>
              </label>
              <label><input type="checkbox" checked={appearance.contrast === "high"} onChange={(event) => updateAppearance({ ...appearance, contrast: event.target.checked ? "high" : "standard" })} />High contrast</label>
              <label>
                <input type="checkbox" checked={appearance.motion === "reduced"} onChange={(event) => updateAppearance({ ...appearance, motion: event.target.checked ? "reduced" : "system" })} />
                <span><strong>Reduced motion</strong><small>Turn off interface movement.</small></span>
              </label>
              <button className="button ghost appearance-reset" type="button" onClick={() => { const next = resetAppearance(); setAppearance(next); setCustomAccentDraft(""); setCustomAccentError(""); }}>
                Reset appearance
              </button>
              <fieldset className="collection-display-settings">
                <legend>Collection display</legend>
                <p>Collection choices are saved only in this browser.</p>
                <div className="collection-display-choice-row">
                  <span>Default view</span>
                  <label><input type="radio" name="collection-view" checked={collectionDisplay.view === "grid"} onChange={() => updateCollectionDisplay({ ...collectionDisplay, view: "grid" })} />Compact grid</label>
                  <label><input type="radio" name="collection-view" checked={collectionDisplay.view === "list"} onChange={() => updateCollectionDisplay({ ...collectionDisplay, view: "list" })} />Detailed list</label>
                </div>
                <div className="collection-display-choice-row">
                  <span>Card size</span>
                  {(["small", "medium", "large"] as const).map((size) => (
                    <label key={size}><input type="radio" name="collection-card-size" checked={collectionDisplay.size === size} onChange={() => updateCollectionDisplay({ ...collectionDisplay, size })} />{size[0].toUpperCase() + size.slice(1)} cards</label>
                  ))}
                </div>
                {([
                  ["showSet", "Show set and collector number"], ["showLanguage", "Show language"], ["showTypeRarity", "Show type and rarity"], ["showPrices", "Show informational prices"], ["animateDetails", "Animate expanded details"],
                ] as const).map(([key, label]) => (
                  <label key={key}><input type="checkbox" checked={collectionDisplay[key]} onChange={(event) => updateCollectionDisplay({ ...collectionDisplay, [key]: event.target.checked })} /><span><strong>{label}</strong></span></label>
                ))}
                <button className="button ghost" type="button" onClick={() => setCollectionDisplay(resetCollectionDisplay())}>Reset collection display</button>
              </fieldset>
            </div>
          )}
        </section>
        <section className="account-scanner-shortcut-card" aria-labelledby="scanner-shortcut-heading">
          <div>
            <p className="eyebrow">Fast scanning</p>
            <h2 id="scanner-shortcut-heading">Capture shortcut</h2>
            <p>Current shortcut: <kbd>{captureShortcutLabel(captureShortcut)}</kbd></p>
            <small>Saved only in this browser. It works in single-card and multiple-card scanning.</small>
          </div>
          <div className="scanner-shortcut-actions">
            <button
              className="button ghost"
              type="button"
              aria-label="Change capture shortcut"
              onClick={() => setChoosingCaptureShortcut(true)}
              onBlur={() => setChoosingCaptureShortcut(false)}
              onKeyDown={(event) => {
                if (!choosingCaptureShortcut) return;
                event.preventDefault();
                event.stopPropagation();
                if (writeCaptureShortcut(event.code)) {
                  setCaptureShortcut(event.code);
                  setChoosingCaptureShortcut(false);
                }
              }}
            >{choosingCaptureShortcut ? "Press one key now" : "Change shortcut"}</button>
            <button
              className="button ghost"
              type="button"
              aria-label="Reset capture shortcut"
              onClick={() => {
                setCaptureShortcut(resetCaptureShortcut());
                setChoosingCaptureShortcut(false);
              }}
            >Reset to Space</button>
          </div>
        </section>
        {user && <AutoScannerSettingsPanel role={user.role} />}
        <section className="sessions-card">
          <div><p className="eyebrow">Active sessions</p><h2>Where you are signed in</h2></div>
          {loading && <p role="status">Loading account details&hellip;</p>}
          {error && <FeedbackBanner tone="error">{error}</FeedbackBanner>}
          {error && <button type="button" onClick={() => void load()}>Retry account details</button>}
          {sessions.map((session) => (
            <article className="session-row" key={session.id}>
              <div><strong>{session.current ? "This browser" : "Browser session"}</strong><span>{session.client_ip} &middot; Last seen {new Date(session.last_seen_at).toLocaleString()}</span></div>
              <button className="text-button" disabled={revoking === session.id} onClick={() => void revoke(session.id)}>{session.current ? "Sign out here" : "Revoke"}</button>
            </article>
          ))}
        </section>
        {user && <MfaSettings role={user.role} />}
        {trading && (
          <section className={`account-trading-card ${trading.status}`} aria-labelledby="account-trading-heading">
            <p className="eyebrow">Community safety</p>
            <h2 id="account-trading-heading">Trading status</h2>
            <p><strong>{trading.status === "suspended" ? "Trading suspended" : "Trading active"}</strong></p>
            <p>{trading.active_strikes} of 3 active trading strikes.</p>
            {trading.status === "suspended" && <p>Your account, collection, and decks remain available.</p>}
            {trading.status === "suspended" && (
              <a href={`mailto:${trading.support_email}?subject=Trading%20suspension%20appeal`}>
                Appeal trading suspension
              </a>
            )}
          </section>
        )}
      </div>
    </section>
  );
}
