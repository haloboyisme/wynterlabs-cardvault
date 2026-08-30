import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, type ReactNode } from "react";

import { addCollectionItem, getCollectionSummary } from "../lib/collection";
import { expandScanCandidates, getAllCatalogSets, getScanCandidates } from "../lib/catalog";
import { recognizeCardPhoto } from "../lib/scanner";
import type { ScanCandidate } from "../lib/types";
import { ScannerPage } from "./ScannerPage";

vi.mock("../components/CardScanner", () => ({
  CardScanner: ({
    onResult,
    onReset,
    nextCardSignal = 0,
    topControls,
  }: {
    onResult: (value: object) => void;
    onReset?: () => void;
    nextCardSignal?: number;
    topControls?: ReactNode;
  }) => (
    <>
      <section aria-label="Scanner controls">{topControls}</section>
      <div data-testid="scanner-session">Scanner session {nextCardSignal}</div>
      <button onClick={() => onResult({
        hints: {
          name: "Black Lotus",
          titleCandidates: ["Black Lotus"],
          set: "lea",
          collector: "233",
          rawText: "Black Lotus\nLEA 233",
        },
        previewUrl: "blob:card-photo",
      })}>Return OCR hints</button>
      <button onClick={() => onResult({
        hints: {
          name: "Black Lotus",
          titleCandidates: ["Black Lotus"],
          set: "lea",
          collector: "0233/0295",
          rawText: "Black Lotus\nLEA 0233/0295",
        },
        previewUrl: "blob:collector-photo",
      })}>Return denominator OCR hints</button>
      <button onClick={() => onResult({
        hints: {
          name: "Voja, Jaws of the Conciave",
          titleCandidates: [
            "Voja, Jaws of the Conciave",
            "Voja, Jaws of the Conclave",
          ],
          set: "sld",
          collector: "2284",
          rawText: "Voja, Jaws of the Conciave\nVoja, Jaws of the Conclave\nSLD 2284",
        },
        previewUrl: "blob:voja-photo",
      })}>Return garbled OCR hints</button>
      <button onClick={() => onResult({
        hints: {
          name: "Unreadable Card",
          titleCandidates: ["Unreadable Card"],
          rawText: "Unreadable Card",
        },
        previewUrl: "blob:unmatched-photo",
      })}>Return unmatched OCR hints</button>
      <button onClick={() => onResult({
        hints: {
          name: "i ro a \\ a A",
          titleCandidates: ["i ro a \\ a A"],
          rawText: "i ro a \\ a A",
        },
        previewUrl: "blob:false-match-photo",
      })}>Return false-match OCR hints</button>
      <button onClick={() => onResult({
        hints: {
          name: "11 Whenever Voja anaes, put X 41/01",
          titleCandidates: ["11 Whenever Voja anaes, put X 41/01"],
          set: "msc",
          collector: "529",
          rawText: "11 Whenever Voja anaes, put X 41/01",
        },
        previewUrl: "blob:private-ai-photo",
        imageBlob: new Blob(["voja pixels"], { type: "image/jpeg" }),
      })}>Return private AI photo</button>
      <button onClick={() => onReset?.()}>Retake photo</button>
    </>
  ),
}));
vi.mock("../lib/catalog", () => ({
  expandScanCandidates: vi.fn(),
  getAllCatalogSets: vi.fn(),
  getScanCandidates: vi.fn(),
}));
vi.mock("../lib/collection", () => ({
  addCollectionItem: vi.fn(),
  getCollectionSummary: vi.fn(),
}));
vi.mock("../lib/scanner", () => ({ recognizeCardPhoto: vi.fn() }));

const candidate = {
  printing_id: "p1", oracle_id: "o1", name: "Black Lotus", mana_cost: "{0}",
  type_line: "Artifact", collector_number: "233", rarity: "rare",
  released_at: "1993-08-05", language: "en", layout: "normal", image_uris: {},
  prices: {}, finishes: ["nonfoil", "foil"], colors: [], active: true,
  rank_reason: "exact_printing",
  set: { id: "s1", code: "LEA", name: "Limited Edition Alpha", set_type: "core", released_at: "1993-08-05", card_count: 295, digital: false, icon_svg_uri: null, game: 'mtg' },
} satisfies ScanCandidate;

const vojaCandidate = {
  ...candidate,
  printing_id: "p-voja",
  oracle_id: "o-voja",
  name: "Voja, Jaws of the Conclave",
  collector_number: "2284",
  set: { ...candidate.set, id: "s-sld", code: "SLD", name: "Secret Lair Drop" },
} satisfies ScanCandidate;

const aimBotCandidate = {
  ...candidate,
  printing_id: "p-aim-bot",
  oracle_id: "o-aim-bot",
  name: "A.I.M. Bot",
  collector_number: "529",
  rank_reason: "fuzzy_name",
  set: { ...candidate.set, id: "s-msc", code: "MSC", name: "Marvel Super Heroes Commander" },
} satisfies ScanCandidate;

const newerPrinting = {
  ...candidate,
  printing_id: "p2",
  collector_number: "500",
  set: { ...candidate.set, id: "s2", code: "CMM", name: "Commander Masters" },
} satisfies ScanCandidate;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.mocked(expandScanCandidates).mockImplementation(async (seeds) => seeds);
  vi.mocked(getAllCatalogSets).mockResolvedValue({
    items: [
      { ...candidate.set, id: "s-pip", code: "PIP", name: "Fallout" },
      candidate.set,
    ],
    page: 1,
    page_size: 200,
    total: 2,
    pages: 1,
  });
});

it("shares game and preferred-set controls across single and multiple scan modes", async () => {
  const user = userEvent.setup();
  render(<ScannerPage />);

  const game = await screen.findByRole("combobox", { name: "Game or brand" });
  const preferredSet = screen.getByRole("combobox", { name: "Preferred set" });
  expect(game).toHaveValue("");
  expect(preferredSet).toHaveValue("");
  expect(screen.getByRole("option", { name: "Auto — all supported games" })).toBeVisible();
  expect(screen.getByRole("option", { name: "Magic: The Gathering" })).toBeVisible();
  expect(screen.getByRole("option", { name: "Auto — all sets" })).toBeVisible();
  expect(screen.getByRole("option", { name: "Fallout (PIP)" })).toBeVisible();
  expect(screen.getByText(/prioritizes likely matches.*other sets available/i)).toBeVisible();

  await user.selectOptions(preferredSet, "mtg:pip");
  await user.selectOptions(game, "mtg");
  await user.click(screen.getByRole("radio", { name: "Multiple cards (session)" }));
  expect(screen.getByRole("combobox", { name: "Preferred set" })).toHaveValue("mtg:pip");
  expect(screen.getByRole("combobox", { name: "Game or brand" })).toHaveValue("mtg");
  await user.click(screen.getByRole("radio", { name: "Auto scanner (test)" }));
  expect(screen.getByRole("combobox", { name: "Preferred set" })).toHaveValue("mtg:pip");
  expect(screen.getByRole("combobox", { name: "Game or brand" })).toHaveValue("mtg");
});

it("keeps Auto scanning open while a game-qualified preferred set guides ranking", async () => {
  const pokemonLea = {
    ...candidate.set,
    id: "pokemon-lea",
    code: "LEA",
    name: "Pokémon LEA",
    game: "pokemon",
  };
  vi.mocked(getAllCatalogSets).mockResolvedValue({
    items: [{ ...candidate.set }, pokemonLea], page: 1, page_size: 200, total: 2, pages: 1,
  });
  vi.mocked(getScanCandidates).mockResolvedValue([candidate]);
  const user = userEvent.setup();
  render(<ScannerPage />);

  const preferredSet = await screen.findByRole("combobox", { name: "Preferred set" });
  await user.selectOptions(preferredSet, "pokemon:lea");
  await user.click(screen.getByRole("button", { name: "Return OCR hints" }));

  await waitFor(() => expect(getScanCandidates).toHaveBeenCalledWith(
    expect.objectContaining({
      preferredSet: "LEA",
      preferredGame: "pokemon",
      game: undefined,
    }),
    expect.any(AbortSignal),
  ));
});

it("forwards the selected game from single-card scanning", async () => {
  vi.mocked(getScanCandidates).mockResolvedValue([candidate]);
  const user = userEvent.setup();
  render(<ScannerPage />);

  await user.selectOptions(await screen.findByRole("combobox", { name: "Game or brand" }), "pokemon");
  await user.click(screen.getByRole("button", { name: "Return OCR hints" }));

  await waitFor(() => expect(getScanCandidates).toHaveBeenCalledWith(
    expect.objectContaining({ game: "pokemon" }),
    expect.any(AbortSignal),
  ));
});

it("keeps the selected game while expanding single-card candidate printings", async () => {
  vi.mocked(getScanCandidates).mockResolvedValue([candidate]);
  vi.mocked(expandScanCandidates).mockResolvedValue([candidate]);
  const user = userEvent.setup();
  render(<ScannerPage />);

  await user.selectOptions(await screen.findByRole("combobox", { name: "Game or brand" }), "mtg");
  await user.click(screen.getByRole("button", { name: "Return OCR hints" }));

  await waitFor(() => expect(expandScanCandidates).toHaveBeenCalledWith(
    [candidate],
    expect.any(AbortSignal),
    "mtg",
  ));
});

it("preselects a normalized collector match without trusting a fabricated rank reason", async () => {
  const { rank_reason: _serverRank, ...apiCandidate } = candidate;
  vi.mocked(getScanCandidates).mockResolvedValue([apiCandidate as unknown as ScanCandidate]);
  vi.mocked(expandScanCandidates).mockResolvedValue([apiCandidate as unknown as ScanCandidate]);
  const user = userEvent.setup();
  render(<ScannerPage />);

  await user.click(screen.getByRole("button", { name: "Return denominator OCR hints" }));

  expect(await screen.findByRole("radio", { name: /black lotus.*lea.*233/i })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: /confirm this exact printing/i })).not.toBeChecked();
});

it("switches between manual and multiple-card scanning without hiding either workflow", async () => {
  const user = userEvent.setup();
  render(<ScannerPage />);

  expect(screen.getByRole("radio", { name: "Single card (manual)" })).toBeChecked();
  await user.click(screen.getByRole("radio", { name: "Multiple cards (session)" }));
  expect(screen.getByRole("heading", { name: "Card-by-card session" })).toBeVisible();
  expect(screen.getByText(/maximum of 250 captures/i)).toBeVisible();

  await user.click(screen.getByRole("radio", { name: "Single card (manual)" }));
  expect(screen.getByTestId("scanner-session")).toBeVisible();
});

it("opens a private simulation-only Auto scanner mode without removing manual modes", async () => {
  const user = userEvent.setup();
  render(<ScannerPage />);

  await user.click(screen.getByRole("radio", { name: "Auto scanner (test)" }));

  expect(screen.getByRole("heading", { name: "Automatic card session" })).toBeVisible();
  expect(screen.getByText(/simulation only/i)).toBeVisible();
  expect(screen.getByRole("heading", { name: "Card-by-card session" })).toBeVisible();
  expect(screen.getByLabelText("Game or brand")).toBeVisible();
  expect(screen.getByLabelText("Preferred set")).toBeVisible();
  expect(screen.getByRole("radio", { name: "Single card (manual)" })).toBeVisible();
  expect(screen.getByRole("radio", { name: "Multiple cards (session)" })).toBeVisible();
});

it("starts a fresh automatic simulator session after leaving the mode", async () => {
  const user = userEvent.setup();
  render(<ScannerPage />);

  await user.click(screen.getByRole("radio", { name: "Auto scanner (test)" }));
  await user.click(screen.getByRole("button", { name: "Connect simulator" }));
  expect(await screen.findByRole("status", { name: "Controller status" })).toHaveTextContent(/ready/i);
  expect(screen.getByText(/command history \(1\)/i)).toBeVisible();

  await user.click(screen.getByRole("radio", { name: "Multiple cards (session)" }));
  expect(screen.getByRole("heading", { name: "Card-by-card session" })).toBeVisible();
  await user.click(screen.getByRole("radio", { name: "Auto scanner (test)" }));

  expect(screen.getByRole("status", { name: "Controller status" })).toHaveTextContent(/disconnected/i);
  expect(screen.getByText(/command history \(0\)/i)).toBeVisible();
  expect(screen.getByRole("status", { name: "Multi-card scanning session" }))
    .toHaveTextContent("Ready to capture cards.");
});

it("connects the automatic simulator after the StrictMode effect replay", async () => {
  const user = userEvent.setup();
  render(<StrictMode><ScannerPage /></StrictMode>);

  await user.click(screen.getByRole("radio", { name: "Auto scanner (test)" }));
  await user.click(screen.getByRole("button", { name: "Connect simulator" }));

  expect(await screen.findByRole("status", { name: "Controller status" })).toHaveTextContent(/ready/i);
});

it("uses full single-card capture and review workspaces with an always-visible selected preview", async () => {
  vi.mocked(getScanCandidates).mockResolvedValue([candidate]);
  const user = userEvent.setup();
  render(<ScannerPage />);
  await screen.findByRole("combobox", { name: "Preferred set" });

  const captureWorkspace = screen.getByRole("region", {
    name: "Single-card scanner workspace",
  });
  expect(captureWorkspace).toHaveClass("scanner-primary-grid");
  expect(screen.getByRole("group", { name: "Scanning mode" })).toHaveClass("scanner-control-bar");
  expect(captureWorkspace).toContainElement(screen.getByTestId("scanner-session"));
  const preview = within(captureWorkspace).getByRole("complementary", {
    name: "Selected card preview",
  });
  expect(preview).toHaveTextContent("Capture a card to preview the exact printing here.");

  await user.click(screen.getByRole("button", { name: "Return OCR hints" }));
  expect(await within(preview).findByRole("img", { name: "Image unavailable for Black Lotus" }))
    .toBeVisible();
  expect(preview).toHaveTextContent("Limited Edition Alpha");
  expect(preview).toHaveTextContent("LEA · 233");

  const reviewWorkspace = screen.getByRole("region", {
    name: "Single-card review workspace",
  });
  expect(reviewWorkspace).toHaveClass("scanner-review-grid");
  expect(reviewWorkspace).toContainElement(screen.getByRole("heading", {
    name: "Choose the exact printing",
  }));
  expect(reviewWorkspace).toContainElement(screen.getByRole("region", {
    name: "Confirm collection details",
  }));
  expect(screen.getByRole("region", { name: "Single-card scanning session" }))
    .toHaveClass("scanner-session-strip");
});

it("composes one compact control region for single and multiple card scanning without hardware options", async () => {
  const user = userEvent.setup();
  render(<ScannerPage />);

  const singleControls = screen.getByRole("region", { name: "Scanner controls" });
  expect(within(singleControls).getByRole("group", { name: "Scanning mode" })).toBeVisible();
  expect(within(singleControls).getByLabelText("Game or brand")).toBeVisible();
  expect(within(singleControls).getByLabelText("Preferred set")).toBeVisible();
  expect(within(singleControls).getByRole("region", { name: "Single-card scanning session" }))
    .toHaveTextContent("No cards added in this session yet.");
  expect(screen.queryByText(/automated scanner|hardware/i)).not.toBeInTheDocument();

  await user.click(within(singleControls).getByRole("radio", { name: "Multiple cards (session)" }));

  const multipleControls = screen.getByRole("region", { name: "Scanner controls" });
  expect(within(multipleControls).getByRole("group", { name: "Scanning mode" })).toBeVisible();
  expect(within(multipleControls).getByLabelText("Game or brand")).toBeVisible();
  expect(within(multipleControls).getByLabelText("Preferred set")).toBeVisible();
  expect(within(multipleControls).getByRole("status", { name: "Multi-card scanning session" }))
    .toHaveTextContent("Ready to capture cards.");
  expect(screen.queryByText(/automated scanner|hardware/i)).not.toBeInTheDocument();
});

it("keeps the four-step progress strip hidden in both scan modes", async () => {
  const user = userEvent.setup();
  render(<ScannerPage />);

  expect(screen.queryByRole("list", { name: "Scan progress" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("radio", { name: "Multiple cards (session)" }));
  expect(screen.queryByRole("list", { name: "Scan progress" })).not.toBeInTheDocument();
});

it("prefers private AI title hints and keeps exact-printing confirmation", async () => {
  vi.mocked(recognizeCardPhoto).mockResolvedValue({
    name: "Voja, Jaws of the Conclave",
    titleCandidates: ["Voja, Jaws of the Conclave"],
    set: "sld",
    collector: "2284",
    rawText: "Voja, Jaws of the Conclave",
  });
  vi.mocked(getScanCandidates).mockImplementation(async (hints) =>
    hints.name === "Voja, Jaws of the Conclave" ? [vojaCandidate] : []
  );
  const user = userEvent.setup();
  render(<ScannerPage />);

  await user.click(screen.getByRole("button", { name: "Return private AI photo" }));

  expect(recognizeCardPhoto).toHaveBeenCalledWith(
    expect.any(Blob),
    expect.any(AbortSignal),
  );
  expect(getScanCandidates).toHaveBeenNthCalledWith(
    1,
    { name: "Voja, Jaws of the Conclave", set: "sld", collector: "2284" },
    expect.any(AbortSignal),
  );
  expect(await screen.findByRole("radio", { name: /voja.*sld.*2284/i })).toBeChecked();
  expect(screen.getByLabelText("Detected card title")).toHaveValue(
    "Voja, Jaws of the Conclave",
  );
  expect(screen.getByRole("button", { name: /confirm and add card/i })).toBeDisabled();
  expect(screen.getAllByText(/private WynterLabs server.*discarded immediately/i)).not.toHaveLength(0);
});

it("falls back to on-device title hints when private AI is unavailable", async () => {
  vi.mocked(recognizeCardPhoto).mockRejectedValue(new Error("AI unavailable"));
  vi.mocked(getScanCandidates).mockResolvedValue([]);
  const user = userEvent.setup();
  render(<ScannerPage />);

  await user.click(screen.getByRole("button", { name: "Return private AI photo" }));

  await waitFor(() => expect(getScanCandidates).toHaveBeenCalledWith(
    expect.objectContaining({ name: "11 Whenever Voja anaes, put X 41/01" }),
    expect.any(AbortSignal),
  ));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("requires explicit exact-printing confirmation before one collection mutation", async () => {
  vi.mocked(getScanCandidates).mockResolvedValue([candidate]);
  vi.mocked(addCollectionItem).mockResolvedValue({} as never);
  const user = userEvent.setup();
  render(<ScannerPage />);

  await user.click(screen.getByRole("button", { name: "Return OCR hints" }));
  expect(await screen.findAllByText("Limited Edition Alpha")).not.toHaveLength(0);
  expect(screen.getByRole("img", { name: "Your captured card" })).toHaveAttribute("src", "blob:card-photo");
  expect(getScanCandidates).toHaveBeenCalledWith(expect.objectContaining({ name: "Black Lotus" }), expect.any(AbortSignal));
  expect(addCollectionItem).not.toHaveBeenCalled();

  await user.click(screen.getByRole("radio", { name: /black lotus.*lea.*233/i }));
  const workspace = screen.getByRole("region", { name: "Single-card scanner workspace" });
  expect(workspace).toContainElement(screen.getByRole("img", { name: "Your captured card" }));
  expect(workspace).toHaveTextContent("Black Lotus");
  expect(workspace).toHaveTextContent("Limited Edition Alpha");
  expect(workspace).toHaveTextContent("233");
  expect(workspace).toHaveTextContent("EN");
  const save = screen.getByRole("button", { name: /confirm and add card/i });
  const confirmation = screen.getByRole("region", { name: "Confirm collection details" });
  expect(within(confirmation).getByRole("button", { name: /confirm and add card/i })).toBe(save);
  expect(save.closest(".scanner-confirm-actions")).not.toBeNull();
  expect(save).toBeDisabled();
  expect(addCollectionItem).not.toHaveBeenCalled();

  await user.selectOptions(screen.getByLabelText(/finish/i), "foil");
  await user.selectOptions(screen.getByLabelText(/condition/i), "lightly_played");
  await user.clear(screen.getByLabelText(/quantity/i));
  await user.type(screen.getByLabelText(/quantity/i), "2");
  await user.click(screen.getByRole("checkbox", { name: /confirm this exact printing/i }));
  await user.click(save);

  await waitFor(() => expect(addCollectionItem).toHaveBeenCalledWith({
    printing_id: "p1", finish: "foil", condition: "lightly_played", quantity: 2,
  }));
  expect(await screen.findByText(/added to your collection/i)).toBeInTheDocument();
});

it("keeps the photo while matching and clears old results on retake", async () => {
  let resolveCandidates!: (value: ScanCandidate[]) => void;
  vi.mocked(getScanCandidates).mockImplementation(() => new Promise((resolve) => {
    resolveCandidates = resolve;
  }));
  const user = userEvent.setup();
  render(<ScannerPage />);

  await user.click(screen.getByRole("button", { name: "Return OCR hints" }));
  expect(screen.getByRole("img", { name: "Your captured card" })).toHaveAttribute("src", "blob:card-photo");
  expect(screen.getByRole("status")).toHaveTextContent("Finding possible printings");
  resolveCandidates([candidate]);
  expect(await screen.findAllByText("Limited Edition Alpha")).not.toHaveLength(0);

  await user.click(screen.getByRole("button", { name: "Retake photo" }));
  expect(screen.queryByRole("img", { name: "Your captured card" })).not.toBeInTheDocument();
  expect(screen.queryByText("Limited Edition Alpha")).not.toBeInTheDocument();
  expect(screen.queryByRole("radio", { name: /black lotus/i })).not.toBeInTheDocument();
});


it("uses clear progress copy while local hints are being matched", async () => {
  vi.mocked(getScanCandidates).mockImplementation(() => new Promise(() => undefined));
  const user = userEvent.setup();
  render(<ScannerPage />);

  await user.click(screen.getByRole("button", { name: "Return OCR hints" }));

  expect(screen.getByRole("status")).toHaveTextContent("Finding possible printings…");
  expect(screen.getByRole("status")).not.toHaveTextContent("&");
});

it("adds consecutive cards with a fresh required confirmation each time", async () => {
  vi.mocked(getScanCandidates).mockResolvedValue([candidate]);
  vi.mocked(addCollectionItem).mockResolvedValue({} as never);
  const user = userEvent.setup();
  render(<ScannerPage />);

  await user.click(screen.getByRole("button", { name: "Return OCR hints" }));
  await user.click(await screen.findByRole("radio", { name: /black lotus.*lea.*233/i }));
  await user.clear(screen.getByLabelText(/quantity/i));
  await user.type(screen.getByLabelText(/quantity/i), "2");
  await user.click(screen.getByRole("checkbox", { name: /confirm this exact printing/i }));
  await user.click(screen.getByRole("button", { name: /confirm and add card/i }));

  expect(await screen.findByText(/1 card added this session/i)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /scan next card/i }));
  expect(screen.getByText("Scanner session 1")).toBeInTheDocument();
  expect(screen.queryByText("Limited Edition Alpha")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Return OCR hints" }));
  await user.click(await screen.findByRole("radio", { name: /black lotus.*lea.*233/i }));
  expect(screen.getByLabelText(/quantity/i)).toHaveValue(1);
  expect(screen.getByRole("button", { name: /confirm and add card/i })).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: /confirm this exact printing/i }));
  await user.click(screen.getByRole("button", { name: /confirm and add card/i }));

  await waitFor(() => expect(addCollectionItem).toHaveBeenCalledTimes(2));
  expect(addCollectionItem).toHaveBeenLastCalledWith({
    printing_id: "p1", finish: "nonfoil", condition: "near_mint", quantity: 1,
  });
  expect(await screen.findByText(/2 cards added this session/i)).toBeInTheDocument();
});

it("tries alternate local title readings until the catalog returns a match", async () => {
  vi.mocked(getScanCandidates).mockImplementation(async (hints) =>
    hints.name === "Voja, Jaws of the Conclave" ? [vojaCandidate] : []
  );
  const user = userEvent.setup();
  render(<ScannerPage />);

  await user.click(screen.getByRole("button", { name: "Return garbled OCR hints" }));

  expect(await screen.findByRole("radio", { name: /voja.*sld.*2284/i })).toBeChecked();
  expect(screen.getByRole("region", { name: "Confirm collection details" })).toBeVisible();
  expect(screen.getByRole("img", { name: "Your captured card" })).toHaveAttribute(
    "src",
    "blob:voja-photo",
  );
  expect(getScanCandidates).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ name: "Voja, Jaws of the Conciave" }),
    expect.any(AbortSignal),
  );
  expect(getScanCandidates).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ name: "Voja, Jaws of the Conclave" }),
    expect.any(AbortSignal),
  );
  expect(screen.getByRole("button", { name: /confirm and add card/i })).toBeDisabled();
});

it("aborts the whole alternate-title sequence when the scan is reset", async () => {
  let resolveAlternate!: (value: ScanCandidate[]) => void;
  let alternateSignal: AbortSignal | undefined;
  vi.mocked(getScanCandidates).mockImplementation(async (hints, signal) => {
    if (hints.name !== "Voja, Jaws of the Conclave") return [];
    alternateSignal = signal;
    return new Promise((resolve) => {
      resolveAlternate = resolve;
    });
  });
  const user = userEvent.setup();
  render(<ScannerPage />);

  await user.click(screen.getByRole("button", { name: "Return garbled OCR hints" }));
  await waitFor(() => expect(alternateSignal).toBeDefined());
  await user.click(screen.getByRole("button", { name: "Retake photo" }));

  expect(alternateSignal?.aborted).toBe(true);
  resolveAlternate([vojaCandidate]);
  await Promise.resolve();
  expect(screen.queryByRole("radio", { name: /voja.*sld.*2284/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("img", { name: "Your captured card" })).not.toBeInTheDocument();
});

it("keeps the photo and lets the member correct the detected title", async () => {
  vi.mocked(getScanCandidates).mockImplementation(async (hints) =>
    hints.name === "Voja, Jaws of the Conclave" ? [vojaCandidate] : []
  );
  const user = userEvent.setup();
  render(<ScannerPage />);

  await user.click(screen.getByRole("button", { name: "Return unmatched OCR hints" }));
  expect(await screen.findByRole("heading", { name: "No confident match found" })).toBeInTheDocument();
  const title = screen.getByRole("textbox", { name: "Detected card title" });
  expect(title).toHaveValue("Unreadable Card");
  expect(screen.getByRole("img", { name: "Your captured card" })).toHaveAttribute(
    "src",
    "blob:unmatched-photo",
  );

  await user.clear(title);
  await user.type(title, "   ");
  await user.click(screen.getByRole("button", { name: "Search title" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Enter a card title to search");

  await user.clear(title);
  await user.type(title, "Voja, Jaws of the Conclave");
  await user.click(screen.getByRole("button", { name: "Search title" }));

  expect(await screen.findByRole("radio", { name: /voja.*sld.*2284/i })).toBeInTheDocument();
  expect(getScanCandidates).toHaveBeenLastCalledWith(
    expect.objectContaining({ name: "Voja, Jaws of the Conclave" }),
    expect.any(AbortSignal),
  );
  await user.click(screen.getByRole("radio", { name: /voja.*sld.*2284/i }));
  expect(screen.getByRole("button", { name: /confirm and add card/i })).toBeDisabled();
});

it("rejects an unrelated fuzzy catalog result for the reported garbage OCR", async () => {
  vi.mocked(getScanCandidates).mockResolvedValue([aimBotCandidate]);
  const user = userEvent.setup();
  render(<ScannerPage />);

  await user.click(screen.getByRole("button", { name: "Return false-match OCR hints" }));

  expect(await screen.findByRole("heading", { name: "No confident match found" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Your captured card" })).toHaveAttribute(
    "src",
    "blob:false-match-photo",
  );
  expect(screen.getByRole("textbox", { name: "Detected card title" })).toHaveValue("i ro a \\ a A");
  expect(screen.queryByRole("radio", { name: /a\.i\.m\. bot/i })).not.toBeInTheDocument();
});

it("clears manual title correction when a scan is reset", async () => {
  vi.mocked(getScanCandidates).mockResolvedValue([]);
  const user = userEvent.setup();
  render(<ScannerPage />);

  await user.click(screen.getByRole("button", { name: "Return unmatched OCR hints" }));
  const title = await screen.findByRole("textbox", { name: "Detected card title" });
  await user.clear(title);
  await user.type(title, "Voja, Jaws of the Conclave");
  await user.click(screen.getByRole("button", { name: "Retake photo" }));

  expect(screen.queryByRole("textbox", { name: "Detected card title" })).not.toBeInTheDocument();
  expect(screen.queryByText("Voja, Jaws of the Conclave")).not.toBeInTheDocument();
});

it("shows all oracle printings and narrows them by set and collector", async () => {
  vi.mocked(getScanCandidates).mockResolvedValue([candidate]);
  vi.mocked(expandScanCandidates).mockResolvedValue([candidate, newerPrinting]);
  const user = userEvent.setup();
  render(<ScannerPage />);

  const preferredSet = screen.getByRole("combobox", { name: "Preferred set" });
  await screen.findByRole("option", { name: "Limited Edition Alpha (LEA)" });
  await user.selectOptions(preferredSet, "mtg:lea");
  await user.click(screen.getByRole("button", { name: "Return OCR hints" }));
  expect(await screen.findByRole("radio", { name: /black lotus.*lea.*233/i })).toBeVisible();
  expect(screen.getByRole("radio", { name: /black lotus.*cmm.*500/i })).toBeVisible();
  expect(screen.getByText(/showing 2 of 2 printings/i)).toBeVisible();
  expect(getScanCandidates).toHaveBeenCalledWith(
    {
      name: "Black Lotus",
      set: "lea",
      collector: "233",
      preferredSet: "LEA",
      preferredGame: "mtg",
      game: undefined,
    },
    expect.any(AbortSignal),
  );

  await user.selectOptions(screen.getByLabelText("Filter by set"), "CMM");
  expect(screen.queryByRole("radio", { name: /black lotus.*lea.*233/i })).not.toBeInTheDocument();
  expect(screen.getByRole("radio", { name: /black lotus.*cmm.*500/i })).toBeVisible();
  await user.type(screen.getByLabelText("Filter by collector number"), "999");
  expect(screen.getByText(/no printings match these filters/i)).toBeVisible();
});

it("shows authoritative collection totals and next actions after saving", async () => {
  vi.mocked(getScanCandidates).mockResolvedValue([candidate]);
  vi.mocked(addCollectionItem).mockResolvedValue({} as never);
  vi.mocked(getCollectionSummary).mockResolvedValue({
    total_copies: 127,
    distinct_items: 60,
    distinct_oracle_cards: 55,
    distinct_sets: 12,
    estimated_value_usd: "420.00",
    priced_copies: 120,
    unpriced_copies: 7,
    price_snapshot_at: null,
    finishes: [],
    conditions: [],
    sets: [],
  });
  const user = userEvent.setup();
  render(<ScannerPage />);

  await user.click(screen.getByRole("button", { name: "Return OCR hints" }));
  await user.click(await screen.findByRole("radio", { name: /black lotus.*lea.*233/i }));
  await user.click(screen.getByRole("checkbox", { name: /confirm this exact printing/i }));
  await user.click(screen.getByRole("button", { name: /confirm and add card/i }));

  const feedback = await screen.findByRole("status", { name: "Card added" });
  expect(feedback).toHaveTextContent("1 card added");
  expect(feedback).toHaveTextContent("127 total cards");
  expect(feedback).toContainElement(screen.getByRole("link", { name: "View collection" }));
  expect(getCollectionSummary).toHaveBeenCalledTimes(1);
});
