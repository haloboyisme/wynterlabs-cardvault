import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { CustomCardImportPage } from "./CustomCardImportPage";

afterEach(() => vi.unstubAllGlobals());
it("creates a custom card using the dedicated page and reports success", async () => {
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ printing_id: "card-1" }), {
    status: 201, headers: { "content-type": "application/json" },
  }));
  vi.stubGlobal("fetch", request);
  render(<MemoryRouter><CustomCardImportPage /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText("Card name"), { target: { value: "My card" } });
  fireEvent.click(screen.getByRole("button", { name: "Add to collection" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Added to your collection"));
  expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({name: "My card", quantity: 1});
});

it("keeps entered fields when saving fails", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({error: {message: "Try again"}}), {
    status: 503, headers: {"content-type": "application/json"},
  })));
  render(<MemoryRouter><CustomCardImportPage /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText("Card name"), { target: { value: "Keep me" } });
  fireEvent.click(screen.getByRole("button", { name: "Add to collection" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Try again"));
  expect(screen.getByLabelText("Card name")).toHaveValue("Keep me");
});
