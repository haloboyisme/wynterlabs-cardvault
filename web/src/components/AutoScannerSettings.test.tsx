import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";

import {
  AUTO_SCANNER_STORAGE_KEY,
  DEFAULT_AUTO_SCANNER_SETTINGS,
  readAutoScannerSettings,
} from "../scanner/auto-scanner-settings";
import { AutoScannerSettingsPanel } from "./AutoScannerSettings";

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

it("hides controller profile editing from members", () => {
  render(<AutoScannerSettingsPanel role="member" />);

  expect(screen.queryByRole("heading", { name: /auto scanner controller/i })).not.toBeInTheDocument();
});

it.each(["owner", "admin"] as const)("shows browser-local controller editing to a %s", (role) => {
  render(<AutoScannerSettingsPanel role={role} />);

  expect(screen.getByRole("heading", { name: /auto scanner controller/i })).toBeVisible();
  expect(screen.getByLabelText("STEP pin")).toHaveValue(18);
  expect(screen.getByText(/simulation only/i)).toBeVisible();
  expect(screen.getByText(/saved only in this browser/i)).toBeVisible();
});

it("tells the owner when an invalid saved controller profile was reset", () => {
  localStorage.setItem(AUTO_SCANNER_STORAGE_KEY, "not-json");

  render(<AutoScannerSettingsPanel role="owner" />);

  expect(screen.getByRole("status")).toHaveTextContent(/safe simulation defaults were restored/i);
  expect(localStorage.getItem(AUTO_SCANNER_STORAGE_KEY)).toBeNull();
});

it("shows a recovery warning when scanner reads repaired settings first", () => {
  localStorage.setItem(AUTO_SCANNER_STORAGE_KEY, "not-json");
  readAutoScannerSettings();

  render(<AutoScannerSettingsPanel role="owner" />);

  expect(screen.getByRole("status")).toHaveTextContent(/safe simulation defaults were restored/i);
});

it("clears the recovery warning after saving or resetting the profile", async () => {
  const user = userEvent.setup();
  localStorage.setItem(AUTO_SCANNER_STORAGE_KEY, "not-json");
  render(<AutoScannerSettingsPanel role="owner" />);

  expect(screen.getByText(/safe simulation defaults were restored/i)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Save controller profile" }));
  expect(screen.queryByText(/safe simulation defaults were restored/i)).not.toBeInTheDocument();
  expect(screen.getByText("Controller profile saved in this browser.")).toBeVisible();

  localStorage.setItem(AUTO_SCANNER_STORAGE_KEY, "not-json");
  fireEvent(window, new StorageEvent("storage", { key: AUTO_SCANNER_STORAGE_KEY }));
  expect(screen.getByText(/safe simulation defaults were restored/i)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Reset controller profile" }));
  expect(screen.queryByText(/safe simulation defaults were restored/i)).not.toBeInTheDocument();
});

it("blocks a duplicate pin assignment without writing browser storage", async () => {
  const user = userEvent.setup();
  render(<AutoScannerSettingsPanel role="owner" />);

  await user.clear(screen.getByLabelText("DIR pin"));
  await user.type(screen.getByLabelText("DIR pin"), "18");
  await user.click(screen.getByRole("button", { name: "Save controller profile" }));

  expect(screen.getByRole("alert")).toHaveTextContent(/pins must be unique/i);
  expect(localStorage.getItem(AUTO_SCANNER_STORAGE_KEY)).toBeNull();
});

it("blocks a speed above 100 without writing browser storage", async () => {
  const user = userEvent.setup();
  render(<AutoScannerSettingsPanel role="owner" />);

  await user.clear(screen.getByLabelText("Speed percent"));
  await user.type(screen.getByLabelText("Speed percent"), "101");
  await user.click(screen.getByRole("button", { name: "Save controller profile" }));

  expect(screen.getByRole("alert")).toHaveTextContent(/speedPercent must be between 1 and 100/i);
  expect(localStorage.getItem(AUTO_SCANNER_STORAGE_KEY)).toBeNull();
});

it("persists a valid browser-local profile and lists non-blocking board warnings", async () => {
  const user = userEvent.setup();
  render(<AutoScannerSettingsPanel role="admin" />);

  await user.clear(screen.getByLabelText("STEP pin"));
  await user.type(screen.getByLabelText("STEP pin"), "40");
  await user.click(screen.getByRole("button", { name: "Save controller profile" }));

  expect(screen.getByText("Controller profile saved in this browser.")).toBeVisible();
  expect(screen.getByText(/outside the esp32 board range/i)).toBeVisible();
  expect(JSON.parse(localStorage.getItem(AUTO_SCANNER_STORAGE_KEY) ?? "{}"))
    .toMatchObject({ pins: { step: 40 } });
});

it("resets the form and removes the versioned browser-storage profile", async () => {
  const user = userEvent.setup();
  localStorage.setItem(AUTO_SCANNER_STORAGE_KEY, JSON.stringify({
    ...DEFAULT_AUTO_SCANNER_SETTINGS,
    profileName: "Temporary profile",
  }));
  render(<AutoScannerSettingsPanel role="owner" />);

  expect(screen.getByLabelText("Profile name")).toHaveValue("Temporary profile");
  await user.click(screen.getByRole("button", { name: "Reset controller profile" }));

  expect(screen.getByLabelText("Profile name")).toHaveValue("Test card feeder");
  expect(localStorage.getItem(AUTO_SCANNER_STORAGE_KEY)).toBeNull();
});

it("synchronizes its draft after a controller-profile storage event", async () => {
  render(<AutoScannerSettingsPanel role="owner" />);
  localStorage.setItem(AUTO_SCANNER_STORAGE_KEY, JSON.stringify({
    ...DEFAULT_AUTO_SCANNER_SETTINGS,
    profileName: "Synced profile",
  }));

  fireEvent(window, new StorageEvent("storage", { key: AUTO_SCANNER_STORAGE_KEY }));

  await waitFor(() => expect(screen.getByLabelText("Profile name")).toHaveValue("Synced profile"));
});
