import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AUTO_SCANNER_SETTINGS } from "./auto-scanner-settings";
import { createSimulatedAutoScannerController } from "./auto-scanner-controller";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("simulated auto scanner controller", () => {
  it("connects, homes, and advances one simulated card", async () => {
    const controller = createSimulatedAutoScannerController(() => DEFAULT_AUTO_SCANNER_SETTINGS);
    await controller.connect();
    const home = controller.home();
    await vi.runAllTimersAsync();
    await home;
    const advance = controller.advance();
    await vi.runAllTimersAsync();
    await advance;
    expect(controller.snapshot().state).toBe("ready");
    expect(controller.snapshot().history.map((entry) => entry.command)).toEqual([
      "connect", "home", "advance",
    ]);
  });

  it("cancels simulated movement immediately on emergency stop", async () => {
    const controller = createSimulatedAutoScannerController(() => DEFAULT_AUTO_SCANNER_SETTINGS);
    await controller.connect();
    const movement = controller.advance();
    controller.stop();
    await movement;
    expect(controller.snapshot().state).toBe("stopped");
    expect(controller.snapshot().history.at(-1)?.command).toBe("stop");
    expect(controller.snapshot().history.at(-2)?.outcome).toBe("cancelled");
  });

  it("rejects a second movement while the simulator is busy", async () => {
    const controller = createSimulatedAutoScannerController(() => DEFAULT_AUTO_SCANNER_SETTINGS);
    await controller.connect();
    const movement = controller.advance();
    await expect(controller.home()).rejects.toThrow(/already moving/i);
    controller.stop();
    await movement;
  });

  it("settles cancelled movement and notifies subscribers", async () => {
    const controller = createSimulatedAutoScannerController(() => DEFAULT_AUTO_SCANNER_SETTINGS);
    const states: string[] = [];
    const unsubscribe = controller.subscribe((snapshot) => states.push(snapshot.state));
    await controller.connect();
    const movement = controller.home();
    controller.disconnect();
    await movement;
    unsubscribe();
    expect(controller.snapshot().state).toBe("disconnected");
    expect(states).toContain("moving");
    expect(states.at(-1)).toBe("disconnected");
  });

  it("keeps only the newest twenty command entries", async () => {
    const controller = createSimulatedAutoScannerController(() => DEFAULT_AUTO_SCANNER_SETTINGS);
    await controller.connect();
    for (let index = 0; index < 25; index += 1) controller.stop();
    expect(controller.snapshot().history).toHaveLength(20);
    expect(controller.snapshot().history.at(-1)?.command).toBe("stop");
  });
});
