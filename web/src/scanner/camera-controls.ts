export interface NumericCameraControl {
  min: number;
  max: number;
  step: number;
  value: number;
}

export interface ExposureCameraControl extends NumericCameraControl {
  property: "exposureCompensation" | "brightness";
}

export interface CameraControlState {
  zoom?: NumericCameraControl;
  exposure?: ExposureCameraControl;
  focusModes: string[];
  focusMode?: string;
  focusDistance?: NumericCameraControl;
  torch?: { value: boolean };
}

export type CameraControlName =
  | "zoom"
  | "exposureCompensation"
  | "brightness"
  | "focusMode"
  | "focusDistance"
  | "torch";

interface BrowserRange {
  min?: unknown;
  max?: unknown;
  step?: unknown;
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

function numericControl(capability: unknown, setting: unknown): NumericCameraControl | undefined {
  const range = record(capability) as BrowserRange;
  const min = Number(range.min);
  const max = Number(range.max);
  const step = Number(range.step);
  if (![min, max, step].every(Number.isFinite) || min > max || step <= 0) return undefined;
  const requested = Number(setting);
  const value = Number.isFinite(requested) ? Math.min(max, Math.max(min, requested)) : min;
  return { min, max, step, value };
}

export function readCameraControls(track: MediaStreamTrack): CameraControlState {
  const capabilities = record(track.getCapabilities?.());
  const settings = record(track.getSettings?.());
  const zoom = numericControl(capabilities.zoom, settings.zoom);
  const exposureCompensation = numericControl(
    capabilities.exposureCompensation,
    settings.exposureCompensation,
  );
  const brightness = numericControl(capabilities.brightness, settings.brightness);
  const focusDistance = numericControl(capabilities.focusDistance, settings.focusDistance);
  const focusModes = Array.isArray(capabilities.focusMode)
    ? [...new Set(capabilities.focusMode.filter((value): value is string => typeof value === "string"))]
    : [];
  const focusMode = typeof settings.focusMode === "string" && focusModes.includes(settings.focusMode)
    ? settings.focusMode
    : focusModes[0];
  return {
    ...(zoom ? { zoom } : {}),
    ...(exposureCompensation
      ? { exposure: { property: "exposureCompensation" as const, ...exposureCompensation } }
      : brightness
        ? { exposure: { property: "brightness" as const, ...brightness } }
        : {}),
    focusModes,
    ...(focusMode ? { focusMode } : {}),
    ...(focusDistance ? { focusDistance } : {}),
    ...(capabilities.torch === true ? { torch: { value: settings.torch === true } } : {}),
  };
}

export async function applyCameraControl(
  track: MediaStreamTrack,
  control: CameraControlName,
  value: number | string | boolean,
) {
  if (!track.applyConstraints) throw new Error("This camera cannot change settings.");
  await track.applyConstraints({
    advanced: [{ [control]: value } as MediaTrackConstraintSet],
  });
}
