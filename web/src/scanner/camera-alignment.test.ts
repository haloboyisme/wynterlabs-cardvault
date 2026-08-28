import { describe, expect, it } from "vitest";

import {
  DEFAULT_CAMERA_ALIGNMENT,
  effectiveCameraAngle,
  parseCameraAlignment,
  rotateCameraOrientation,
  serializeCameraAlignment,
} from "./camera-alignment";

describe("camera alignment state", () => {
  it("parses and serializes a valid private browser setting", () => {
    const alignment = parseCameraAlignment(
      '{"orientation":90,"straighten":-35,"viewZoom":1.25}',
    );

    expect(alignment).toEqual({ orientation: 90, straighten: -35, viewZoom: 1.25 });
    expect(serializeCameraAlignment(alignment)).toBe(
      '{"orientation":90,"straighten":-35,"viewZoom":1.25}',
    );
    expect(effectiveCameraAngle(alignment)).toBe(55);
  });

  it.each([
    [null],
    [""],
    ["not json"],
    ['{"orientation":40,"straighten":0,"viewZoom":1}'],
    ['{"orientation":90,"straighten":46,"viewZoom":1}'],
    ['{"orientation":90,"straighten":0,"viewZoom":2.01}'],
    ['{"orientation":90,"straighten":0.5,"viewZoom":1}'],
  ])("falls back completely for an invalid saved value %s", (stored) => {
    expect(parseCameraAlignment(stored)).toEqual(DEFAULT_CAMERA_ALIGNMENT);
  });

  it("wraps quarter-turn orientation in both directions", () => {
    expect(rotateCameraOrientation(0, "left")).toBe(270);
    expect(rotateCameraOrientation(270, "right")).toBe(0);
    expect(rotateCameraOrientation(90, "left")).toBe(0);
    expect(rotateCameraOrientation(90, "right")).toBe(180);
  });
});
