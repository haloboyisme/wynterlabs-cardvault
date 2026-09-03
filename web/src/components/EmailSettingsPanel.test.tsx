import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EmailSettingsPanel } from "./EmailSettingsPanel";

afterEach(() => vi.unstubAllGlobals());

it("keeps a saved provider secret hidden and supports changing providers", async () => {
  const configuration = { enabled: true, host: "smtp.gmail.com", port: 587, username: "sender@example.com", from_address: "sender@example.com", site_url: "https://cards.example.com", has_password: true };
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(configuration), { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetcher);
  render(<EmailSettingsPanel />);
  expect(await screen.findByLabelText("Provider app password")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "custom" } });
  expect(screen.getByLabelText("SMTP host")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("SMTP host"), { target: { value: "smtp.example.net" } });
  fireEvent.change(screen.getByLabelText("Your current CardVault password"), { target: { value: "owner-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Save email settings" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Email enabled");
  const body = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
  expect(body.password).toBe("");
  expect(body.host).toBe("smtp.example.net");
  expect(body.has_password).toBeUndefined();
  expect(screen.getByLabelText("Your current CardVault password")).toHaveValue("");
});
