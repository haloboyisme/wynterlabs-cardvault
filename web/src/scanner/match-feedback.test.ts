import { describe, expect, it } from "vitest";

import { scanMatchFeedback } from "./match-feedback";

describe("scanMatchFeedback", () => {
  it("announces when the only confident printing was preselected", () => {
    expect(scanMatchFeedback(1, true)).toBe(
      "1 confident printing found and preselected. Confirm the printing and collection details.",
    );
  });

  it("asks for review when several printings remain without a recommendation", () => {
    expect(scanMatchFeedback(4, false)).toBe(
      "4 possible printings found. Choose the exact set and collector number.",
    );
  });
});
