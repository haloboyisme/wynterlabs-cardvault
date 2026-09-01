import { useEffect, useRef, useState } from "react";

import {
  AUTO_SCANNER_LIMITS,
  type AutoScannerSettings,
  readAutoScannerSettings,
  validateAutoScannerSettings,
  writeAutoScannerSettings,
} from "../scanner/auto-scanner-settings";
import {
  type AutoScannerController,
  type AutoScannerControllerSnapshot,
  createSimulatedAutoScannerController,
} from "../scanner/auto-scanner-controller";

type QuickSetting =
  | "speedPercent"
  | "accelerationPercent"
  | "countdownSeconds"
  | "settleDelayMs"
  | "recognitionTimeoutSeconds"
  | "retryLimit";

export interface AutoScannerControllerPanelProps {
  controller?: AutoScannerController;
  controllerFactory?: (getSettings: () => AutoScannerSettings) => AutoScannerController;
  onReadyForCapture?: () => void;
  onCaptureReadinessChange?: (ready: boolean) => void;
}

const disconnectedSnapshot: AutoScannerControllerSnapshot = {
  state: "disconnected",
  message: "Disconnected",
  history: [],
};

const boardLabels = {
  arduino_uno: "Arduino Uno",
  esp32: "ESP32",
  generic: "Generic board",
} as const;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function AutoScannerControllerPanel({
  controller,
  controllerFactory = createSimulatedAutoScannerController,
  onReadyForCapture,
  onCaptureReadinessChange,
}: AutoScannerControllerPanelProps) {
  const settingsRef = useRef<AutoScannerSettings>(readAutoScannerSettings());
  const [settings, setSettings] = useState<AutoScannerSettings>(() => settingsRef.current);
  const controllerFactoryRef = useRef(controllerFactory);
  const [ownedController, setOwnedController] = useState<AutoScannerController | null>(null);
  const scannerController = controller ?? ownedController;
  const [snapshot, setSnapshot] = useState<AutoScannerControllerSnapshot>(disconnectedSnapshot);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [safetyMessage, setSafetyMessage] = useState("");
  const countdownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const operationRef = useRef(0);

  const clearScheduledTimers = () => {
    if (countdownTimerRef.current !== null) clearTimeout(countdownTimerRef.current);
    if (settleTimerRef.current !== null) clearTimeout(settleTimerRef.current);
    countdownTimerRef.current = null;
    settleTimerRef.current = null;
  };

  const cancelAdvance = () => {
    operationRef.current += 1;
    clearScheduledTimers();
    setCountdown(null);
  };

  useEffect(() => {
    if (controller) return;
    const owned = controllerFactoryRef.current(() => settingsRef.current);
    setOwnedController(owned);
    return () => owned.dispose();
  }, [controller]);

  useEffect(() => {
    if (!scannerController) {
      setSnapshot(disconnectedSnapshot);
      return;
    }
    const unsubscribe = scannerController.subscribe(setSnapshot);
    return () => {
      operationRef.current += 1;
      clearScheduledTimers();
      setCountdown(null);
      unsubscribe();
    };
  }, [scannerController]);

  function updateQuickSetting(key: QuickSetting, rawValue: string) {
    const limit = AUTO_SCANNER_LIMITS[key];
    const parsed = Number(rawValue);
    const value = Number.isFinite(parsed) ? clamp(Math.round(parsed), limit.min, limit.max) : limit.min;
    const written = writeAutoScannerSettings({ ...settingsRef.current, [key]: value });
    if (!written.ok) return;
    settingsRef.current = written.settings;
    setSettings(written.settings);
    setSafetyMessage("");
  }

  function runSafetyCheck() {
    const result = validateAutoScannerSettings(settingsRef.current);
    if (!result.ok) {
      setSafetyMessage(`Safety check failed: ${Object.values(result.errors).join(" ")}`);
      return;
    }
    if (result.warnings.length > 0) {
      setSafetyMessage(`Profile is ready for simulation with warnings: ${result.warnings.join(" ")}`);
      return;
    }
    setSafetyMessage("Profile is ready for simulation. No hardware connection was attempted.");
  }

  function connect() {
    if (!scannerController) return;
    void scannerController.connect().catch(() => undefined);
  }

  function disconnect() {
    if (!scannerController) return;
    cancelAdvance();
    onCaptureReadinessChange?.(false);
    scannerController.disconnect();
  }

  function home() {
    if (!scannerController) return;
    cancelAdvance();
    onCaptureReadinessChange?.(false);
    void scannerController.home().catch(() => undefined);
  }

  async function advanceAfterCountdown(operation: number, activeController: AutoScannerController) {
    try {
      await activeController.advance();
    } catch {
      return;
    }
    if (operation !== operationRef.current) return;
    settleTimerRef.current = setTimeout(() => {
      if (operation !== operationRef.current) return;
      settleTimerRef.current = null;
      onReadyForCapture?.();
      onCaptureReadinessChange?.(true);
    }, settingsRef.current.settleDelayMs);
  }

  function advance() {
    if (!scannerController || snapshot.state !== "ready" || countdown !== null) return;
    cancelAdvance();
    onCaptureReadinessChange?.(false);
    const operation = ++operationRef.current;
    const scheduleCountdown = (remaining: number) => {
      countdownTimerRef.current = setTimeout(() => {
        if (operation !== operationRef.current) return;
        if (remaining === 1) {
          countdownTimerRef.current = null;
          setCountdown(null);
          void advanceAfterCountdown(operation, scannerController);
          return;
        }
        const next = remaining - 1;
        setCountdown(next);
        scheduleCountdown(next);
      }, 1000);
    };
    setCountdown(settingsRef.current.countdownSeconds);
    scheduleCountdown(settingsRef.current.countdownSeconds);
  }

  function emergencyStop() {
    if (!scannerController) return;
    cancelAdvance();
    onCaptureReadinessChange?.(false);
    scannerController.stop();
  }

  const ready = snapshot.state === "ready" && countdown === null;
  const connected = snapshot.state !== "disconnected";

  return (
    <section className="auto-scanner-controller-panel" aria-labelledby="auto-scanner-controller-heading">
      <div className="auto-scanner-controller-heading">
        <div>
          <p className="eyebrow">Auto scanner controller</p>
          <h2 id="auto-scanner-controller-heading">Card feeder controls</h2>
        </div>
        <span className="auto-scanner-simulator-badge">Simulation only</span>
      </div>
      <p className="auto-scanner-controller-note">No board connection or hardware movement is available from this panel.</p>

      <dl className="auto-scanner-controller-profile">
        <div><dt>Profile</dt><dd>{settings.profileName}</dd></div>
        <div><dt>Board</dt><dd>{boardLabels[settings.board]}</dd></div>
      </dl>

      <p className={`auto-scanner-controller-status state-${snapshot.state}`} role="status" aria-label="Controller status" aria-live="polite">
        <strong>{snapshot.state}</strong> — {snapshot.message}
      </p>
      <p className="auto-scanner-controller-last-message">Last message: {snapshot.message}</p>
      {countdown !== null && <p className="auto-scanner-controller-countdown" aria-live="assertive">Advancing in {countdown}</p>}

      <fieldset className="auto-scanner-quick-tuning">
        <legend>Quick tuning</legend>
        <label>Card speed
          <input type="number" min={AUTO_SCANNER_LIMITS.speedPercent.min} max={AUTO_SCANNER_LIMITS.speedPercent.max} value={settings.speedPercent} onChange={(event) => updateQuickSetting("speedPercent", event.target.value)} />
        </label>
        <label>Acceleration
          <input type="number" min={AUTO_SCANNER_LIMITS.accelerationPercent.min} max={AUTO_SCANNER_LIMITS.accelerationPercent.max} value={settings.accelerationPercent} onChange={(event) => updateQuickSetting("accelerationPercent", event.target.value)} />
        </label>
        <label>Scan countdown
          <input type="number" min={AUTO_SCANNER_LIMITS.countdownSeconds.min} max={AUTO_SCANNER_LIMITS.countdownSeconds.max} value={settings.countdownSeconds} onChange={(event) => updateQuickSetting("countdownSeconds", event.target.value)} />
        </label>
        <label>Settle delay
          <input type="number" min={AUTO_SCANNER_LIMITS.settleDelayMs.min} max={AUTO_SCANNER_LIMITS.settleDelayMs.max} value={settings.settleDelayMs} onChange={(event) => updateQuickSetting("settleDelayMs", event.target.value)} />
        </label>
        <label>Recognition timeout
          <input type="number" min={AUTO_SCANNER_LIMITS.recognitionTimeoutSeconds.min} max={AUTO_SCANNER_LIMITS.recognitionTimeoutSeconds.max} value={settings.recognitionTimeoutSeconds} onChange={(event) => updateQuickSetting("recognitionTimeoutSeconds", event.target.value)} />
        </label>
        <label>Retry limit
          <input type="number" min={AUTO_SCANNER_LIMITS.retryLimit.min} max={AUTO_SCANNER_LIMITS.retryLimit.max} value={settings.retryLimit} onChange={(event) => updateQuickSetting("retryLimit", event.target.value)} />
        </label>
      </fieldset>

      <button className="button ghost" type="button" onClick={runSafetyCheck}>Run safety check</button>
      {safetyMessage && <p role="status" aria-label="Controller safety check" className="auto-scanner-controller-safety-result">{safetyMessage}</p>}

      <div className="auto-scanner-controller-actions">
        {connected
          ? <button className="button ghost" type="button" onClick={disconnect}>Disconnect simulator</button>
          : <button className="button primary" type="button" onClick={connect}>Connect simulator</button>}
        <button className="button ghost" type="button" disabled={!ready} onClick={home}>Home</button>
        <button className="button primary" type="button" disabled={!ready} onClick={advance}>Advance card</button>
        <button className="button auto-scanner-emergency-stop" type="button" disabled={!connected} onClick={emergencyStop}>Emergency stop</button>
      </div>

      <details className="auto-scanner-controller-history">
        <summary>Command history ({snapshot.history.length})</summary>
        <ol>
          {snapshot.history.map((entry) => <li key={entry.id}><strong>{entry.command}</strong>: {entry.message} <time dateTime={entry.at}>{new Date(entry.at).toLocaleTimeString()}</time></li>)}
        </ol>
      </details>
    </section>
  );
}
