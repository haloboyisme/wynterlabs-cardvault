import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { expandScanCandidates, getScanCandidates } from "../lib/catalog";
import { recognizeCardPhoto } from "../lib/scanner";
import type { ScanCandidate } from "../lib/types";
import type { AutoScannerController, AutoScannerControllerSnapshot } from "../scanner/auto-scanner-controller";
import { AUTO_SCANNER_STORAGE_KEY, DEFAULT_AUTO_SCANNER_SETTINGS } from "../scanner/auto-scanner-settings";
import { AutoScanWorkspace } from "./AutoScanWorkspace";

const controllerFactory = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("./CardScanner", () => ({
  CardScanner: ({ onResult, topControls, stableFrameAutoCapture }: {
    onResult: (value: object) => void;
    topControls?: ReactNode;
    stableFrameAutoCapture?: boolean;
  }) => <>
    <section aria-label="Scanner controls">{topControls}</section>
    <p>Stable frame auto-capture: {stableFrameAutoCapture ? "on" : "off"}</p>
    <button onClick={() => onResult({
      hints: { name: "Black Lotus", titleCandidates: ["Black Lotus"], rawText: "Black Lotus" },
      previewUrl: "blob:auto-card",
      imageBlob: new Blob(["auto-card"]),
    })}>Capture now</button>
  </>,
}));
vi.mock("../lib/catalog", () => ({
  expandScanCandidates: vi.fn(),
  getScanCandidates: vi.fn(),
}));
vi.mock("../lib/scanner", () => ({ recognizeCardPhoto: vi.fn() }));
vi.mock("../scanner/auto-scanner-controller", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../scanner/auto-scanner-controller")>();
  return { ...actual, createSimulatedAutoScannerController: controllerFactory.create };
});

const candidate = {
  printing_id: "p1", oracle_id: "o1", name: "Black Lotus", mana_cost: "{0}",
  type_line: "Artifact", collector_number: "233", rarity: "rare",
  released_at: "1993-08-05", language: "en", layout: "normal", image_uris: {},
  prices: {}, finishes: ["nonfoil"], colors: [], active: true, rank_reason: "exact_printing",
  set: { id: "s1", code: "LEA", name: "Limited Edition Alpha", set_type: "core", released_at: "1993-08-05", card_count: 295, digital: false, icon_svg_uri: null, game: "mtg" },
} satisfies ScanCandidate;

let controller: AutoScannerController;

function createController(): AutoScannerController {
  let snapshot: AutoScannerControllerSnapshot = { state: "disconnected", message: "Disconnected", history: [] };
  let listener: ((value: AutoScannerControllerSnapshot) => void) | undefined;
  const setSnapshot = (state: AutoScannerControllerSnapshot["state"], message: string) => {
    snapshot = { state, message, history: [] };
    listener?.(snapshot);
  };
  return {
    snapshot: () => snapshot,
    subscribe: (nextListener) => {
      listener = nextListener;
      listener(snapshot);
      return () => { listener = undefined; };
    },
    connect: async () => setSnapshot("ready", "Ready"),
    disconnect: () => setSnapshot("disconnected", "Disconnected"),
    home: async () => setSnapshot("ready", "Ready"),
    advance: async () => setSnapshot("ready", "Ready"),
    stop: () => setSnapshot("stopped", "Stopped"),
    dispose: vi.fn(),
  };
}

beforeEach(() => {
  localStorage.clear();
  controller = createController();
  controllerFactory.create.mockReturnValue(controller);
  vi.mocked(recognizeCardPhoto).mockResolvedValue({
    name: "Black Lotus", titleCandidates: ["Black Lotus"], rawText: "Black Lotus",
  });
  vi.mocked(getScanCandidates).mockResolvedValue([candidate]);
  vi.mocked(expandScanCandidates).mockResolvedValue([candidate]);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

it("keeps controller movement informational while reusing the explicit multi-card workflow", async () => {
  const user = userEvent.setup();
  render(<AutoScanWorkspace
    preferredSet=""
    preferredSetGame=""
    preferredGame=""
    topControls={<span>Shared scan preferences</span>}
  />);

  expect(screen.getByRole("heading", { name: "Automatic card session" })).toBeVisible();
  expect(screen.getByText(/simulation only/i)).toBeVisible();
  expect(screen.getByText("Shared scan preferences")).toBeVisible();
  expect(screen.getByText("Stable frame auto-capture: off")).toBeVisible();
  expect(screen.getByRole("button", { name: "Capture now" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Card-by-card session" })).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Capture now" }));
  await waitFor(() => expect(screen.getByRole("list", { name: "Cards captured this session" }))
    .toHaveTextContent("Black Lotus"));
  expect(screen.getByLabelText("Search title")).toBeVisible();
  expect(screen.getByRole("button", { name: "Add confirmed cards" })).toBeVisible();
});

it("clears the ready notice when explicit capture is accepted", async () => {
  vi.useFakeTimers();
  try {
    localStorage.setItem(AUTO_SCANNER_STORAGE_KEY, JSON.stringify({
      ...DEFAULT_AUTO_SCANNER_SETTINGS,
      speedPercent: 100,
      countdownSeconds: 1,
      settleDelayMs: 250,
    }));
    render(<AutoScanWorkspace
      preferredSet=""
      preferredSetGame=""
      preferredGame=""
      topControls={<span>Shared scan preferences</span>}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Connect simulator" }));
    fireEvent.click(screen.getByRole("button", { name: "Advance card" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_250); });
    expect(screen.getByText("Next card is ready. Choose Capture now when the card is in view.")).toBeVisible();

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Capture now" })); });
    expect(screen.queryByText("Next card is ready. Choose Capture now when the card is in view.")).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

it("disposes the simulator when the automatic workspace closes", async () => {
  const view = render(<AutoScanWorkspace
    preferredSet=""
    preferredSetGame=""
    preferredGame=""
    topControls={<span>Shared scan preferences</span>}
  />);

  view.unmount();

  await waitFor(() => expect(controller.dispose).toHaveBeenCalledOnce());
});
