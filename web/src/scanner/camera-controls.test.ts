import { describe, expect, it, vi } from "vitest";

import { applyCameraControl, readCameraControls } from "./camera-controls";

function track(
  capabilities: Record<string, unknown>,
  settings: Record<string, unknown> = {},
  applyConstraints = vi.fn(async () => undefined),
) {
  return {
    getCapabilities: () => capabilities,
    getSettings: () => settings,
    applyConstraints,
  } as unknown as MediaStreamTrack;
}

describe("camera control capabilities", () => {
  it("normalizes supported numeric, focus, and torch controls", () => {
    const active = track({
      zoom: { min: 1, max: 5, step: 0.25 },
      exposureCompensation: { min: -2, max: 2, step: 0.5 },
      focusMode: ["continuous", "manual"],
      focusDistance: { min: 0.1, max: 10, step: 0.1 },
      torch: true,
    }, {
      zoom: 2,
      exposureCompensation: 0.5,
      focusMode: "continuous",
      focusDistance: 1.5,
      torch: false,
    });

    expect(readCameraControls(active)).toEqual({
      zoom: { min: 1, max: 5, step: 0.25, value: 2 },
      exposure: {
        property: "exposureCompensation",
        min: -2,
        max: 2,
        step: 0.5,
        value: 0.5,
      },
      focusModes: ["continuous", "manual"],
      focusMode: "continuous",
      focusDistance: { min: 0.1, max: 10, step: 0.1, value: 1.5 },
      torch: { value: false },
    });
  });

  it("uses brightness when exposure compensation is unavailable", () => {
    expect(readCameraControls(track(
      { brightness: { min: 0, max: 1, step: 0.1 } },
      { brightness: 0.6 },
    )).exposure).toEqual({
      property: "brightness",
      min: 0,
      max: 1,
      step: 0.1,
      value: 0.6,
    });
  });

  it("omits unsupported and invalid browser capability values", () => {
    expect(readCameraControls(track({
      zoom: { min: 5, max: 1, step: 0 },
      exposureCompensation: { min: Number.NaN, max: 2, step: 0.5 },
      focusMode: [],
      focusDistance: { min: 0, max: Number.POSITIVE_INFINITY, step: 1 },
      torch: false,
    }))).toEqual({ focusModes: [] });
  });

  it.each([
    ["zoom", 3, { zoom: 3 }],
    ["exposureCompensation", -1, { exposureCompensation: -1 }],
    ["brightness", 0.8, { brightness: 0.8 }],
    ["focusMode", "manual", { focusMode: "manual" }],
    ["focusDistance", 2.4, { focusDistance: 2.4 }],
    ["torch", true, { torch: true }],
  ] as const)("applies one supported %s constraint", async (control, value, expected) => {
    const applyConstraints = vi.fn(async () => undefined);
    const active = track({}, {}, applyConstraints);

    await applyCameraControl(active, control, value);

    expect(applyConstraints).toHaveBeenCalledWith({ advanced: [expected] });
  });

  it("propagates a rejected constraint so the caller can preserve its prior value", async () => {
    const failure = new DOMException("unsupported", "OverconstrainedError");
    const active = track({}, {}, vi.fn(async () => Promise.reject(failure)));

    await expect(applyCameraControl(active, "zoom", 4)).rejects.toBe(failure);
  });
});
