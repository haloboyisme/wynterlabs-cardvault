import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { expandScanCandidates, getScanCandidates } from "../lib/catalog";
import { addCollectionItem, getCollectionSummary } from "../lib/collection";
import { recognizeCardPhoto } from "../lib/scanner";
import type { ScanCandidate } from "../lib/types";
import { MultiScanSession } from "./MultiScanSession";

vi.mock("./CardScanner", () => ({
  CardScanner: ({ onResult, onReset, captureCount, topControls, automaticCountdownSeconds }: {
    onResult: (value: object) => void;
    onReset?: () => void;
    captureCount: number;
    topControls?: ReactNode;
    automaticCountdownSeconds?: number;
  }) => <section aria-label="Continuous camera mock">
    <section aria-label="Scanner controls">{topControls}</section>
    <span>Captured {captureCount}</span>
    <span>Automatic countdown {automaticCountdownSeconds}</span>
    <button onClick={() => onResult({
      hints: { name: "Black Lotus", titleCandidates: ["Black Lotus"], rawText: "Black Lotus" },
      previewUrl: `blob:card-${captureCount + 1}`,
      imageBlob: new Blob([`card-${captureCount + 1}`]),
    })}>Capture test card</button>
    <button onClick={() => onReset?.()}>Stop scanning</button>
  </section>,
}));
vi.mock("../lib/catalog", () => ({
  expandScanCandidates: vi.fn(),
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
  released_at: "1993-08-05", language: "en", layout: "normal",
  image_uris: { normal: "https://cards.scryfall.io/normal/front/a/b/black-lotus.jpg" },
  prices: { usd: "123.45", usd_foil: "250.00", usd_etched: null },
  finishes: ["nonfoil", "foil"], colors: [], active: true,
  rank_reason: "exact_printing",
  set: { id: "s1", code: "LEA", name: "Limited Edition Alpha", set_type: "core", released_at: "1993-08-05", card_count: 295, digital: false, icon_svg_uri: null, game: 'mtg' },
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
  localStorage.clear();
});

beforeEach(() => {
  localStorage.clear();
  vi.mocked(expandScanCandidates).mockImplementation(async (seeds) => seeds);
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
});

it("keeps a left-to-right session, supports correction, and saves only confirmed printings", async () => {
  vi.mocked(recognizeCardPhoto).mockResolvedValue({
    name: "Black Lotus", titleCandidates: ["Black Lotus"], rawText: "Black Lotus",
  });
  vi.mocked(getScanCandidates).mockResolvedValue([candidate]);
  vi.mocked(addCollectionItem).mockResolvedValue({} as never);
  const user = userEvent.setup();
  render(<MultiScanSession />);

  await user.click(screen.getByRole("button", { name: "Capture test card" }));
  await waitFor(() => expect(screen.getByRole("list", { name: "Cards captured this session" }))
    .toHaveTextContent("Black Lotus"));
  await user.click(screen.getByRole("button", { name: "Capture test card" }));
  expect(screen.getAllByRole("listitem")).toHaveLength(2);

  await user.click(screen.getByRole("button", { name: /card 1.*black lotus/i }));
  await user.click(screen.getByRole("radio", { name: /black lotus.*lea.*233/i }));
  await user.selectOptions(screen.getByLabelText("Finish"), "foil");
  await user.click(screen.getByRole("checkbox", { name: /confirm this exact printing/i }));
  await user.click(screen.getByRole("button", { name: "Add confirmed cards" }));

  await waitFor(() => expect(addCollectionItem).toHaveBeenCalledTimes(1));
  expect(addCollectionItem).toHaveBeenCalledWith({
    printing_id: "p1", finish: "foil", condition: "near_mint", quantity: 1,
  });
  const remainingSession = screen.getByRole("list", { name: "Cards captured this session" });
  expect(within(remainingSession).getAllByRole("listitem")).toHaveLength(1);
  expect(within(remainingSession).getByRole("button", {
    name: /card 1.*black lotus.*review/i,
  })).toBeVisible();
  expect(within(remainingSession).queryByText("saved")).not.toBeInTheDocument();
  expect(screen.getByText("1 card added to your collection.")).toHaveAttribute("role", "status");
  const feedback = screen.getByRole("status", { name: "Cards added" });
  expect(feedback).toHaveTextContent("127 total cards");
  expect(feedback).toContainElement(screen.getByRole("link", { name: "View collection" }));
  expect(feedback).toContainElement(screen.getByRole("link", { name: "Scan more cards" }));
  expect(screen.getByRole("link", { name: "Scan more cards" })).toHaveAttribute("href", "/scan");

  await user.clear(screen.getByLabelText("Search title"));
  await user.type(screen.getByLabelText("Search title"), "Mox Pearl");
  await user.click(screen.getByRole("button", { name: "Search this title" }));
  await waitFor(() => expect(getScanCandidates).toHaveBeenLastCalledWith(
    expect.objectContaining({ name: "Mox Pearl" }),
    expect.any(AbortSignal),
  ));
});

it("keeps supplied workspace controls with the live multi-card session status", () => {
  render(<MultiScanSession topControls={<fieldset><legend>Scanning mode</legend><span>Mode controls</span></fieldset>} />);

  const controls = screen.getByRole("region", { name: "Scanner controls" });
  expect(within(controls).getByRole("group", { name: "Scanning mode" })).toHaveTextContent("Mode controls");
  expect(within(controls).getByRole("status", { name: "Multi-card scanning session" }))
    .toHaveTextContent("Ready to capture cards.");
});

it("lets the member change the automatic capture countdown for this browser", async () => {
  const user = userEvent.setup();
  render(<MultiScanSession />);

  const countdown = screen.getByLabelText("Capture countdown");
  expect(countdown).toHaveValue("5");
  expect(screen.getByText("Automatic countdown 5")).toBeVisible();

  await user.selectOptions(countdown, "8");

  expect(countdown).toHaveValue("8");
  expect(screen.getByText("Automatic countdown 8")).toBeVisible();
  expect(localStorage.getItem("wynterlabs.cardvault.multi-scan.countdown.v1")).toBe("8");
  expect(screen.getByRole("status", { name: "Capture countdown saved" }))
    .toHaveTextContent("Cards will capture after an 8-second countdown.");
});

it("confirms every scanned card from the selected card's collection details", async () => {
  vi.mocked(recognizeCardPhoto).mockResolvedValue({
    name: "Black Lotus", titleCandidates: ["Black Lotus"], rawText: "Black Lotus",
  });
  vi.mocked(getScanCandidates).mockResolvedValue([candidate]);
  vi.mocked(addCollectionItem).mockResolvedValue({} as never);
  const user = userEvent.setup();
  render(<MultiScanSession />);

  await user.click(screen.getByRole("button", { name: "Capture test card" }));
  await user.click(screen.getByRole("button", { name: "Capture test card" }));
  await waitFor(() => expect(screen.getAllByText("review")).toHaveLength(2));
  await user.click(screen.getByRole("button", { name: /card 1.*black lotus/i }));
  await user.click(screen.getByRole("radio", { name: /black lotus.*lea.*233/i }));
  await user.click(screen.getByRole("button", { name: /card 2.*black lotus/i }));
  await user.click(screen.getByRole("radio", { name: /black lotus.*lea.*233/i }));

  const collectionDetails = screen.getByRole("group", { name: "Confirm collection details" });
  const confirmAll = within(collectionDetails).getByRole("checkbox", {
    name: "Confirm all scanned cards in this session",
  });
  expect(confirmAll).not.toBeChecked();
  await user.click(confirmAll);

  expect(confirmAll).toBeChecked();
  expect(screen.getByText("2 of 2 scanned cards confirmed.")).toHaveAttribute("role", "status");
  expect(screen.getByRole("checkbox", { name: /confirm this exact printing/i })).toBeChecked();

  await user.click(screen.getByRole("button", { name: "Add confirmed cards" }));
  await waitFor(() => expect(addCollectionItem).toHaveBeenCalledTimes(2));
});

it("replaces only the selected thumbnail on retake and keeps prior cards", async () => {
  vi.mocked(recognizeCardPhoto).mockResolvedValue({
    name: "Black Lotus", titleCandidates: ["Black Lotus"], rawText: "Black Lotus",
  });
  vi.mocked(getScanCandidates).mockResolvedValue([candidate]);
  const user = userEvent.setup();
  render(<MultiScanSession />);
  await user.click(screen.getByRole("button", { name: "Capture test card" }));
  await screen.findByRole("radio", { name: /black lotus.*lea.*233/i });
  await user.click(screen.getByRole("button", { name: "Retake selected card" }));
  expect(screen.getByText("Show the replacement card, then capture it."))
    .toHaveAttribute("role", "status");
  await user.click(screen.getByRole("button", { name: "Capture test card" }));
  await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
  expect(screen.getByRole("img", { name: "Captured card 1" })).toHaveAttribute("src", "blob:card-2");
});

it("falls back to the captured local title when private recognition is unavailable", async () => {
  vi.mocked(recognizeCardPhoto).mockRejectedValueOnce(new Error("Recognition unavailable"));
  vi.mocked(getScanCandidates).mockResolvedValue([candidate]);
  const user = userEvent.setup();
  render(<MultiScanSession />);
  await user.click(screen.getByRole("button", { name: "Capture test card" }));
  expect(await screen.findByRole("radio", { name: /black lotus.*lea.*233/i })).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("preselects the unique printing found by private title, set, and collector hints", async () => {
  vi.mocked(recognizeCardPhoto).mockResolvedValue({
    name: "Black Lotus",
    titleCandidates: ["Black Lotus"],
    set: "lea",
    collector: "233",
    rawText: "Black Lotus\nLEA 233",
  });
  vi.mocked(getScanCandidates).mockResolvedValue([candidate]);
  vi.mocked(expandScanCandidates).mockResolvedValue([candidate, newerPrinting]);
  const user = userEvent.setup();
  render(<MultiScanSession />);

  await user.click(screen.getByRole("button", { name: "Capture test card" }));

  expect(getScanCandidates).toHaveBeenCalledWith(
    { name: "Black Lotus", set: "lea", collector: "233" },
    expect.any(AbortSignal),
  );
  expect(await screen.findByRole("radio", { name: /black lotus.*lea.*233/i }))
    .toBeChecked();
  expect(screen.getByRole("checkbox", { name: /confirm this exact printing/i }))
    .not.toBeChecked();
});

it("uses a preferred set to lead while keeping other sets available for correction", async () => {
  vi.mocked(recognizeCardPhoto).mockResolvedValue({
    name: "Black Lotus", titleCandidates: ["Black Lotus"], rawText: "Black Lotus",
  });
  vi.mocked(getScanCandidates).mockResolvedValue([candidate]);
  vi.mocked(expandScanCandidates).mockResolvedValue([candidate, newerPrinting]);
  const user = userEvent.setup();
  render(<MultiScanSession preferredSet="CMM" />);

  await user.click(screen.getByRole("button", { name: "Capture test card" }));

  expect(getScanCandidates).toHaveBeenCalledWith(
    { name: "Black Lotus", set: undefined, collector: undefined, preferredSet: "CMM" },
    expect.any(AbortSignal),
  );
  expect(await screen.findByRole("radio", { name: /black lotus.*cmm.*500/i }))
    .toBeChecked();
  expect(screen.getByRole("radio", { name: /black lotus.*lea.*233/i })).toBeVisible();
});

it("forwards the selected game to multi-scan candidate searches", async () => {
  vi.mocked(recognizeCardPhoto).mockResolvedValue({
    name: "Black Lotus", titleCandidates: ["Black Lotus"], rawText: "Black Lotus",
  });
  vi.mocked(getScanCandidates).mockResolvedValue([candidate]);
  const user = userEvent.setup();
  render(<MultiScanSession preferredGame="pokemon" />);

  await user.click(screen.getByRole("button", { name: "Capture test card" }));

  await waitFor(() => expect(getScanCandidates).toHaveBeenCalledWith(
    {
      name: "Black Lotus",
      set: undefined,
      collector: undefined,
      preferredSet: undefined,
      game: "pokemon",
    },
    expect.any(AbortSignal),
  ));
  await waitFor(() => expect(expandScanCandidates).toHaveBeenCalledWith(
    [candidate],
    expect.any(AbortSignal),
    "pokemon",
  ));
});

it("previews the exact selected printing beside the active scanner", async () => {
  vi.mocked(recognizeCardPhoto).mockResolvedValue({
    name: "Black Lotus",
    titleCandidates: ["Black Lotus"],
    set: "lea",
    collector: "233",
    rawText: "Black Lotus\nLEA 233",
  });
  vi.mocked(getScanCandidates).mockResolvedValue([candidate]);
  vi.mocked(expandScanCandidates).mockResolvedValue([candidate, newerPrinting]);
  const user = userEvent.setup();
  render(<MultiScanSession />);

  const workspace = screen.getByRole("region", { name: "Scanner workspace" });
  expect(workspace).toHaveClass("scanner-primary-grid");
  expect(within(workspace).getByRole("region", { name: "Continuous camera mock" }))
    .toBeVisible();
  const preview = within(workspace).getByRole("complementary", {
    name: "Selected card preview",
  });
  expect(preview).toHaveTextContent("Capture a card to see the selected printing here.");

  await user.click(screen.getByRole("button", { name: "Capture test card" }));

  expect(screen.getByRole("list", { name: "Cards captured this session" }))
    .toHaveClass("scanner-session-strip");

  expect(await within(preview).findByRole("img", { name: "Black Lotus card" }))
    .toBeVisible();
  expect(preview).toHaveTextContent("Limited Edition Alpha");
  expect(preview).toHaveTextContent("LEA · 233");
  const reviewWorkspace = screen.getByRole("region", {
    name: "Multi-card review workspace",
  });
  expect(reviewWorkspace).toHaveClass("scanner-review-grid");
  expect(reviewWorkspace).toContainElement(screen.getByRole("heading", {
    name: "Fix or confirm selected card",
  }));
  expect(reviewWorkspace).toContainElement(screen.getByRole("group", {
    name: "Confirm collection details",
  }));

  await user.click(screen.getByRole("radio", { name: /black lotus.*cmm.*500/i }));
  expect(preview).toHaveTextContent("Commander Masters");
  expect(preview).toHaveTextContent("CMM · 500");
});

it("announces when one confident session printing is preselected", async () => {
  vi.mocked(recognizeCardPhoto).mockResolvedValue({
    name: "Black Lotus", titleCandidates: ["Black Lotus"], rawText: "Black Lotus",
  });
  vi.mocked(getScanCandidates).mockResolvedValue([candidate]);
  const user = userEvent.setup();
  render(<MultiScanSession />);

  await user.click(screen.getByRole("button", { name: "Capture test card" }));

  expect(await screen.findByRole("status", { name: "Printing match result" }))
    .toHaveTextContent(/1 confident printing found and preselected/i);
  expect(screen.getByRole("radio", { name: /black lotus.*lea.*233/i })).toBeChecked();
});

it("uses the selected finish for the preview price", async () => {
  vi.mocked(recognizeCardPhoto).mockResolvedValue({
    name: "Black Lotus",
    titleCandidates: ["Black Lotus"],
    set: "lea",
    collector: "233",
    rawText: "Black Lotus\nLEA 233",
  });
  vi.mocked(getScanCandidates).mockResolvedValue([candidate]);
  const user = userEvent.setup();
  render(<MultiScanSession />);

  await user.click(screen.getByRole("button", { name: "Capture test card" }));

  const preview = screen.getByRole("complementary", { name: "Selected card preview" });
  const price = await within(preview).findByRole("status", { name: "Selected card price" });
  expect(within(price).getByText("$123.45")).toBeVisible();
  await user.selectOptions(screen.getByLabelText("Finish"), "foil");
  expect(within(price).getByText("$250.00")).toBeVisible();
  expect(preview).toHaveTextContent("Informational price");
});

it("shows when the selected printing has no current preview price", async () => {
  const unpricedCandidate = { ...candidate, prices: {} };
  vi.mocked(recognizeCardPhoto).mockResolvedValue({
    name: "Black Lotus",
    titleCandidates: ["Black Lotus"],
    set: "lea",
    collector: "233",
    rawText: "Black Lotus\nLEA 233",
  });
  vi.mocked(getScanCandidates).mockResolvedValue([unpricedCandidate]);
  const user = userEvent.setup();
  render(<MultiScanSession />);

  await user.click(screen.getByRole("button", { name: "Capture test card" }));

  const preview = screen.getByRole("complementary", { name: "Selected card preview" });
  expect(await within(preview).findByText("Price unavailable")).toBeVisible();
});

it("retains a failed card and retries only that item", async () => {
  vi.mocked(recognizeCardPhoto).mockResolvedValue({
    name: "Black Lotus", titleCandidates: ["Black Lotus"], rawText: "Black Lotus",
  });
  vi.mocked(getScanCandidates).mockRejectedValueOnce(new Error("Catalog unavailable"));
  const user = userEvent.setup();
  render(<MultiScanSession />);
  await user.click(screen.getByRole("button", { name: "Capture test card" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Catalog unavailable");
  vi.mocked(recognizeCardPhoto).mockResolvedValue({
    name: "Black Lotus", titleCandidates: ["Black Lotus"], rawText: "Black Lotus",
  });
  vi.mocked(getScanCandidates).mockResolvedValue([candidate]);
  await user.click(screen.getByRole("button", { name: "Retry recognition" }));
  expect(await screen.findByRole("radio", { name: /black lotus.*lea.*233/i })).toBeVisible();
});

it("shows every printing and filters the selected session card by set or collector", async () => {
  vi.mocked(recognizeCardPhoto).mockResolvedValue({
    name: "Black Lotus", titleCandidates: ["Black Lotus"], rawText: "Black Lotus",
  });
  vi.mocked(getScanCandidates).mockResolvedValue([candidate]);
  vi.mocked(expandScanCandidates).mockResolvedValue([candidate, newerPrinting]);
  const user = userEvent.setup();
  render(<MultiScanSession />);

  await user.click(screen.getByRole("button", { name: "Capture test card" }));
  expect(await screen.findByRole("radio", { name: /black lotus.*lea.*233/i })).toBeChecked();
  expect(screen.getByRole("radio", { name: /black lotus.*cmm.*500/i })).toBeVisible();
  await user.click(screen.getByRole("radio", { name: /black lotus.*lea.*233/i }));
  expect(screen.getByRole("group", { name: "Confirm collection details" })).toBeVisible();
  expect(screen.getByText(/showing 2 of 2 printings/i)).toBeVisible();
  await user.click(screen.getByRole("radio", { name: /black lotus.*cmm.*500/i }));
  expect(screen.getByRole("radio", { name: /black lotus.*cmm.*500/i })).toBeChecked();
  await user.selectOptions(screen.getByLabelText("Filter by set"), "CMM");
  expect(screen.queryByRole("radio", { name: /black lotus.*lea.*233/i })).not.toBeInTheDocument();
  expect(screen.getByRole("radio", { name: /black lotus.*cmm.*500/i })).toBeVisible();
});

it("prevents a rapid second save pass while confirmed cards are being added", async () => {
  vi.mocked(recognizeCardPhoto).mockResolvedValue({
    name: "Black Lotus", titleCandidates: ["Black Lotus"], rawText: "Black Lotus",
  });
  vi.mocked(getScanCandidates).mockResolvedValue([candidate]);
  let finishSave!: () => void;
  let firstSave = true;
  vi.mocked(addCollectionItem).mockImplementation(() => {
    if (!firstSave) return Promise.resolve({} as never);
    firstSave = false;
    return new Promise((resolve) => {
      finishSave = () => resolve({} as never);
    });
  });
  const user = userEvent.setup();
  render(<MultiScanSession />);

  await user.click(screen.getByRole("button", { name: "Capture test card" }));
  await user.click(await screen.findByRole("radio", { name: /black lotus.*lea.*233/i }));
  await user.click(screen.getByRole("checkbox", { name: /confirm this exact printing/i }));
  await user.click(screen.getByRole("button", { name: "Capture test card" }));
  await user.click(await screen.findByRole("radio", { name: /black lotus.*lea.*233/i }));
  await user.click(screen.getByRole("checkbox", { name: /confirm this exact printing/i }));

  expect(within(screen.getByRole("group", { name: "Confirm collection details" }))
    .getByRole("button", { name: "Add confirmed cards" })).toBeVisible();
  const save = screen.getByRole("button", { name: "Add confirmed cards" });
  fireEvent.click(save);
  fireEvent.click(save);
  await waitFor(() => expect(addCollectionItem).toHaveBeenCalledTimes(1));
  expect(save).toBeDisabled();
  await act(async () => finishSave());
  await waitFor(() => expect(addCollectionItem).toHaveBeenCalledTimes(2));
});
