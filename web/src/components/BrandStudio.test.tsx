import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { BrandStudio } from "./BrandStudio";
import { deleteBrandLogo, resetBranding, updateBranding } from "../lib/branding";

const brandingState = vi.hoisted(() => ({
  branding: {
    site_name: "WynterLabs",
    product_name: "CardVault",
    tagline: "Scan it. Sort it. Own your collection.",
    has_custom_logo: false,
    logo_revision: null,
  },
  applyBranding: vi.fn(),
  refreshBranding: vi.fn(),
}));

vi.mock("../app/branding", () => ({
  useBranding: () => brandingState,
}));

vi.mock("../lib/branding", () => ({
  updateBranding: vi.fn(),
  deleteBrandLogo: vi.fn(),
  resetBranding: vi.fn(),
}));

beforeEach(() => {
  brandingState.applyBranding.mockReset();
  brandingState.refreshBranding.mockReset();
  Object.assign(brandingState.branding, {
    site_name: "WynterLabs",
    product_name: "CardVault",
    tagline: "Scan it. Sort it. Own your collection.",
    has_custom_logo: false,
    logo_revision: null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function mockFileReader(dataUrl = "data:image/png;base64,preview") {
  vi.stubGlobal("FileReader", class {
    result = dataUrl;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL() { this.onload?.(); }
  });
}

it("rejects unsupported uploads without sending a branding request", async () => {
  render(<BrandStudio />);

  fireEvent.change(screen.getByLabelText(/logo file/i), {
    target: { files: [new File(["not an image"], "brand.svg", { type: "image/svg+xml" })] },
  });

  expect(screen.getByText(/png, jpg, jpeg, or webp/i)).toBeVisible();
  expect(updateBranding).not.toHaveBeenCalled();
});

it("shows a selected logo preview before saving", async () => {
  mockFileReader();
  const user = userEvent.setup();
  render(<BrandStudio />);

  await user.upload(screen.getByLabelText(/logo file/i), new File(["png"], "brand.png", { type: "image/png" }));

  expect(screen.getByAltText("Current logo preview")).toHaveAttribute("src", "data:image/png;base64,preview");
});

it("rejects oversized uploads before reading or sending them", async () => {
  const user = userEvent.setup();
  render(<BrandStudio />);
  const oversized = new File([new Uint8Array(524289)], "brand.png", { type: "image/png" });

  await user.upload(screen.getByLabelText(/logo file/i), oversized);

  expect(screen.getByText(/no larger than 512 kb/i)).toBeVisible();
  expect(updateBranding).not.toHaveBeenCalled();
});

it("keeps a draft after late branding arrives while pristine fields synchronize", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<BrandStudio />);

  brandingState.branding = {
    ...brandingState.branding,
    site_name: "Loaded Lab",
    product_name: "Loaded Vault",
  };
  rerender(<BrandStudio />);
  expect(screen.getByLabelText("Site name")).toHaveValue("Loaded Lab");

  await user.clear(screen.getByLabelText("Site name"));
  await user.type(screen.getByLabelText("Site name"), "Working Draft");
  brandingState.branding = {
    ...brandingState.branding,
    site_name: "Late Response",
    product_name: "Late Product",
  };
  rerender(<BrandStudio />);

  expect(screen.getByLabelText("Site name")).toHaveValue("Working Draft");
  expect(screen.getByLabelText("Product name")).toHaveValue("Loaded Vault");
});

it("reports a successful save from its mutation response without relying on a refresh", async () => {
  mockFileReader("data:image/png;base64,selected");
  const saved = { ...brandingState.branding, site_name: "Winter Lab", has_custom_logo: true, logo_revision: "saved" };
  vi.mocked(updateBranding).mockResolvedValue(saved);
  brandingState.refreshBranding.mockRejectedValue(new Error("unavailable"));
  const user = userEvent.setup();
  render(<BrandStudio />);

  await user.clear(screen.getByLabelText("Site name"));
  await user.type(screen.getByLabelText("Site name"), "  Winter Lab  ");
  await user.upload(screen.getByLabelText(/logo file/i), new File(["png"], "brand.png", { type: "image/png" }));
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(updateBranding).toHaveBeenCalledWith(expect.objectContaining({
    site_name: "Winter Lab", logo_data_url: "data:image/png;base64,selected",
  }));
  expect(brandingState.applyBranding).toHaveBeenCalledWith(saved);
  expect(brandingState.refreshBranding).not.toHaveBeenCalled();
  expect(await screen.findByText("Brand settings saved.")).toBeVisible();
});

it("reports a successful logo removal from its mutation response without relying on a refresh", async () => {
  brandingState.branding.has_custom_logo = true;
  const removed = { ...brandingState.branding, has_custom_logo: false, logo_revision: null };
  vi.mocked(deleteBrandLogo).mockResolvedValue(removed);
  brandingState.refreshBranding.mockRejectedValue(new Error("unavailable"));
  const user = userEvent.setup();
  render(<BrandStudio />);

  await user.click(screen.getByRole("button", { name: "Remove custom logo" }));

  expect(deleteBrandLogo).toHaveBeenCalledOnce();
  expect(brandingState.applyBranding).toHaveBeenCalledWith(removed);
  expect(brandingState.refreshBranding).not.toHaveBeenCalled();
  expect(await screen.findByText("Custom logo removed.")).toBeVisible();
});

it("reports a successful reset from its mutation response without relying on a refresh", async () => {
  const defaults = { ...brandingState.branding, has_custom_logo: false, logo_revision: null };
  vi.mocked(resetBranding).mockResolvedValue(defaults);
  brandingState.refreshBranding.mockRejectedValue(new Error("unavailable"));
  const user = userEvent.setup();
  render(<BrandStudio />);

  await user.click(screen.getByRole("button", { name: "Restore defaults" }));
  expect(resetBranding).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Confirm restore defaults" }));

  expect(resetBranding).toHaveBeenCalledOnce();
  expect(brandingState.applyBranding).toHaveBeenCalledWith(defaults);
  expect(brandingState.refreshBranding).not.toHaveBeenCalled();
  expect(await screen.findByText("Brand defaults restored.")).toBeVisible();
  expect(screen.getByAltText("Current logo preview")).toHaveAttribute("src", "/cardvault-mark.svg");
});

it("keeps the editable draft when saving fails", async () => {
  vi.mocked(updateBranding).mockRejectedValue(new Error("unavailable"));
  const user = userEvent.setup();
  render(<BrandStudio />);

  await user.clear(screen.getByLabelText("Site name"));
  await user.type(screen.getByLabelText("Site name"), "Winter Lab");
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByText(/could not be saved/i)).toBeVisible();
  expect(screen.getByLabelText("Site name")).toHaveValue("Winter Lab");
});
