import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LogoMark } from "./LogoMark";
import { DEFAULT_BRANDING } from "../lib/branding";

describe("CardVault logo assets", () => {
  it("renders the reusable CardVault mark in the site header", () => {
    const { container } = render(<LogoMark branding={DEFAULT_BRANDING} />);

    expect(container.querySelector('img.logo-mark[src="/cardvault-mark.svg"]')).not.toBeNull();
  });

  it("declares the CardVault mark as the browser-tab icon", () => {
    const html = readFileSync(resolve(import.meta.dirname, "../../index.html"), "utf8");
    const document = new DOMParser().parseFromString(html, "text/html");

    expect(document.querySelector('link[rel="icon"]')?.getAttribute("href")).toBe("/cardvault-mark.svg");
  });

  it("falls back to the bundled mark when a custom logo fails", () => {
    const { container } = render(<LogoMark branding={{ ...DEFAULT_BRANDING, has_custom_logo: true, logo_revision: "rev 1" }} />);
    const image = container.querySelector("img.logo-mark")!;

    expect(image).toHaveAttribute("src", "/api/v1/branding/logo?v=rev%201");
    fireEvent.error(image);
    expect(image).toHaveAttribute("src", "/cardvault-mark.svg");
  });
});
