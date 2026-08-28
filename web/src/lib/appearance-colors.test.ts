import { describe, expect, it } from "vitest";

import {
  APPEARANCE_ACCENTS,
  accentTokens,
  contrastRatio,
  parseCustomAccent,
} from "./appearance-colors";

const THEME_SURFACES = {
  midnight: "#08111D",
  frost: "#0C1520",
  light: "#F6F8FB",
  aurora: "#071713",
  amethyst: "#160D20",
  ember: "#1B0E0B",
  forest: "#0B1710",
  sandstone: "#F7F0E4",
  slate: "#101721",
} as const;

function compositeSoft(soft: string, surface: string): string {
  const match = soft.match(/^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/);
  if (!match) throw new TypeError(`Expected rgba soft token, received ${soft}`);
  const alpha = Number(match[4]);
  const surfaceChannels = [surface.slice(1, 3), surface.slice(3, 5), surface.slice(5, 7)]
    .map((channel) => Number.parseInt(channel, 16));
  const channels = match.slice(1, 4).map(Number).map((channel, index) =>
    Math.round(channel * alpha + surfaceChannels[index] * (1 - alpha)));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

describe("appearance accent palettes", () => {
  it("exposes 48 named, unique curated accents", () => {
    expect(APPEARANCE_ACCENTS).toHaveLength(48);
    expect(new Set(APPEARANCE_ACCENTS).size).toBe(48);
  });

  it("keeps its dark-theme Frost link accessible", () => {
    expect(contrastRatio(accentTokens("frost", null, "midnight").link, "#08111d"))
      .toBeGreaterThanOrEqual(4.5);
  });

  it("keeps accent button ink at text contrast across every curated accent and base", () => {
    for (const theme of Object.keys(THEME_SURFACES) as Array<keyof typeof THEME_SURFACES>) {
      for (const accent of APPEARANCE_ACCENTS) {
        const tokens = accentTokens(accent, null, theme);
        expect(["#000000", "#FFFFFF"], `${theme}/${accent} uses proven ink`).toContain(tokens.ink);
        expect(
          contrastRatio(tokens.ink, tokens.accent),
          `${theme}/${accent} button text contrast`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps representative custom boundary colors safe for button text", () => {
    for (const custom of ["#000000", "#FFFFFF", "#767676", "#777777", "#FF0000", "#0000FF"]) {
      for (const theme of Object.keys(THEME_SURFACES) as Array<keyof typeof THEME_SURFACES>) {
        const tokens = accentTokens("custom", custom, theme);
        expect(["#000000", "#FFFFFF"], `${theme}/${custom} uses proven ink`).toContain(tokens.ink);
        expect(
          contrastRatio(tokens.ink, tokens.accent),
          `${theme}/${custom} button text contrast`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps normal text readable on every composed soft accent surface", () => {
    const accents = [
      ...APPEARANCE_ACCENTS.map((accent) => [accent, null] as const),
      ...["#000000", "#FFFFFF", "#707070", "#767676", "#FF0000", "#0000FF"]
        .map((custom) => ["custom", custom] as const),
    ];
    for (const theme of Object.keys(THEME_SURFACES) as Array<keyof typeof THEME_SURFACES>) {
      for (const [accent, custom] of accents) {
        const tokens = accentTokens(accent, custom, theme);
        const composed = compositeSoft(tokens.soft, THEME_SURFACES[theme]);
        expect(["#000000", "#FFFFFF"], `${theme}/${accent}/${custom} soft ink`)
          .toContain(tokens.softInk);
        expect(
          contrastRatio(tokens.softInk, composed),
          `${theme}/${accent}/${custom} composed soft contrast`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps Light personalization preview text safe for boundary custom colors", () => {
    for (const custom of ["#000000", "#0000FF", "#FF0000"]) {
      const tokens = accentTokens("custom", custom, "light");
      const composed = compositeSoft(tokens.soft, THEME_SURFACES.light);
      expect(
        contrastRatio(tokens.softInk, composed),
        `light/${custom} personalization preview`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps raw and preserved-hover primary buttons readable", () => {
    const accents = [
      ...APPEARANCE_ACCENTS.map((accent) => [accent, null] as const),
      ["custom", "#707070"] as const,
    ];
    for (const theme of Object.keys(THEME_SURFACES) as Array<keyof typeof THEME_SURFACES>) {
      for (const [accent, custom] of accents) {
        const tokens = accentTokens(accent, custom, theme);
        const rawBackground = tokens.accent;
        const hoverBackground = tokens.accent;
        expect(contrastRatio(tokens.ink, rawBackground), `${theme}/${accent} raw`)
          .toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(tokens.ink, hoverBackground), `${theme}/${accent} hover`)
          .toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("accepts only a six-digit hexadecimal custom accent", () => {
    expect(parseCustomAccent("#7c3aed")).toBe("#7C3AED");
    expect(parseCustomAccent("red; background:url(x)")).toBeNull();
  });
});
