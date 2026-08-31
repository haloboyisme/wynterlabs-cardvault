export const MULTI_SCAN_COUNTDOWN_STORAGE_KEY = "wynterlabs.cardvault.multi-scan.countdown.v1";

export const DEFAULT_MULTI_SCAN_COUNTDOWN_SECONDS = 5;
export const MULTI_SCAN_COUNTDOWN_MIN_SECONDS = 1;
export const MULTI_SCAN_COUNTDOWN_MAX_SECONDS = 10;

const boundedCountdown = (value: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_MULTI_SCAN_COUNTDOWN_SECONDS;
  return Math.min(
    MULTI_SCAN_COUNTDOWN_MAX_SECONDS,
    Math.max(MULTI_SCAN_COUNTDOWN_MIN_SECONDS, Math.round(value)),
  );
};

export function readMultiScanCountdownSeconds(): number {
  try {
    const raw = localStorage.getItem(MULTI_SCAN_COUNTDOWN_STORAGE_KEY);
    if (raw === null) return DEFAULT_MULTI_SCAN_COUNTDOWN_SECONDS;
    const value = Number(raw);
    if (!Number.isInteger(value)
      || value < MULTI_SCAN_COUNTDOWN_MIN_SECONDS
      || value > MULTI_SCAN_COUNTDOWN_MAX_SECONDS) {
      localStorage.removeItem(MULTI_SCAN_COUNTDOWN_STORAGE_KEY);
      return DEFAULT_MULTI_SCAN_COUNTDOWN_SECONDS;
    }
    return value;
  } catch {
    return DEFAULT_MULTI_SCAN_COUNTDOWN_SECONDS;
  }
}

export function writeMultiScanCountdownSeconds(value: number): number {
  const bounded = boundedCountdown(value);
  try {
    localStorage.setItem(MULTI_SCAN_COUNTDOWN_STORAGE_KEY, String(bounded));
  } catch {
    // The selected value still applies to this mounted session.
  }
  return bounded;
}
