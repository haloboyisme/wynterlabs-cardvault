import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CardDetailPage } from "./CardDetailPage";

const cardSet = { id: "set-id", code: "mid", name: "Innistrad: Midnight Hunt", set_type: "expansion", released_at: "2021-09-24", card_count: 277, digital: false, icon_svg_uri: null, game: 'mtg' };
const detail = {
  printing_id: "p1", oracle_id: "o1", name: "Arlinn, the Pack's Hope // Arlinn, the Moon's Fury",
  mana_cost: "{2}{R}{G}", type_line: "Legendary Planeswalker", set: cardSet,
  collector_number: "211", rarity: "mythic", released_at: "2021-09-24", language: "en",
  layout: "transform", image_uris: {}, prices: { usd: "4.25", usd_foil: "5.90" },
  finishes: ["nonfoil", "foil"], colors: ["R", "G"], oracle_text: null, cmc: 4,
  color_identity: ["R", "G"], keywords: ["Daybound"], legalities: { commander: "legal", standard: "not_legal" },
  artist: "Anna Steinbauer", digital: false, promo: false, frame: "2015", border_color: "black",
  image_status: "highres_scan", source_uri: "https://scryfall.com/card/mid/211", price_snapshot_at: "2026-08-12T21:05:44Z", games: ["paper"],
  faces: [
    { face_index: 0, name: "Arlinn, the Pack's Hope", mana_cost: "{2}{R}{G}", type_line: "Legendary Planeswalker", oracle_text: "Daybound", colors: ["R", "G"], image_uris: { normal: "https://cards.scryfall.io/front.jpg" }, artist: "Anna Steinbauer" },
    { face_index: 1, name: "Arlinn, the Moon's Fury", mana_cost: null, type_line: "Legendary Planeswalker", oracle_text: "Nightbound", colors: ["R", "G"], image_uris: { normal: "https://cards.scryfall.io/back.jpg" }, artist: "Anna Steinbauer" },
  ],
};
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/printings")
  ? json({ items: [detail], page: 1, page_size: 50, total: 1, pages: 1 })
  : json(detail))));
afterEach(() => vi.unstubAllGlobals());

it("renders double-faced rules, printing metadata, legalities, and informational prices", async () => {
  render(<MemoryRouter initialEntries={["/cards/p1"]}><Routes><Route path="/cards/:printingId" element={<CardDetailPage />} /></Routes></MemoryRouter>);
  expect(await screen.findByRole("heading", { name: detail.name })).toBeVisible();
  expect(screen.getByText(/collector 211/i)).toBeVisible();
  expect(screen.getByText(/anna steinbauer/i)).toBeVisible();
  expect(screen.getAllByText("Daybound")).toHaveLength(2);
  expect(screen.getByText("Nightbound")).toBeVisible();
  expect(screen.getByRole("img", { name: /pack's hope card/i })).toBeVisible();
  expect(screen.getByRole("img", { name: /moon's fury card/i })).toBeVisible();
  expect(screen.getByText(/commander/i)).toBeVisible();
  expect(screen.getByText(/not legal/i)).toBeVisible();
  expect(screen.getAllByText(/nonfoil/i).length).toBeGreaterThan(0);
  expect(screen.getByText(/prices are informational/i)).toBeVisible();
  expect(screen.getByText("$4.25")).toBeVisible();
  expect(screen.getByRole("heading", { name: /find this printing/i })).toBeVisible();
  expect(screen.getByText(/wynterlabs does not handle the sale/i)).toBeVisible();
  expect(screen.getByRole("link", { name: /search tcgplayer/i })).toHaveAttribute("target", "_blank");
  expect(screen.getByRole("link", { name: /search ebay/i })).toHaveAttribute("rel", "noreferrer");
  expect(screen.getByLabelText("Printing")).toBeVisible();
  expect(screen.getByText("Mana value").parentElement).toHaveTextContent("4");
  expect(screen.getByText("Color identity").parentElement).toHaveTextContent("R, G");
  expect(screen.getByText("Keywords").parentElement).toHaveTextContent("Daybound");
  expect(screen.getByText("Digital").parentElement).toHaveTextContent("No");
  expect(screen.getByText("Promo").parentElement).toHaveTextContent("No");
  expect(screen.getByText("Frame").parentElement).toHaveTextContent("2015");
  expect(screen.getByText("Border color").parentElement).toHaveTextContent("black");
  expect(screen.getByText("Image status").parentElement).toHaveTextContent("highres scan");
  expect(screen.getByText("Games").parentElement).toHaveTextContent("paper");
  expect(screen.getByRole("link", { name: /view source record/i })).toHaveAttribute("href", detail.source_uri);
  expect(screen.getByText("Price captured").parentElement).toHaveTextContent("2026");
  expect(screen.getByText("Finishes").parentElement).toHaveTextContent("nonfoil, foil");
  expect(screen.getByRole("list", { name: /format legalities/i })).toBeVisible();
  expect(screen.getByText("commander").closest("li")).toHaveAttribute("data-legality", "legal");
  expect(screen.getByText("standard").closest("li")).toHaveAttribute("data-legality", "not-legal");
  expect(screen.getByRole("link", { name: /card data provided by scryfall/i })).toBeVisible();
  expect(screen.getByText(/unofficial fan content/i)).toBeVisible();
});
it("replaces a failed detail image and recovers when the printing source changes", async () => {
  const updatedFaces = detail.faces.map((face) => ({
    ...face,
    image_uris: { normal: `https://cards.scryfall.io/updated-${face.face_index}.jpg` },
  }));
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/cards/p2")) return json({ ...detail, printing_id: "p2", faces: updatedFaces });
    if (url.includes("/printings")) return json({ items: [detail, { ...detail, printing_id: "p2" }], page: 1, page_size: 50, total: 2, pages: 1 });
    return json(detail);
  });
  render(<MemoryRouter initialEntries={["/cards/p1"]}><Routes><Route path="/cards/:printingId" element={<CardDetailPage />} /></Routes></MemoryRouter>);
  const image = await screen.findByRole("img", { name: /pack's hope card/i });
  fireEvent.error(image);
  expect(screen.getByText(/image unavailable for arlinn, the pack's hope/i)).toBeVisible();
  fireEvent.change(screen.getByLabelText("Printing"), { target: { value: "p2" } });
  await waitFor(() => expect(screen.getByRole("img", { name: /pack's hope card/i })).toHaveAttribute(
    "src",
    "/api/v1/catalog/media?source=https%3A%2F%2Fcards.scryfall.io%2Fupdated-0.jpg",
  ));
});
it("does not link an untrusted source URI", async () => {
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => String(input).includes("/printings")
    ? json({ items: [detail], page: 1, page_size: 50, total: 1, pages: 1 })
    : json({ ...detail, source_uri: "https://scryfall.com.evil.test/card" }));
  render(<MemoryRouter initialEntries={["/cards/p1"]}><Routes><Route path="/cards/:printingId" element={<CardDetailPage />} /></Routes></MemoryRouter>);
  expect(await screen.findByText(/source record unavailable/i)).toBeVisible();
  expect(screen.queryByRole("link", { name: /view source record/i })).not.toBeInTheDocument();
});

it("navigates to a selected printing", async () => {
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => String(input).includes("/printings")
    ? json({ items: [detail, { ...detail, printing_id: "p2", set: { ...cardSet, name: "Double Masters" } }], page: 1, page_size: 50, total: 2, pages: 1 })
    : json(detail));
  render(<MemoryRouter initialEntries={["/cards/p1"]}><Routes><Route path="/cards/:printingId" element={<CardDetailPage />} /></Routes></MemoryRouter>);
  const selector = await screen.findByLabelText("Printing");
  await screen.findByRole("option", { name: /double masters/i });
  fireEvent.change(selector, { target: { value: "p2" } });
  await waitFor(() => {
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes("/cards/p2"))).toBe(true);
  });
});

it("shows an API error", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: { code: "card_not_found", message: "Card printing was not found." } }), { status: 404, headers: { "content-type": "application/json" } }));
  render(<MemoryRouter initialEntries={["/cards/missing"]}><Routes><Route path="/cards/:printingId" element={<CardDetailPage />} /></Routes></MemoryRouter>);
  expect(await screen.findByRole("alert")).toHaveTextContent(/card printing was not found/i);
});
it("keeps the selected printing represented and resets pagination after navigation", async () => {
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/cards/p2")) return json({ ...detail, printing_id: "p2", oracle_id: "o2", name: "Second printing" });
    if (url.includes("/oracle/o2/printings")) return json({ items: [{ ...detail, printing_id: "p2", oracle_id: "o2", name: "Second printing" }], page: 1, page_size: 50, total: 1, pages: 1 });
    if (url.includes("/printings") && url.includes("page=2")) return json({ items: [{ ...detail, printing_id: "p2" }], page: 2, page_size: 50, total: 51, pages: 2 });
    if (url.includes("/printings")) return json({ items: [detail], page: 1, page_size: 50, total: 51, pages: 2 });
    return json(detail);
  });
  render(<MemoryRouter initialEntries={["/cards/p1"]}><Routes><Route path="/cards/:printingId" element={<CardDetailPage />} /></Routes></MemoryRouter>);
  const next = await screen.findByRole("button", { name: /next printings/i });
  fireEvent.click(next);
  await screen.findByText(/page 2 of 2/i);
  expect(screen.getByLabelText("Printing")).toHaveValue("p1");
  fireEvent.change(screen.getByLabelText("Printing"), { target: { value: "p2" } });
  expect(await screen.findByRole("heading", { name: "Second printing" })).toBeVisible();
  expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes("/oracle/o2/printings?page=1"))).toBe(true);
  expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes("/oracle/o2/printings?page=2"))).toBe(false);
});

function RaceControls() {
  const navigate = useNavigate();
  return <><button onClick={() => navigate("/cards/p2")}>P2</button><button onClick={() => navigate("/cards/p3")}>P3</button></>;
}

it("cancels superseded detail requests without showing a false error", async () => {
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/cards/p2")) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    }
    if (url.includes("/cards/p3")) return json({ ...detail, printing_id: "p3", oracle_id: "o3", name: "Third printing" });
    if (url.includes("/printings")) return json({ items: [detail], page: 1, page_size: 50, total: 1, pages: 1 });
    return json(detail);
  });
  render(<MemoryRouter initialEntries={["/cards/p1"]}><RaceControls /><Routes><Route path="/cards/:printingId" element={<CardDetailPage />} /></Routes></MemoryRouter>);
  await screen.findByRole("heading", { name: detail.name });
  fireEvent.click(screen.getByRole("button", { name: "P2" }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes("/cards/p2"))).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "P3" }));
  expect(await screen.findByRole("heading", { name: "Third printing" })).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("adds the exact printing to the private collection with controlled fields", async () => {
  render(<MemoryRouter initialEntries={["/cards/p1"]}><Routes><Route path="/cards/:printingId" element={<CardDetailPage />} /></Routes></MemoryRouter>);
  await screen.findByRole("heading", { name: detail.name });
  fireEvent.change(screen.getByLabelText(/collection finish/i), { target: { value: "foil" } });
  fireEvent.change(screen.getByLabelText(/collection condition/i), { target: { value: "lightly_played" } });
  fireEvent.change(screen.getByLabelText(/collection quantity/i), { target: { value: "4" } });
  fireEvent.click(screen.getByRole("button", { name: /add to collection/i }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input, init]) =>
    String(input).endsWith("/api/v1/collection/items") && init?.method === "POST" &&
    String(init.body).includes('"printing_id":"p1"') && String(init.body).includes('"finish":"foil"') &&
    String(init.body).includes('"condition":"lightly_played"') && String(init.body).includes('"quantity":4'),
  )).toBe(true));
  expect(await screen.findByRole("status")).toHaveTextContent(/added.*collection/i);
  expect(screen.getByLabelText(/collection quantity/i)).toHaveValue(1);
});

it("resets the add form and submits the newly selected exact printing", async () => {
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.method === "POST") return json({});
    if (url.includes("/cards/p2")) return json({ ...detail, printing_id: "p2", oracle_id: "o2", name: "Second printing", finishes: ["etched"] });
    if (url.includes("/oracle/o2/printings")) return json({ items: [{ ...detail, printing_id: "p2", oracle_id: "o2", name: "Second printing", finishes: ["etched"] }], page: 1, page_size: 50, total: 1, pages: 1 });
    if (url.includes("/printings")) return json({ items: [detail, { ...detail, printing_id: "p2" }], page: 1, page_size: 50, total: 2, pages: 1 });
    return json(detail);
  });
  render(<MemoryRouter initialEntries={["/cards/p1"]}><Routes><Route path="/cards/:printingId" element={<CardDetailPage />} /></Routes></MemoryRouter>);
  await screen.findByRole("heading", { name: detail.name });
  fireEvent.change(screen.getByLabelText(/collection finish/i), { target: { value: "foil" } });
  fireEvent.change(screen.getByLabelText(/collection quantity/i), { target: { value: "9" } });
  await waitFor(() => expect(document.querySelector('option[value="p2"]')).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText("Printing"), { target: { value: "p2" } });
  expect(await screen.findByRole("heading", { name: "Second printing" })).toBeVisible();
  expect(screen.getByLabelText(/collection finish/i)).toHaveValue("etched");
  expect(screen.getByLabelText(/collection quantity/i)).toHaveValue(1);
  fireEvent.click(screen.getByRole("button", { name: /add to collection/i }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input, init]) =>
    String(input).endsWith("/api/v1/collection/items") && init?.method === "POST" &&
    String(init.body).includes('"printing_id":"p2"') && String(init.body).includes('"finish":"etched"'),
  )).toBe(true));
});
