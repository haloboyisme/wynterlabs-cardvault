import type { AutoScannerSettings } from "./auto-scanner-settings";

export type AutoScannerControllerState =
  | "disconnected" | "connecting" | "ready" | "moving" | "stopped" | "error";
export type AutoScannerCommand = "connect" | "disconnect" | "home" | "advance" | "stop";

export interface AutoScannerCommandEntry {
  id: string;
  command: AutoScannerCommand;
  at: string;
  outcome: "completed" | "cancelled" | "failed";
  message: string;
}

export interface AutoScannerControllerSnapshot {
  state: AutoScannerControllerState;
  message: string;
  history: AutoScannerCommandEntry[];
}

export interface AutoScannerController {
  snapshot(): AutoScannerControllerSnapshot;
  subscribe(listener: (snapshot: AutoScannerControllerSnapshot) => void): () => void;
  connect(): Promise<void>;
  disconnect(): void;
  home(): Promise<void>;
  advance(): Promise<void>;
  stop(): void;
  dispose(): void;
}

type PendingMovement = {
  command: "home" | "advance";
  timer: ReturnType<typeof setTimeout>;
  resolve: () => void;
};

const MAX_HISTORY = 20;
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export function createSimulatedAutoScannerController(
  getSettings: () => AutoScannerSettings,
): AutoScannerController {
  let state: AutoScannerControllerState = "disconnected";
  let message = "Disconnected";
  let disposed = false;
  let sequence = 0;
  let pending: PendingMovement | undefined;
  const history: AutoScannerCommandEntry[] = [];
  const listeners = new Set<(snapshot: AutoScannerControllerSnapshot) => void>();

  const snapshot = (): AutoScannerControllerSnapshot => ({
    state,
    message,
    history: history.map((entry) => ({ ...entry })),
  });

  const notify = () => {
    if (disposed) return;
    const current = snapshot();
    listeners.forEach((listener) => listener(current));
  };

  const setState = (next: AutoScannerControllerState, nextMessage: string) => {
    state = next;
    message = nextMessage;
    notify();
  };

  const record = (
    command: AutoScannerCommand,
    outcome: AutoScannerCommandEntry["outcome"],
    entryMessage: string,
  ) => {
    history.push({
      id: String(++sequence),
      command,
      at: new Date().toISOString(),
      outcome,
      message: entryMessage,
    });
    if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
    notify();
  };

  const settlePending = (outcome: "cancelled" | "completed", entryMessage: string) => {
    if (!pending) return;
    const movement = pending;
    pending = undefined;
    clearTimeout(movement.timer);
    record(movement.command, outcome, entryMessage);
    movement.resolve();
  };

  const rejectMovement = (command: "home" | "advance"): Promise<void> => {
    let reason = "Scanner is disconnected";
    if (state === "moving") reason = "Scanner is already moving";
    else if (state === "stopped") reason = "Scanner is stopped";
    record(command, "failed", reason);
    return Promise.reject(new Error(reason));
  };

  const move = (command: "home" | "advance") => {
    if (disposed || state === "disconnected" || state === "stopped" || state === "error" || state === "moving") {
      return rejectMovement(command);
    }
    const settings = getSettings();
    const duration = command === "home"
      ? 400
      : clamp(Math.round((settings.stepsPerCard / settings.speedPercent) * 100), 250, 3000);
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (!pending) return;
        pending = undefined;
        record(command, "completed", command === "home" ? "Homing complete" : "Card advanced");
        setState("ready", "Ready");
        resolve();
      }, duration);
      pending = { command, timer, resolve };
      setState("moving", command === "home" ? "Homing simulated scanner" : "Advancing simulated card");
    });
  };

  return {
    snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    async connect() {
      if (disposed) return;
      if (state === "moving") throw new Error("Scanner is already moving");
      setState("connecting", "Connecting simulated scanner");
      record("connect", "completed", "Connected");
      setState("ready", "Ready");
    },
    disconnect() {
      if (disposed) return;
      settlePending("cancelled", "Movement cancelled by disconnect");
      record("disconnect", "completed", "Disconnected");
      setState("disconnected", "Disconnected");
    },
    home: () => move("home"),
    advance: () => move("advance"),
    stop() {
      if (disposed) return;
      settlePending("cancelled", "Movement cancelled by emergency stop");
      record("stop", "completed", "Emergency stop engaged");
      setState("stopped", "Stopped");
    },
    dispose() {
      if (disposed) return;
      settlePending("cancelled", "Movement cancelled by disposal");
      listeners.clear();
      disposed = true;
    },
  };
}
