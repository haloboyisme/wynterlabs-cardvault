import { describe, expect, it } from "vitest";

import type { ScanCandidate } from "../lib/types";
import { filterConfidentScanCandidates } from "./title-confidence";

const candidate = (name: string, rankReason: ScanCandidate["rank_reason"] = "fuzzy_name") => ({
  printing_id: "printing",
  oracle_id: "oracle",
  name,
  mana_cost: null,
  type_line: "Creature",
  collector_number: "1",
  rarity: "rare",
  released_at: null,
  language: "en",
  layout: "normal",
  image_uris: {},
  prices: {},
  finishes: ["nonfoil"],
  colors: [],
  active: true,
  rank_reason: rankReason,
  set: {
    id: "set",
    code: "TST",
    name: "Test Set",
    set_type: "expansion",
    released_at: null,
    card_count: 1,
    digital: false,
    icon_svg_uri: null,
    game: 'mtg',  },
}) satisfies ScanCandidate;

describe("scanner title confidence", () => {
  it("rejects the reported weak A.I.M. Bot false match", () => {
    expect(filterConfidentScanCandidates("i ro a \\ a A", [candidate("A.I.M. Bot")])).toEqual([]);
  });

  it("keeps a close OCR misspelling and exact title", () => {
    const voja = candidate("Voja, Jaws of the Conclave");
    expect(filterConfidentScanCandidates("Voja, Jaws of the Conciave", [voja])).toEqual([voja]);
    expect(filterConfidentScanCandidates("Voja, Jaws of the Conclave", [voja])).toEqual([voja]);
  });
});
