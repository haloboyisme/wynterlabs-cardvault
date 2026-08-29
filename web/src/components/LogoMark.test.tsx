import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LogoMark } from "./LogoMark";

describe("CardVault logo assets", () => {
  it("renders the reusable CardVault mark in the site header", () => {
    const { container } = render(<LogoMark />);

    expect(container.querySelector('img.logo-mark[src="/cardvault-mark.svg"]')).not.toBeNull();
  });

  it("declares the CardVault mark as the browser-tab icon", () => {
    const html = readFileSync(resolve(import.meta.dirname, "../../index.html"), "utf8");
    const document = new DOMParser().parseFromString(html, "text/html");

    expect(document.querySelector('link[rel="icon"]')?.getAttribute("href")).toBe("/cardvault-mark.svg");
  });
});
