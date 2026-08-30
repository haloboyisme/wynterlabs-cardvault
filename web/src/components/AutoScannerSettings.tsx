import { type FormEvent, useEffect, useState } from "react";

import { FeedbackBanner } from "./workspace/FeedbackBanner";
import {
  AUTO_SCANNER_STORAGE_KEY,
  consumeAutoScannerSettingsRecovery,
  type AutoScannerBoard,
  type AutoScannerSettings,
  type AutoScannerValidation,
  readAutoScannerSettingsWithRecovery,
  resetAutoScannerSettings,
  validateAutoScannerSettings,
  writeAutoScannerSettings,
} from "../scanner/auto-scanner-settings";

type Role = "owner" | "admin" | "member";
type PinName = keyof AutoScannerSettings["pins"];
type NumericField = "stepsPerCard" | "speedPercent" | "accelerationPercent" | "settleDelayMs" | "countdownSeconds" | "recognitionTimeoutSeconds" | "retryLimit";

const pinFields: ReadonlyArray<{ key: PinName; label: string }> = [
  { key: "step", label: "STEP pin" },
  { key: "direction", label: "DIR pin" },
  { key: "enable", label: "ENABLE pin" },
  { key: "homeSensor", label: "Home sensor pin" },
  { key: "cardSensor", label: "Card sensor pin" },
];

const timingFields: ReadonlyArray<{ key: NumericField; label: string }> = [
  { key: "stepsPerCard", label: "Steps per card" },
  { key: "speedPercent", label: "Speed percent" },
  { key: "accelerationPercent", label: "Acceleration percent" },
  { key: "settleDelayMs", label: "Settle delay (ms)" },
  { key: "countdownSeconds", label: "Scan countdown (seconds)" },
  { key: "recognitionTimeoutSeconds", label: "Recognition timeout (seconds)" },
  { key: "retryLimit", label: "Retry limit" },
];

export function AutoScannerSettingsPanel({ role }: { role: Role }) {
  const [initialSettings] = useState(readAutoScannerSettingsWithRecovery);
  const [settings, setSettings] = useState<AutoScannerSettings>(() => initialSettings.settings);
  const [recovered, setRecovered] = useState(() => initialSettings.recovered);
  const [validation, setValidation] = useState<AutoScannerValidation | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const syncSettings = (event: StorageEvent) => {
      if (event.key === AUTO_SCANNER_STORAGE_KEY || event.key === null) {
        const next = readAutoScannerSettingsWithRecovery();
        setSettings(next.settings);
        setRecovered(next.recovered || consumeAutoScannerSettingsRecovery());
        setValidation(null);
        setSaved(false);
      }
    };
    window.addEventListener("storage", syncSettings);
    return () => window.removeEventListener("storage", syncSettings);
  }, []);

  useEffect(() => {
    if (recovered) consumeAutoScannerSettingsRecovery();
  }, [recovered]);

  if (role === "member") return null;

  function updatePin(key: PinName, value: string) {
    setSettings((current) => ({ ...current, pins: { ...current.pins, [key]: Number(value) } }));
    setValidation(null);
    setSaved(false);
  }

  function updateNumber(key: NumericField, value: string) {
    setSettings((current) => ({ ...current, [key]: Number(value) }));
    setValidation(null);
    setSaved(false);
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validateAutoScannerSettings(settings);
    setValidation(result);
    setSaved(false);
    if (!result.ok) return;
    const written = writeAutoScannerSettings(settings);
    if (!written.ok) {
      setValidation(written);
      return;
    }
    setSettings(written.settings);
    consumeAutoScannerSettingsRecovery();
    setRecovered(false);
    setSaved(true);
  }

  function reset() {
    const next = resetAutoScannerSettings();
    setSettings(next);
    setValidation(null);
    consumeAutoScannerSettingsRecovery();
    setRecovered(false);
    setSaved(false);
  }

  const errors = validation?.errors ?? {};
  const warnings = validation?.warnings ?? [];

  return (
    <section className="auto-scanner-settings-card" aria-labelledby="auto-scanner-settings-heading">
      <div className="account-card-heading">
        <div>
          <p className="eyebrow">Advanced controller profile</p>
          <h2 id="auto-scanner-settings-heading">Auto scanner controller</h2>
        </div>
        <p>Saved only in this browser</p>
      </div>
      <p className="auto-scanner-settings-note"><strong>Simulation only.</strong> These settings do not connect to a board or move hardware.</p>
      <form className="auto-scanner-settings-form" onSubmit={save}>
        <label>Profile name
          <input maxLength={40} value={settings.profileName} onChange={(event) => { setSettings((current) => ({ ...current, profileName: event.target.value })); setValidation(null); setSaved(false); }} />
        </label>
        {errors.profileName && <FeedbackBanner tone="error">{errors.profileName}</FeedbackBanner>}
        <label>Board
          <select value={settings.board} onChange={(event) => { setSettings((current) => ({ ...current, board: event.target.value as AutoScannerBoard })); setValidation(null); setSaved(false); }}>
            <option value="arduino_uno">Arduino Uno</option>
            <option value="esp32">ESP32</option>
            <option value="generic">Generic</option>
          </select>
        </label>
        {errors.board && <FeedbackBanner tone="error">{errors.board}</FeedbackBanner>}
        <fieldset className="auto-scanner-settings-grid">
          <legend>Pin assignments</legend>
          {pinFields.map(({ key, label }) => <label key={key}>{label}
            <input type="number" value={settings.pins[key]} onChange={(event) => updatePin(key, event.target.value)} />
          </label>)}
        </fieldset>
        {errors.pins && <FeedbackBanner tone="error">{errors.pins}</FeedbackBanner>}
        <fieldset className="auto-scanner-settings-grid">
          <legend>Timing and movement</legend>
          {timingFields.map(({ key, label }) => <label key={key}>{label}
            <input type="number" value={settings[key]} onChange={(event) => updateNumber(key, event.target.value)} />
          </label>)}
        </fieldset>
        {timingFields.map(({ key }) => errors[key] && <FeedbackBanner key={key} tone="error">{errors[key]}</FeedbackBanner>)}
        <fieldset className="auto-scanner-settings-switches">
          <legend>Signal options</legend>
          <label><input type="checkbox" checked={settings.enableActiveLow} onChange={(event) => setSettings((current) => ({ ...current, enableActiveLow: event.target.checked }))} />Enable is active low</label>
          <label><input type="checkbox" checked={settings.sensorsActiveLow} onChange={(event) => setSettings((current) => ({ ...current, sensorsActiveLow: event.target.checked }))} />Sensors are active low</label>
          <label><input type="checkbox" checked={settings.reverseDirection} onChange={(event) => setSettings((current) => ({ ...current, reverseDirection: event.target.checked }))} />Reverse direction</label>
        </fieldset>
        {warnings.map((warning) => <FeedbackBanner key={warning} tone="warning">{warning}</FeedbackBanner>)}
        {recovered && <FeedbackBanner tone="warning">Saved controller settings were invalid or unsupported, so safe simulation defaults were restored.</FeedbackBanner>}
        {saved && <FeedbackBanner tone="success">Controller profile saved in this browser.</FeedbackBanner>}
        <div className="auto-scanner-settings-actions">
          <button className="button primary" type="submit">Save controller profile</button>
          <button className="button ghost" type="button" onClick={reset}>Reset controller profile</button>
        </div>
      </form>
    </section>
  );
}
