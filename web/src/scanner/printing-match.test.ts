import { describe, expect, it } from "vitest";

import type { ScanCandidate } from "../lib/types";
import { rankScanCandidates, uniqueDetectedPrintingId } from "./printing-match";

const printing = (
  printingId: string,
  setCode: string,
  collectorNumber: string,
  name = "Black Lotus",
  game = "mtg",
) => ({
  printing_id: printingId,
  collector_number: collectorNumber,
  name,
  set: { code: setCode, game },
}) as ScanCandidate;

describe("uniqueDetectedPrintingId", () => {
  it("preselects the only returned printing when OCR hints are incomplete", () => {
    const candidates = [printing("pip-232", "PIP", "232")];

    expect(uniqueDetectedPrintingId(candidates, {})).toBe("pip-232");
  });

  it("preselects one Pokemon printing when OCR only changes title punctuation", () => {
    const candidates = [
      printing("pokemon-025", "SVP", "025", "Pikachu's Journey", "pokemon"),
    ];

    expect(uniqueDetectedPrintingId(candidates, {
      name: "Pikachu s Journey",
    })).toBe("pokemon-025");
  });

  it("preselects a Magic Adventure printing when recognition reads the front title", () => {
    const candidates = [
      printing("clb-173", "CLB", "173", "Fang Dragon // Forktail Sweep"),
    ];

    expect(uniqueDetectedPrintingId(candidates, {
      name: "Fang Dragon", set: "clb", collector: "173/361",
    })).toBe("clb-173");
  });

  it("preselects the unique collector match when two Magic printings remain", () => {
    const candidates = [
      printing("pip-232", "PIP", "232"),
      printing("pip-760", "PIP", "760"),
    ];

    expect(uniqueDetectedPrintingId(candidates, {
      name: "Black Lotus", collector: "0232/0760",
    })).toBe("pip-232");
  });

  it("preselects the preferred-set suggestion when three printings remain", () => {
    const candidates = [
      printing("m10-146", "M10", "146"),
      printing("pip-232", "PIP", "232"),
      printing("lea-161", "LEA", "161"),
    ];

    expect(uniqueDetectedPrintingId(candidates, {
      name: "Black Lotus",
    }, "pip", "mtg")).toBe("pip-232");
  });

  it("does not preselect from multiple printings when OCR hints are incomplete", () => {
    const candidates = [
      printing("pip-232", "PIP", "232"),
      printing("pip-760", "PIP", "760"),
    ];

    expect(uniqueDetectedPrintingId(candidates, {})).toBe("");
  });

  it("selects the exact set and normalized collector number", () => {
    const candidates = [
      printing("pip-760", "PIP", "760"),
      printing("pip-232", "PIP", "232"),
    ];

    expect(uniqueDetectedPrintingId(candidates, {
      name: "black lotus", set: "pip", collector: "0232",
    }))
      .toBe("pip-232");
  });

  it("matches a printed collector number that includes the set denominator", () => {
    const candidates = [
      printing("pip-760", "PIP", "760"),
      printing("pip-232", "PIP", "232"),
    ];

    expect(uniqueDetectedPrintingId(candidates, {
      name: "black lotus", set: "PIP", collector: "0232/0760",
    }))
      .toBe("pip-232");
  });

  it("leaves incomplete scan hints unselected", () => {
    const candidates = [
      printing("best-ranked", "FDN", "674"),
      printing("older-printing", "PIP", "232"),
    ];

    expect(uniqueDetectedPrintingId(candidates, {})).toBe("");
  });

  it("leaves ambiguous collector hints unselected", () => {
    const candidates = [
      printing("best-ranked", "AAA", "232"),
      printing("same-number", "BBB", "232"),
    ];

    expect(uniqueDetectedPrintingId(candidates, { collector: "232" }))
      .toBe("");
  });

  it("requires an exact title match before preselecting matching set and collector hints", () => {
    const candidates = [
      printing("other-title", "PIP", "232", "Mox Pearl"),
    ];

    expect(uniqueDetectedPrintingId(candidates, {
      name: "Black Lotus", set: "pip", collector: "232",
    }))
      .toBe("");
  });

  it("preselects the leading suggestion when duplicate exact matches remain", () => {
    const candidates = [
      printing("first", "PIP", "232"),
      printing("second", "PIP", "232"),
    ];

    expect(uniqueDetectedPrintingId(candidates, {
      name: "Black Lotus", set: "pip", collector: "232",
    }))
      .toBe("first");
  });
});

describe("rankScanCandidates", () => {
  it("leads with the preferred set while retaining every other printing", () => {
    const candidates = [
      printing("m10-146", "M10", "146"),
      printing("isd-301", "ISD", "301"),
      printing("lea-161", "LEA", "161"),
    ];

    expect(rankScanCandidates(candidates, {}, "isd").map((item) => item.printing_id))
      .toEqual(["isd-301", "m10-146", "lea-161"]);
    expect(uniqueDetectedPrintingId(candidates, {}, "isd")).toBe("");
  });

  it("keeps an exact OCR set and collector match ahead of the preference", () => {
    const candidates = [
      printing("isd-301", "ISD", "301"),
      printing("m10-146", "M10", "146"),
    ];
    const hints = { name: "Black Lotus", set: "m10", collector: "146" };

    expect(rankScanCandidates(candidates, hints, "isd").map((item) => item.printing_id))
      .toEqual(["m10-146", "isd-301"]);
    expect(uniqueDetectedPrintingId(candidates, hints, "isd")).toBe("m10-146");
  });

  it("uses the preferred game to disambiguate matching set codes", () => {
    const candidates = [
      printing("mtg-m10", "M10", "146", "Pikachu", "mtg"),
      printing("pokemon-m10", "M10", "25", "Pikachu", "pokemon"),
      printing("yugioh-lob", "LOB", "001", "Pikachu", "yugioh"),
    ];

    expect(rankScanCandidates(candidates, {}, "m10", "pokemon").map((item) => item.printing_id))
      .toEqual(["pokemon-m10", "mtg-m10", "yugioh-lob"]);
  });
});
