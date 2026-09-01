import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  AUTO_SCANNER_STORAGE_KEY,
  DEFAULT_AUTO_SCANNER_SETTINGS,
} from "../scanner/auto-scanner-settings";
import { createSimulatedAutoScannerController } from "../scanner/auto-scanner-controller";
import { AutoScannerControllerPanel } from "./AutoScannerControllerPanel";

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

it("connects the simulator and exposes bounded quick controls", async () => {
  render(<AutoScannerControllerPanel />);

  expect(screen.getByText(/simulation only/i)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Connect simulator" }));

  expect(await screen.findByRole("status", { name: "Controller status" })).toHaveTextContent(/ready/i);
  expect(screen.getByLabelText("Card speed")).toHaveAttribute("min", "1");
  expect(screen.getByLabelText("Card speed")).toHaveAttribute("max", "100");
  expect(screen.getByLabelText("Scan countdown")).toHaveAttribute("max", "10");
  expect(screen.getByLabelText("Settle delay")).toHaveAttribute("min", "250");
});

it("clamps quick tuning values before saving the browser-local profile", () => {
  render(<AutoScannerControllerPanel />);

  fireEvent.change(screen.getByLabelText("Card speed"), { target: { value: "999" } });
  fireEvent.change(screen.getByLabelText("Scan countdown"), { target: { value: "0" } });
  fireEvent.change(screen.getByLabelText("Settle delay"), { target: { value: "10001" } });

  expect(screen.getByLabelText("Card speed")).toHaveValue(100);
  expect(screen.getByLabelText("Scan countdown")).toHaveValue(1);
  expect(screen.getByLabelText("Settle delay")).toHaveValue(10000);
  expect(JSON.parse(localStorage.getItem(AUTO_SCANNER_STORAGE_KEY) ?? "{}"))
    .toMatchObject({
      ...DEFAULT_AUTO_SCANNER_SETTINGS,
      speedPercent: 100,
      countdownSeconds: 1,
      settleDelayMs: 10000,
    });
});

it("exposes bounded acceleration, recognition timeout, and retry tuning", () => {
  render(<AutoScannerControllerPanel />);

  expect(screen.getByLabelText("Acceleration")).toHaveAttribute("min", "1");
  expect(screen.getByLabelText("Acceleration")).toHaveAttribute("max", "100");
  expect(screen.getByLabelText("Recognition timeout")).toHaveAttribute("min", "5");
  expect(screen.getByLabelText("Recognition timeout")).toHaveAttribute("max", "60");
  expect(screen.getByLabelText("Retry limit")).toHaveAttribute("min", "0");
  expect(screen.getByLabelText("Retry limit")).toHaveAttribute("max", "3");

  fireEvent.change(screen.getByLabelText("Acceleration"), { target: { value: "45" } });
  fireEvent.change(screen.getByLabelText("Recognition timeout"), { target: { value: "20" } });
  fireEvent.change(screen.getByLabelText("Retry limit"), { target: { value: "2" } });

  expect(JSON.parse(localStorage.getItem(AUTO_SCANNER_STORAGE_KEY) ?? "{}"))
    .toMatchObject({ accelerationPercent: 45, recognitionTimeoutSeconds: 20, retryLimit: 2 });
});

it("runs a simulation-only safety check without moving the controller", () => {
  render(<AutoScannerControllerPanel />);

  fireEvent.click(screen.getByRole("button", { name: "Run safety check" }));

  expect(screen.getByRole("status", { name: "Controller safety check" }))
    .toHaveTextContent("Profile is ready for simulation");
  expect(screen.getByRole("status", { name: "Controller status" }))
    .toHaveTextContent(/disconnected/i);
  expect(screen.getByText("Command history (0)")).toBeVisible();
});

it("shows active-profile diagnostics and command history after connecting", async () => {
  render(<AutoScannerControllerPanel />);

  expect(screen.getByText("Test card feeder")).toBeVisible();
  expect(screen.getByText("ESP32")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Connect simulator" }));

  expect(screen.getByText(/last message: ready/i)).toBeVisible();
  fireEvent.click(screen.getByText(/command history/i));
  expect(screen.getByText(/connected/i, { selector: "li" })).toBeVisible();
  expect(document.querySelector("time")).toHaveAttribute("dateTime");
});

it("keeps movement controls disabled until connected and records a completed home action", async () => {
  vi.useFakeTimers();
  try {
    render(<AutoScannerControllerPanel />);

    expect(screen.getByRole("button", { name: "Home" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Advance card" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Connect simulator" }));
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(screen.getByRole("status", { name: "Controller status" })).toHaveTextContent(/moving/i);

    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(screen.getByRole("status", { name: "Controller status" })).toHaveTextContent(/ready/i);
    fireEvent.click(screen.getByText(/command history/i));
    expect(screen.getByText(/homing complete/i, { selector: "li" })).toBeVisible();
  } finally {
    vi.useRealTimers();
  }
});

it("counts down 3, 2, 1, moves, settles, and announces capture readiness once", async () => {
  vi.useFakeTimers();
  try {
    localStorage.setItem(AUTO_SCANNER_STORAGE_KEY, JSON.stringify({
      ...DEFAULT_AUTO_SCANNER_SETTINGS,
      speedPercent: 100,
      countdownSeconds: 3,
      settleDelayMs: 250,
    }));
    const onReadyForCapture = vi.fn();
    render(<AutoScannerControllerPanel onReadyForCapture={onReadyForCapture} />);

    fireEvent.click(screen.getByRole("button", { name: "Connect simulator" }));
    fireEvent.click(screen.getByRole("button", { name: "Advance card" }));
    expect(screen.getByText("Advancing in 3")).toBeVisible();
    expect(screen.getByRole("button", { name: "Emergency stop" })).toBeEnabled();

    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByText("Advancing in 2")).toBeVisible();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByText("Advancing in 1")).toBeVisible();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByRole("status", { name: "Controller status" })).toHaveTextContent(/moving/i);
    expect(screen.getByRole("button", { name: "Emergency stop" })).toBeEnabled();

    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(screen.getByRole("status", { name: "Controller status" })).toHaveTextContent(/ready/i);
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(onReadyForCapture).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(onReadyForCapture).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText(/command history/i));
    expect(screen.getByText(/card advanced/i, { selector: "li" })).toBeVisible();
  } finally {
    vi.useRealTimers();
  }
});

it("cancels a countdown with Emergency stop and never announces capture readiness", async () => {
  vi.useFakeTimers();
  try {
    const onReadyForCapture = vi.fn();
    render(<AutoScannerControllerPanel onReadyForCapture={onReadyForCapture} />);

    fireEvent.click(screen.getByRole("button", { name: "Connect simulator" }));
    fireEvent.click(screen.getByRole("button", { name: "Advance card" }));
    expect(screen.getByText("Advancing in 3")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Emergency stop" }));

    expect(screen.getByRole("status", { name: "Controller status" })).toHaveTextContent(/stopped/i);
    expect(screen.queryByText(/advancing in/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Emergency stop" })).toBeEnabled();
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(onReadyForCapture).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("clears capture readiness after an emergency stop following a completed advance", async () => {
  vi.useFakeTimers();
  try {
    localStorage.setItem(AUTO_SCANNER_STORAGE_KEY, JSON.stringify({
      ...DEFAULT_AUTO_SCANNER_SETTINGS,
      speedPercent: 100,
      countdownSeconds: 1,
      settleDelayMs: 250,
    }));
    const readiness = vi.fn();
    render(<AutoScannerControllerPanel onCaptureReadinessChange={readiness} />);

    fireEvent.click(screen.getByRole("button", { name: "Connect simulator" }));
    fireEvent.click(screen.getByRole("button", { name: "Advance card" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    expect(readiness).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByRole("button", { name: "Emergency stop" }));
    expect(readiness).toHaveBeenLastCalledWith(false);
  } finally {
    vi.useRealTimers();
  }
});

it("disposes every owned controller created by StrictMode", () => {
  const controllers = [
    createSimulatedAutoScannerController(() => DEFAULT_AUTO_SCANNER_SETTINGS),
    createSimulatedAutoScannerController(() => DEFAULT_AUTO_SCANNER_SETTINGS),
  ];
  const dispose = controllers.map((controller) => vi.spyOn(controller, "dispose"));
  let next = 0;
  const view = render(<StrictMode><AutoScannerControllerPanel controllerFactory={() => controllers[next++]!} /></StrictMode>);

  view.unmount();

  expect(next).toBe(2);
  dispose.forEach((spy) => expect(spy).toHaveBeenCalledOnce());
});

it("clears a pending countdown when the panel unmounts", async () => {
  vi.useFakeTimers();
  try {
    const onReadyForCapture = vi.fn();
    const view = render(<AutoScannerControllerPanel onReadyForCapture={onReadyForCapture} />);

    fireEvent.click(screen.getByRole("button", { name: "Connect simulator" }));
    fireEvent.click(screen.getByRole("button", { name: "Advance card" }));
    view.unmount();

    await act(async () => { await vi.runAllTimersAsync(); });
    expect(onReadyForCapture).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("clears a pending countdown when the simulator disconnects", async () => {
  vi.useFakeTimers();
  try {
    const onReadyForCapture = vi.fn();
    render(<AutoScannerControllerPanel onReadyForCapture={onReadyForCapture} />);

    fireEvent.click(screen.getByRole("button", { name: "Connect simulator" }));
    fireEvent.click(screen.getByRole("button", { name: "Advance card" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect simulator" }));

    expect(screen.getByRole("status", { name: "Controller status" })).toHaveTextContent(/disconnected/i);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(onReadyForCapture).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("cancels the old controller countdown and subscribes when its controller prop changes", async () => {
  vi.useFakeTimers();
  try {
    const firstController = createSimulatedAutoScannerController(() => DEFAULT_AUTO_SCANNER_SETTINGS);
    const replacementController = createSimulatedAutoScannerController(() => DEFAULT_AUTO_SCANNER_SETTINGS);
    const onReadyForCapture = vi.fn();
    await firstController.connect();
    const view = render(
      <AutoScannerControllerPanel controller={firstController} onReadyForCapture={onReadyForCapture} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Advance card" }));
    expect(screen.getByText("Advancing in 3")).toBeVisible();

    view.rerender(
      <AutoScannerControllerPanel controller={replacementController} onReadyForCapture={onReadyForCapture} />,
    );

    expect(screen.getByRole("status", { name: "Controller status" })).toHaveTextContent(/disconnected/i);
    fireEvent.click(screen.getByRole("button", { name: "Connect simulator" }));
    expect(screen.getByRole("status", { name: "Controller status" })).toHaveTextContent(/ready/i);

    const detachedControllerHome = firstController.home();
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await detachedControllerHome;
    expect(firstController.snapshot().history.at(-1)).toMatchObject({
      command: "home",
      outcome: "completed",
    });

    await act(async () => { await vi.runAllTimersAsync(); });
    expect(onReadyForCapture).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
