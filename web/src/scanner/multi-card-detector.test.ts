import { describe, expect, it } from "vitest";

import {
  advanceFrameDetector,
  createFrameDetector,
  type FrameFingerprint,
} from "./multi-card-detector";

const frame = (...values: number[]): FrameFingerprint => values;

describe("multi-card frame detector", () => {
  it("captures after three stable samples and waits for material change", () => {
    let state = createFrameDetector();
    state = advanceFrameDetector(state, frame(20, 30, 40));
    expect(state.phase).toBe("stabilizing");
    expect(state.shouldCapture).toBe(false);

    state = advanceFrameDetector(state, frame(21, 30, 39));
    expect(state.shouldCapture).toBe(false);
    state = advanceFrameDetector(state, frame(20, 31, 40));
    expect(state.shouldCapture).toBe(true);
    expect(state.phase).toBe("awaiting_change");

    state = advanceFrameDetector(state, frame(20, 30, 40));
    expect(state.shouldCapture).toBe(false);
    expect(state.phase).toBe("awaiting_change");
  });

  it("rearms after removal so an identical physical copy can be captured", () => {
    let state = createFrameDetector({ stableSamples: 2, changeThreshold: 20 });
    state = advanceFrameDetector(state, frame(10, 10, 10));
    state = advanceFrameDetector(state, frame(11, 10, 10));
    expect(state.shouldCapture).toBe(true);

    state = advanceFrameDetector(state, frame(100, 100, 100));
    expect(state.phase).toBe("stabilizing");
    state = advanceFrameDetector(state, frame(10, 10, 10));
    expect(state.shouldCapture).toBe(false);
    state = advanceFrameDetector(state, frame(11, 10, 10));
    expect(state.shouldCapture).toBe(true);
  });

  it("resets stabilization when the view keeps moving", () => {
    let state = createFrameDetector();
    state = advanceFrameDetector(state, frame(10, 10));
    state = advanceFrameDetector(state, frame(80, 80));
    expect(state.stableCount).toBe(1);
    state = advanceFrameDetector(state, frame(20, 20));
    expect(state.stableCount).toBe(1);
    expect(state.shouldCapture).toBe(false);
  });

  it("rejects incompatible or empty fingerprints", () => {
    let state = createFrameDetector();
    state = advanceFrameDetector(state, frame());
    expect(state.phase).toBe("waiting");
    state = advanceFrameDetector(state, frame(1, 2));
    state = advanceFrameDetector(state, frame(1));
    expect(state.stableCount).toBe(1);
  });
});
