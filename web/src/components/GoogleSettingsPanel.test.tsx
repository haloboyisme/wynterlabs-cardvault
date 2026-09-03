import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GoogleSettingsPanel } from "./GoogleSettingsPanel";
import { GoogleAccountPanel } from "./GoogleAccountPanel";
afterEach(() => vi.unstubAllGlobals());
it("shows the private callback and never restores a saved secret into the form", async () => {
  const config = { enabled: false, client_id: "test.apps.googleusercontent.com", site_url: "https://cards.example.com", has_secret: true, callback_path: "/api/v1/auth/google/callback" };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(config), { headers: { "content-type": "application/json" } })));
  render(<GoogleSettingsPanel />);
  expect(await screen.findByLabelText("Google client secret")).toHaveValue("");
  expect(screen.getByText("https://cards.example.com/api/v1/auth/google/callback")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Your current password"), { target: { value: "a-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Google settings" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Google disabled");
  expect(screen.getByLabelText("Your current password")).toHaveValue("");
});
it("lets an already linked account unlink while provider is disabled", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ enabled: false, linked: true }), { headers: { "content-type": "application/json" } })));
  render(<GoogleAccountPanel />);
  expect(await screen.findByRole("button", { name: "Unlink Google" })).toBeEnabled();
});
