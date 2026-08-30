export const AUTO_SCANNER_STORAGE_KEY = "wynterlabs.cardvault.auto-scanner.v1";

export type AutoScannerBoard = "arduino_uno" | "esp32" | "generic";

export interface AutoScannerSettings {
  version: 1;
  profileName: string;
  board: AutoScannerBoard;
  pins: { step: number; direction: number; enable: number; homeSensor: number; cardSensor: number };
  enableActiveLow: boolean;
  sensorsActiveLow: boolean;
  reverseDirection: boolean;
  stepsPerCard: number;
  speedPercent: number;
  accelerationPercent: number;
  settleDelayMs: number;
  countdownSeconds: number;
  recognitionTimeoutSeconds: number;
  retryLimit: number;
}

export const AUTO_SCANNER_LIMITS = {
  stepsPerCard: { min: 1, max: 5000 },
  speedPercent: { min: 1, max: 100 },
  accelerationPercent: { min: 1, max: 100 },
  settleDelayMs: { min: 250, max: 10000 },
  countdownSeconds: { min: 1, max: 10 },
  recognitionTimeoutSeconds: { min: 5, max: 60 },
  retryLimit: { min: 0, max: 3 },
} as const;

export const DEFAULT_AUTO_SCANNER_SETTINGS: AutoScannerSettings = {
  version: 1,
  profileName: "Test card feeder",
  board: "esp32",
  pins: { step: 18, direction: 19, enable: 23, homeSensor: 32, cardSensor: 33 },
  enableActiveLow: true,
  sensorsActiveLow: true,
  reverseDirection: false,
  stepsPerCard: 200,
  speedPercent: 25,
  accelerationPercent: 25,
  settleDelayMs: 1000,
  countdownSeconds: 3,
  recognitionTimeoutSeconds: 30,
  retryLimit: 1,
};

export interface AutoScannerSettingsErrors {
  version?: string;
  profileName?: string;
  board?: string;
  pins?: string;
  enableActiveLow?: string;
  sensorsActiveLow?: string;
  reverseDirection?: string;
  stepsPerCard?: string;
  speedPercent?: string;
  accelerationPercent?: string;
  settleDelayMs?: string;
  countdownSeconds?: string;
  recognitionTimeoutSeconds?: string;
  retryLimit?: string;
}

export interface AutoScannerValidation {
  ok: boolean;
  errors: Partial<Record<keyof AutoScannerSettings | "pins", string>>;
  warnings: string[];
}

const BOARD_PIN_MAX: Record<AutoScannerBoard, number> = {
  arduino_uno: 19,
  esp32: 39,
  generic: 255,
};

const boundedFields = Object.entries(AUTO_SCANNER_LIMITS) as Array<[
  keyof typeof AUTO_SCANNER_LIMITS,
  { min: number; max: number },
]>;

export function validateAutoScannerSettings(settings: AutoScannerSettings): AutoScannerValidation {
  const errors: AutoScannerValidation["errors"] = {};
  const warnings: string[] = [];
  const candidate = settings as unknown as Record<string, unknown>;
  if (candidate.version !== 1) errors.version = "Version must be 1.";
  if (typeof candidate.profileName !== "string" || !/^[\x20-\x7e]{1,40}$/.test(candidate.profileName)) {
    errors.profileName = "Profile name must be 1-40 printable characters.";
  }
  if (candidate.board !== "arduino_uno" && candidate.board !== "esp32" && candidate.board !== "generic") {
    errors.board = "Board must be arduino_uno, esp32, or generic.";
  }
  const pins = candidate.pins as Record<string, unknown> | null | undefined;
  const pinNames = ["step", "direction", "enable", "homeSensor", "cardSensor"];
  const pinValues = pinNames.map((name) => pins?.[name]);
  const numericPinValues = pinValues as number[];
  if (!pins || pinValues.some((pin) => typeof pin !== "number")) {
    errors.pins = "All required pins must be numbers.";
  } else if (pinValues.some((pin) => !Number.isInteger(pin))) {
    errors.pins = "Pins must be integer values.";
  } else if (numericPinValues.some((pin) => pin < 0)) {
    errors.pins = "Pins must be non-negative.";
  } else if (new Set(pinValues).size !== pinValues.length) {
    const duplicate = pinNames.find((name, index) => pinValues.indexOf(pinValues[index]) !== index);
    const first = pinNames[pinValues.indexOf(pinValues[pinNames.indexOf(duplicate ?? "step")])];
    errors.pins = `${first.toUpperCase()} and ${duplicate?.toUpperCase()} pins must be unique.`;
  } else if (candidate.board === "generic" && numericPinValues.some((pin) => pin > 255)) {
    errors.pins = "Generic pins must be at most 255.";
  }
  if (candidate.board === "arduino_uno" || candidate.board === "esp32") {
    const max = BOARD_PIN_MAX[candidate.board];
    pinNames.forEach((name, index) => {
      const pin = pinValues[index];
      if (typeof pin === "number" && Number.isInteger(pin) && pin >= 0 && pin > max) {
        warnings.push(`${name} pin ${pin} is outside the ${candidate.board} board range (0-${max}).`);
      }
    });
  }
  for (const [field, limit] of boundedFields) {
    const value = candidate[field];
    if (typeof value !== "number" || !Number.isInteger(value)) {
      errors[field] = `${field} must be an integer.`;
    } else if (value < limit.min || value > limit.max) {
      errors[field] = `${field} must be between ${limit.min} and ${limit.max}.`;
    }
  }
  for (const field of ["enableActiveLow", "sensorsActiveLow", "reverseDirection"] as const) {
    if (typeof candidate[field] !== "boolean") errors[field] = `${field} must be boolean.`;
  }
  return { ok: Object.keys(errors).length === 0, errors, warnings };
}

const cloneSettings = (settings: AutoScannerSettings): AutoScannerSettings => ({
  version: settings.version,
  profileName: settings.profileName,
  board: settings.board,
  pins: {
    step: settings.pins.step,
    direction: settings.pins.direction,
    enable: settings.pins.enable,
    homeSensor: settings.pins.homeSensor,
    cardSensor: settings.pins.cardSensor,
  },
  enableActiveLow: settings.enableActiveLow,
  sensorsActiveLow: settings.sensorsActiveLow,
  reverseDirection: settings.reverseDirection,
  stepsPerCard: settings.stepsPerCard,
  speedPercent: settings.speedPercent,
  accelerationPercent: settings.accelerationPercent,
  settleDelayMs: settings.settleDelayMs,
  countdownSeconds: settings.countdownSeconds,
  recognitionTimeoutSeconds: settings.recognitionTimeoutSeconds,
  retryLimit: settings.retryLimit,
});

let recoveryNoticePending = false;

export interface AutoScannerSettingsReadResult {
  settings: AutoScannerSettings;
  recovered: boolean;
}

export function readAutoScannerSettingsWithRecovery(): AutoScannerSettingsReadResult {
  let raw: string | null;
  try {
    raw = localStorage.getItem(AUTO_SCANNER_STORAGE_KEY);
  } catch {
    return { settings: cloneSettings(DEFAULT_AUTO_SCANNER_SETTINGS), recovered: false };
  }
  if (raw === null) {
    return { settings: cloneSettings(DEFAULT_AUTO_SCANNER_SETTINGS), recovered: recoveryNoticePending };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && (parsed as { version?: unknown }).version === 1) {
      const result = validateAutoScannerSettings(parsed as AutoScannerSettings);
      if (result.ok) {
        return { settings: cloneSettings(parsed as AutoScannerSettings), recovered: recoveryNoticePending };
      }
    }
  } catch {
    // Recovery below removes malformed browser storage before restoring defaults.
  }
  try {
    localStorage.removeItem(AUTO_SCANNER_STORAGE_KEY);
  } catch {
    // Safe defaults still apply when browser storage is unavailable.
  }
  recoveryNoticePending = true;
  return { settings: cloneSettings(DEFAULT_AUTO_SCANNER_SETTINGS), recovered: true };
}

export function consumeAutoScannerSettingsRecovery(): boolean {
  const recovered = recoveryNoticePending;
  recoveryNoticePending = false;
  return recovered;
}

export function readAutoScannerSettings(): AutoScannerSettings {
  return readAutoScannerSettingsWithRecovery().settings;
}

export function writeAutoScannerSettings(settings: AutoScannerSettings):
  | { ok: true; settings: AutoScannerSettings }
  | { ok: false; errors: AutoScannerValidation["errors"]; warnings: string[] } {
  const validation = validateAutoScannerSettings(settings);
  if (!validation.ok) return { ok: false, errors: validation.errors, warnings: validation.warnings };
  const cloned = cloneSettings(settings);
  localStorage.setItem(AUTO_SCANNER_STORAGE_KEY, JSON.stringify(cloned));
  recoveryNoticePending = false;
  return { ok: true, settings: cloned };
}

export function resetAutoScannerSettings(): AutoScannerSettings {
  localStorage.removeItem(AUTO_SCANNER_STORAGE_KEY);
  recoveryNoticePending = false;
  return cloneSettings(DEFAULT_AUTO_SCANNER_SETTINGS);
}
