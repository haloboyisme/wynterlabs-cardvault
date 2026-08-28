export type FrameFingerprint = readonly number[];
export type FrameDetectorPhase = "waiting" | "stabilizing" | "awaiting_change";

export interface FrameDetectorOptions {
  stableSamples?: number;
  stableThreshold?: number;
  changeThreshold?: number;
}

export interface FrameDetectorState {
  phase: FrameDetectorPhase;
  stableCount: number;
  previous: FrameFingerprint | null;
  captured: FrameFingerprint | null;
  shouldCapture: boolean;
  stableSamples: number;
  stableThreshold: number;
  changeThreshold: number;
}

const distance = (left: FrameFingerprint, right: FrameFingerprint) => {
  if (left.length === 0 || left.length !== right.length) return Number.POSITIVE_INFINITY;
  return left.reduce((total, value, index) => total + Math.abs(value - right[index]!), 0)
    / left.length;
};

export const createFrameDetector = (options: FrameDetectorOptions = {}): FrameDetectorState => ({
  phase: "waiting",
  stableCount: 0,
  previous: null,
  captured: null,
  shouldCapture: false,
  stableSamples: Math.max(2, options.stableSamples ?? 3),
  stableThreshold: Math.max(0, options.stableThreshold ?? 5),
  changeThreshold: Math.max(1, options.changeThreshold ?? 20),
});

export const advanceFrameDetector = (
  state: FrameDetectorState,
  fingerprint: FrameFingerprint,
): FrameDetectorState => {
  if (fingerprint.length === 0) return { ...state, shouldCapture: false };

  if (state.phase === "awaiting_change" && state.captured) {
    if (distance(state.captured, fingerprint) < state.changeThreshold) {
      return { ...state, previous: fingerprint, shouldCapture: false };
    }
    return {
      ...state,
      phase: "stabilizing",
      stableCount: 1,
      previous: fingerprint,
      captured: null,
      shouldCapture: false,
    };
  }

  const stable = state.previous !== null
    && distance(state.previous, fingerprint) <= state.stableThreshold;
  const stableCount = stable ? state.stableCount + 1 : 1;
  if (stableCount >= state.stableSamples) {
    return {
      ...state,
      phase: "awaiting_change",
      stableCount,
      previous: fingerprint,
      captured: fingerprint,
      shouldCapture: true,
    };
  }
  return {
    ...state,
    phase: "stabilizing",
    stableCount,
    previous: fingerprint,
    shouldCapture: false,
  };
};
