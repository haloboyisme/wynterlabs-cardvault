export type CameraConsent = "allow" | "deny" | null;

export const CAMERA_CONSENT_KEY = "wynterlabs.cards.camera-consent.v1";

export interface CameraConsentStore {
  read(): CameraConsent;
  write(choice: Exclude<CameraConsent, null>): void;
  clear(): void;
}

export const browserCameraConsentStore: CameraConsentStore = {
  read() {
    try {
      const value = localStorage.getItem(CAMERA_CONSENT_KEY);
      return value === "allow" || value === "deny" ? value : null;
    } catch {
      return null;
    }
  },

  write(choice) {
    try {
      localStorage.setItem(CAMERA_CONSENT_KEY, choice);
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
  },

  clear() {
    try {
      localStorage.removeItem(CAMERA_CONSENT_KEY);
    } catch {
      // The in-memory component state still resets when storage is unavailable.
    }
  },
};
