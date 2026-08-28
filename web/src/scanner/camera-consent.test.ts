import { afterEach, expect, it } from "vitest";

import { browserCameraConsentStore, CAMERA_CONSENT_KEY } from "./camera-consent";

afterEach(() => {
  localStorage.clear();
});

it("persists only allow or deny in this browser", () => {
  browserCameraConsentStore.write("allow");
  expect(localStorage.getItem(CAMERA_CONSENT_KEY)).toBe("allow");
  expect(browserCameraConsentStore.read()).toBe("allow");

  browserCameraConsentStore.write("deny");
  expect(localStorage.getItem(CAMERA_CONSENT_KEY)).toBe("deny");
  expect(browserCameraConsentStore.read()).toBe("deny");
});

it("ignores unknown values and clears the remembered choice", () => {
  localStorage.setItem(CAMERA_CONSENT_KEY, "unknown");
  expect(browserCameraConsentStore.read()).toBeNull();

  browserCameraConsentStore.write("allow");
  browserCameraConsentStore.clear();
  expect(browserCameraConsentStore.read()).toBeNull();
});
