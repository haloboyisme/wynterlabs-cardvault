export type CameraOrientation = 0 | 90 | 180 | 270;
export type CameraRotationDirection = "left" | "right";

export interface CameraAlignment {
  orientation: CameraOrientation;
  straighten: number;
  viewZoom: number;
}

export const DEFAULT_CAMERA_ALIGNMENT: CameraAlignment = {
  orientation: 0,
  straighten: 0,
  viewZoom: 1,
};

const orientations: CameraOrientation[] = [0, 90, 180, 270];

const isAlignment = (value: unknown): value is CameraAlignment => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const orientation = Number(candidate.orientation);
  const straighten = Number(candidate.straighten);
  const viewZoom = Number(candidate.viewZoom);
  return orientations.includes(orientation as CameraOrientation)
    && Number.isInteger(straighten)
    && straighten >= -45
    && straighten <= 45
    && Number.isFinite(viewZoom)
    && viewZoom >= 1
    && viewZoom <= 2
    && Math.abs(viewZoom * 20 - Math.round(viewZoom * 20)) < 1e-8;
};

export function parseCameraAlignment(value: string | null): CameraAlignment {
  try {
    const parsed: unknown = value ? JSON.parse(value) : null;
    if (!isAlignment(parsed)) return { ...DEFAULT_CAMERA_ALIGNMENT };
    return {
      orientation: parsed.orientation,
      straighten: parsed.straighten,
      viewZoom: parsed.viewZoom,
    };
  } catch {
    return { ...DEFAULT_CAMERA_ALIGNMENT };
  }
}

export function serializeCameraAlignment(value: CameraAlignment): string {
  const alignment = isAlignment(value) ? value : DEFAULT_CAMERA_ALIGNMENT;
  return JSON.stringify({
    orientation: alignment.orientation,
    straighten: alignment.straighten,
    viewZoom: alignment.viewZoom,
  });
}

export function rotateCameraOrientation(
  value: CameraOrientation,
  direction: CameraRotationDirection,
): CameraOrientation {
  const index = orientations.indexOf(value);
  const offset = direction === "left" ? -1 : 1;
  return orientations[(index + offset + orientations.length) % orientations.length];
}

export function effectiveCameraAngle(value: CameraAlignment): number {
  const angle = value.orientation + value.straighten;
  return angle > 180 ? angle - 360 : angle;
}
