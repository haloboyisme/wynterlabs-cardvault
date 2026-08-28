import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CollectionImportPage } from "./CollectionImportPage";


const preview = {
  id: "preview-1",
  rows: [{
    source_row: 2,
    printing_id: "p1",
    card_name: "Lightning Bolt",
    finish: "nonfoil",
    condition: "near_mint",
    quantity: 2,
    classification: "addition",
    existing_quantity: 0,
    resulting_quantity: 2,
    error_code: null,
    error_message: null,
    warnings: [],
  }],
  summary: { additions: 1, increments: 0, errors: 0, total_rows: 1 },
  revision: 1,
  expires_at: "2026-08-15T18:00:00Z",
  confirmed_at: null,
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (_input, init) => {
    if (init?.method === "POST" && String(_input).endsWith("/confirm")) {
      return json({ preview_id: "preview-1", applied_rows: 1 });
    }
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return json(preview, 201);
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function view() {
  return render(<MemoryRouter><CollectionImportPage /></MemoryRouter>);
}

function currentStage(name: string) {
  return screen.getByText(name, { exact: true }).closest("li");
}

it("uses the same selected-file summary for drop and picker review", async () => {
  view();
  const progress = screen.getByRole("list", { name: "Import progress" });
  expect(within(progress).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    "1Choose", "2Review", "3Confirm", "4Complete",
  ]);
  expect(currentStage("Choose")).toHaveAttribute("aria-current", "step");

  const file = new File(["x".repeat(1024)], "collection.csv", { type: "text/csv" });
  const dropZone = screen.getByText(/drop a csv here/i).closest("div")!;
  expect(fireEvent.dragOver(dropZone)).toBe(false);
  fireEvent.drop(dropZone, {
    dataTransfer: { files: [file] },
  });

  expect(screen.getByText("collection.csv")).toBeVisible();
  expect(screen.getByText("1 KiB")).toBeVisible();
  expect(screen.getByRole("button", { name: "Review CSV" })).toBeEnabled();

  fireEvent.click(screen.getByRole("button", { name: "Review CSV" }));
  await screen.findByRole("heading", { name: /review import/i });
  expect(currentStage("Review")).toHaveAttribute("aria-current", "step");
  expect(currentStage("Choose")).not.toHaveAttribute("aria-current");
});

it("reselects the same picker file after a different file is dropped", async () => {
  const user = userEvent.setup();
  view();
  const input = screen.getByLabelText(/choose collection csv/i) as HTMLInputElement;
  const fileA = new File(["alpha"], "file-a.csv", { type: "text/csv" });
  const fileB = new File(["beta"], "file-b.csv", { type: "text/csv" });

  await user.upload(input, fileA);
  expect(screen.getByText("file-a.csv")).toBeVisible();

  fireEvent.drop(screen.getByText(/drop a csv here/i).closest("div")!, {
    dataTransfer: { files: [fileB] },
  });
  expect(screen.getByText("file-b.csv")).toBeVisible();
  expect(input).toHaveValue("");

  await user.upload(input, fileA);
  expect(screen.getByText("file-a.csv")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /review csv/i }));
  expect(await screen.findByRole("heading", { name: /review import/i })).toBeVisible();
});

it("marks confirm only while the atomic confirmation request is in flight", async () => {
  let resolveConfirm!: (response: Response) => void;
  const confirmResponse = new Promise<Response>((resolve) => {
    resolveConfirm = resolve;
  });
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (init?.method === "POST" && String(input).endsWith("/confirm")) {
      return confirmResponse;
    }
    return json(preview, 201);
  });
  view();
  const file = new File(["csv"], "collection.csv", { type: "text/csv" });
  fireEvent.change(screen.getByLabelText(/choose collection csv/i), {
    target: { files: [file] },
  });
  fireEvent.click(screen.getByRole("button", { name: /review csv/i }));
  await screen.findByRole("heading", { name: /review import/i });

  fireEvent.click(screen.getByRole("button", { name: /confirm import/i }));
  expect(currentStage("Confirm")).toHaveAttribute("aria-current", "step");

  resolveConfirm(json({ preview_id: "preview-1", applied_rows: 1 }));
  expect(await screen.findByRole("heading", { name: /import complete/i })).toBeVisible();
  expect(currentStage("Complete")).toHaveAttribute("aria-current", "step");
  expect(currentStage("Confirm")).not.toHaveAttribute("aria-current");
});

it("keeps export separate and independently usable before an import", async () => {
  const createObjectUrl = vi.fn(() => "blob:collection-export");
  const revokeObjectUrl = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: createObjectUrl,
    revokeObjectURL: revokeObjectUrl,
  });
  view();

  expect(screen.getByRole("heading", { name: /export current collection/i })).toBeVisible();
  expect(screen.getByText(/no photo or credential data/i)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /export csv/i }));

  await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(
    "/api/v1/collection/export.csv",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  ));
  expect(createObjectUrl).toHaveBeenCalledOnce();
  expect(revokeObjectUrl).toHaveBeenCalledWith("blob:collection-export");
});

it("announces export progress and confirms when the download is ready", async () => {
  let finishExport!: (response: Response) => void;
  const exportResponse = new Promise<Response>((resolve) => {
    finishExport = resolve;
  });
  vi.mocked(fetch).mockImplementation(async (input) => {
    if (String(input).endsWith("/export.csv")) return exportResponse;
    return json(preview, 201);
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:collection-export"),
    revokeObjectURL: vi.fn(),
  });
  view();

  fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
  expect(screen.getByRole("button", { name: /preparing csv/i })).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent(/building your private collection backup/i);

  finishExport(new Response("card_name,quantity", {
    status: 200,
    headers: { "content-type": "text/csv" },
  }));
  expect(await screen.findByText(/export ready/i)).toBeVisible();
  expect(screen.getByText(/downloaded as wynterlabs-collection.csv/i)).toBeVisible();
});

it("shows a ready-to-review summary for the selected file", async () => {
  view();
  const file = new File(["csv"], "my-cards.csv", { type: "text/csv" });
  await userEvent.upload(screen.getByLabelText(/choose collection csv/i), file);

  expect(screen.getByText(/ready to review/i)).toBeVisible();
  expect(screen.getByText(/my-cards.csv is selected/i)).toBeVisible();
});

it("explains how to continue when preview errors block confirmation", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(json({
    ...preview,
    rows: [{ ...preview.rows[0], classification: "error", error_code: "printing_not_found",
      error_message: "Card printing was not found." }],
    summary: { additions: 0, increments: 0, errors: 1, total_rows: 1 },
  }, 201));
  view();
  await userEvent.upload(
    screen.getByLabelText(/choose collection csv/i),
    new File(["csv"], "collection.csv", { type: "text/csv" }),
  );
  fireEvent.click(screen.getByRole("button", { name: /review csv/i }));

  expect(await screen.findByText(/fix the highlighted rows/i)).toBeVisible();
  expect(screen.getByText(/nothing has been added yet/i)).toBeVisible();
});

it("previews a bounded CSV without echoing its raw contents", async () => {
  view();
  const file = new File(
    ["schema_version,scryfall_printing_id\nPRIVATE-RAW-CONTENT"],
    "collection.csv",
    { type: "text/csv" },
  );
  fireEvent.change(screen.getByLabelText(/choose collection csv/i), {
    target: { files: [file] },
  });
  fireEvent.click(screen.getByRole("button", { name: /review csv/i }));

  expect(await screen.findByRole("heading", { name: /review import/i })).toBeVisible();
  expect(screen.getByText(/1 addition/i)).toBeVisible();
  const warnings = screen.getByText("Warnings").closest("div")!;
  expect(within(warnings).getByText("0")).toBeVisible();
  expect(screen.getByText("Lightning Bolt")).toBeVisible();
  expect(screen.getByRole("region", { name: /normalized collection rows/i }))
    .toHaveAttribute("tabindex", "0");
  expect(screen.queryByText(/PRIVATE-RAW-CONTENT/)).not.toBeInTheDocument();
  const call = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "POST");
  expect(call?.[0]).toBe("/api/v1/collection/imports/preview");
  expect(call?.[1]?.headers).toEqual(expect.objectContaining({ "content-type": "text/csv" }));
});

it("requires a valid file and blocks confirmation when preview has errors", async () => {
  view();
  fireEvent.click(screen.getByRole("button", { name: /review csv/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/choose a csv/i);

  vi.mocked(fetch).mockResolvedValueOnce(json({
    ...preview,
    rows: [{ ...preview.rows[0], classification: "error", error_code: "printing_not_found",
      error_message: "Card printing was not found." }],
    summary: { additions: 0, increments: 0, errors: 1, total_rows: 1 },
  }, 201));
  const file = new File(["csv"], "collection.csv", { type: "text/csv" });
  fireEvent.change(screen.getByLabelText(/choose collection csv/i), {
    target: { files: [file] },
  });
  fireEvent.click(screen.getByRole("button", { name: /review csv/i }));
  expect(await screen.findByText(/card printing was not found/i)).toBeVisible();
  expect(screen.getByRole("button", { name: /confirm import/i })).toBeDisabled();
});

it("keeps the normalized error CSV download available", async () => {
  let downloadedAs = "";
  const createObjectUrl = vi.fn(() => "blob:collection-errors");
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloadedAs = this.download;
  });
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: createObjectUrl,
    revokeObjectURL: vi.fn(),
  });
  vi.mocked(fetch).mockResolvedValueOnce(json({
    ...preview,
    rows: [{ ...preview.rows[0], classification: "error", error_code: "printing_not_found",
      error_message: "Card printing was not found." }],
    summary: { additions: 0, increments: 0, errors: 1, total_rows: 1 },
  }, 201));
  view();
  fireEvent.change(screen.getByLabelText(/choose collection csv/i), {
    target: { files: [new File(["PRIVATE-RAW-CONTENT"], "collection.csv")] },
  });
  fireEvent.click(screen.getByRole("button", { name: /review csv/i }));
  fireEvent.click(await screen.findByRole("button", { name: /download errors csv/i }));

  expect(downloadedAs).toBe("collection-import-errors.csv");
  expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
  expect(screen.queryByText(/PRIVATE-RAW-CONTENT/)).not.toBeInTheDocument();
});

it("aborts an in-flight preview when the page unmounts", async () => {
  let requestSignal: AbortSignal | undefined;
  vi.mocked(fetch).mockImplementation(async (_input, init) =>
    new Promise((_resolve, reject) => {
      requestSignal = init?.signal ?? undefined;
      requestSignal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
    }),
  );
  const page = view();
  fireEvent.change(screen.getByLabelText(/choose collection csv/i), {
    target: { files: [new File(["csv"], "collection.csv")] },
  });
  fireEvent.click(screen.getByRole("button", { name: /review csv/i }));
  await waitFor(() => expect(requestSignal).toBeInstanceOf(AbortSignal));

  page.unmount();
  expect(requestSignal?.aborted).toBe(true);
});

it("never displays a late preview after its file is replaced", async () => {
  let firstSignal: AbortSignal | undefined;
  let resolveFirst!: (response: Response) => void;
  const firstResponse = new Promise<Response>((resolve) => {
    resolveFirst = resolve;
  });
  vi.mocked(fetch).mockImplementation(async (_input, init) => {
    firstSignal = init?.signal ?? undefined;
    return firstResponse;
  });
  view();
  const input = screen.getByLabelText(/choose collection csv/i);
  fireEvent.change(input, {
    target: { files: [new File(["a"], "file-a.csv", { type: "text/csv" })] },
  });
  fireEvent.click(screen.getByRole("button", { name: /review csv/i }));
  await waitFor(() => expect(firstSignal).toBeInstanceOf(AbortSignal));

  fireEvent.change(input, {
    target: { files: [new File(["b"], "file-b.csv", { type: "text/csv" })] },
  });

  expect(firstSignal?.aborted).toBe(true);
  expect(screen.getByText("file-b.csv")).toBeVisible();
  resolveFirst(json(preview, 201));
  await Promise.resolve();
  await Promise.resolve();
  expect(screen.queryByRole("heading", { name: /review import/i })).not.toBeInTheDocument();
  expect(screen.getByText("file-b.csv")).toBeVisible();
  expect(screen.getByRole("button", { name: /review csv/i })).toBeEnabled();
});

it("confirms, cancels, and preserves a stale preview for retry", async () => {
  view();
  const file = new File(["csv"], "collection.csv", { type: "text/csv" });
  fireEvent.change(screen.getByLabelText(/choose collection csv/i), {
    target: { files: [file] },
  });
  fireEvent.click(screen.getByRole("button", { name: /review csv/i }));
  await screen.findByRole("heading", { name: /review import/i });

  vi.mocked(fetch).mockResolvedValueOnce(json({
    error: { code: "collection_import_stale", message: "Collection changed after preview." },
  }, 409));
  fireEvent.click(screen.getByRole("button", { name: /confirm import/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/changed after preview/i);
  expect(screen.getByText("Lightning Bolt")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: /cancel import/i }));
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: /import or export/i })).toBeVisible(),
  );
});

it("shows success only after confirmation and links back to collection", async () => {
  view();
  const file = new File(["csv"], "collection.csv", { type: "text/csv" });
  fireEvent.change(screen.getByLabelText(/choose collection csv/i), {
    target: { files: [file] },
  });
  fireEvent.click(screen.getByRole("button", { name: /review csv/i }));
  await screen.findByRole("heading", { name: /review import/i });
  fireEvent.click(screen.getByRole("button", { name: /confirm import/i }));
  expect(await screen.findByRole("heading", { name: /import complete/i })).toBeVisible();
  expect(screen.getByRole("link", { name: /view collection/i })).toHaveAttribute(
    "href",
    "/collection",
  );
});
