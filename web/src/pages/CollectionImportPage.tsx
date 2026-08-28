import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { Link } from "react-router-dom";

import {
  cancelCollectionImport,
  confirmCollectionImport,
  downloadCollectionCsv,
  getCollection,
  getCollectionSummary,
  previewCollectionCsv,
} from "../lib/collection";
import type { CollectionImportPreview } from "../lib/types";
import { FeedbackBanner } from "../components/workspace/FeedbackBanner";
import { PageHeader } from "../components/workspace/PageHeader";


const MAX_FILE_BYTES = 2 * 1024 * 1024;
type ImportOperation = "review" | "confirm" | "cancel" | "export" | null;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    const kibibytes = bytes / 1024;
    return `${Number.isInteger(kibibytes) ? kibibytes : kibibytes.toFixed(1)} KiB`;
  }
  const mebibytes = bytes / (1024 * 1024);
  return `${Number.isInteger(mebibytes) ? mebibytes : mebibytes.toFixed(1)} MiB`;
}

function reasonMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "The request could not be completed.";
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function CollectionImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CollectionImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<ImportOperation>(null);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState<number | null>(null);
  const [exportComplete, setExportComplete] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const alert = useRef<HTMLDivElement>(null);

  useEffect(() => () => {
    generation.current += 1;
    controller.current?.abort();
  }, []);

  useEffect(() => {
    if (error) alert.current?.focus();
  }, [error]);

  function nextController() {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    return request;
  }

  function reset() {
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
    setFile(null);
    setPreview(null);
    setComplete(null);
    setError("");
    setBusy(false);
    setOperation(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  function chooseFile(next: File | null, source: "picker" | "drop") {
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
    setFile(next);
    setPreview(null);
    setError("");
    setComplete(null);
    setBusy(false);
    setOperation(null);
    if (source === "drop" && fileInput.current) fileInput.current.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const files = event.dataTransfer.files;
    chooseFile(files.item?.(0) ?? files[0] ?? null, "drop");
  }

  async function review() {
    if (!file) {
      setError("Choose a CSV file before continuing.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("CSV files must be 2 MiB or smaller.");
      return;
    }
    const current = ++generation.current;
    const request = nextController();
    setBusy(true);
    setOperation("review");
    setError("");
    try {
      const result = await previewCollectionCsv(file, request.signal);
      if (current === generation.current) {
        setPreview(result);
        setFile(null);
        if (fileInput.current) fileInput.current.value = "";
      }
    } catch (reason) {
      if (current === generation.current && !(reason instanceof Error && reason.name === "AbortError")) {
        setError(reasonMessage(reason));
      }
    } finally {
      if (current === generation.current) {
        setBusy(false);
        setOperation(null);
      }
    }
  }

  async function confirm() {
    if (!preview || preview.summary.errors) return;
    const current = ++generation.current;
    const request = nextController();
    setBusy(true);
    setOperation("confirm");
    setError("");
    try {
      const result = await confirmCollectionImport(preview.id, request.signal);
      if (current !== generation.current) return;
      setComplete(result.applied_rows);
      setPreview(null);
      await Promise.allSettled([
        getCollection({}, request.signal),
        getCollectionSummary(request.signal),
      ]);
    } catch (reason) {
      if (current === generation.current && !(reason instanceof Error && reason.name === "AbortError")) {
        setError(reasonMessage(reason));
      }
    } finally {
      if (current === generation.current) {
        setBusy(false);
        setOperation(null);
      }
    }
  }

  async function cancel() {
    if (!preview) {
      reset();
      return;
    }
    const previewId = preview.id;
    const current = ++generation.current;
    const request = nextController();
    setBusy(true);
    setOperation("cancel");
    setError("");
    try {
      await cancelCollectionImport(previewId, request.signal);
      if (current === generation.current) reset();
    } catch (reason) {
      if (current === generation.current && !(reason instanceof Error && reason.name === "AbortError")) {
        setError(reasonMessage(reason));
        setBusy(false);
        setOperation(null);
      }
    }
  }

  async function exportCsv() {
    const current = ++generation.current;
    const request = nextController();
    setBusy(true);
    setOperation("export");
    setError("");
    setExportComplete(false);
    try {
      const blob = await downloadCollectionCsv(request.signal);
      if (current === generation.current) {
        saveBlob(blob, "wynterlabs-collection.csv");
        setExportComplete(true);
      }
    } catch (reason) {
      if (current === generation.current && !(reason instanceof Error && reason.name === "AbortError")) {
        setError(reasonMessage(reason));
      }
    } finally {
      if (current === generation.current) {
        setBusy(false);
        setOperation(null);
      }
    }
  }

  function downloadErrors() {
    if (!preview) return;
    const rows = preview.rows.filter((row) => row.classification === "error");
    const csv = [
      "source_row,scryfall_printing_id,error_code,error_message",
      ...rows.map((row) => [
        row.source_row,
        row.printing_id,
        row.error_code ?? "",
        JSON.stringify(row.error_message ?? ""),
      ].join(",")),
    ].join("\r\n");
    saveBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), "collection-import-errors.csv");
  }

  const stage = complete !== null
    ? "complete"
    : operation === "confirm"
      ? "confirm"
      : preview
        ? "review"
        : "choose";
  const warningCount = preview?.rows.reduce((count, row) => count + row.warnings.length, 0) ?? 0;

  return (
    <section className="collection-import-page">
      <PageHeader
        eyebrow="Private inventory tools"
        description="Move your collection safely with a guided review, clear results, and a private CSV backup."
        actions={<Link to="/collection">Back to collection</Link>}
      >
        Import or export collection
      </PageHeader>

      <ol className="collection-import-stages" aria-label="Import progress">
        {(["choose", "review", "confirm", "complete"] as const).map((step, index) => (
          <li key={step} aria-current={stage === step ? "step" : undefined}>
            <span>{index + 1}</span>
            {step[0].toUpperCase() + step.slice(1)}
          </li>
        ))}
      </ol>

      {error ? (
        <div className="collection-import-feedback" tabIndex={-1} ref={alert}>
          <FeedbackBanner tone="error">{error}</FeedbackBanner>
        </div>
      ) : null}

      <div className="collection-import-workspace">
        <div className="collection-import-main">
          {complete !== null ? (
            <section className="collection-import-complete collection-transfer-card" aria-live="polite">
              <p className="collection-transfer-kicker">All done</p>
              <h2>Import complete</h2>
              <FeedbackBanner tone="success">
                {complete} {complete === 1 ? "row was" : "rows were"} applied atomically.
              </FeedbackBanner>
              <div className="button-row">
                <Link className="button-link" to="/collection">View collection</Link>
                <button type="button" onClick={reset}>Import another CSV</button>
              </div>
            </section>
          ) : preview ? (
            <section className="collection-import-review collection-transfer-card" aria-busy={operation === "confirm"}>
              <p className="collection-transfer-kicker">Safe preview</p>
              <h2>Review import</h2>
              <p>Check the normalized rows below. Nothing changes until you confirm the import.</p>
              <dl className="collection-import-summary">
                <div><dt>Additions</dt><dd>{preview.summary.additions} addition{preview.summary.additions === 1 ? "" : "s"}</dd></div>
                <div><dt>Increments</dt><dd>{preview.summary.increments} increment{preview.summary.increments === 1 ? "" : "s"}</dd></div>
                <div><dt>Errors</dt><dd>{preview.summary.errors}</dd></div>
                <div><dt>Warnings</dt><dd>{warningCount}</dd></div>
              </dl>
              {preview.summary.errors > 0 ? (
                <FeedbackBanner tone="error" className="collection-import-blocked">
                  <strong>Fix the highlighted rows before importing.</strong>
                  <span> Nothing has been added yet. Download the errors CSV, correct the file, and try again.</span>
                </FeedbackBanner>
              ) : (
                <FeedbackBanner tone="success" className="collection-import-ready">
                  This preview is ready. Confirm only when the totals and card details look right.
                </FeedbackBanner>
              )}
              <div
                aria-label="Normalized collection rows"
                className="collection-import-table-wrap"
                role="region"
                tabIndex={0}
              >
                <table>
                  <caption>Normalized collection rows</caption>
                  <thead><tr><th>Row</th><th>Card</th><th>Details</th><th>Result</th></tr></thead>
                  <tbody>{preview.rows.map((row) => (
                    <tr key={row.source_row} className={`collection-import-row-${row.classification}`}>
                      <td>{row.source_row}</td>
                      <td>{row.card_name}</td>
                      <td>{row.quantity} {row.finish}, {row.condition.replaceAll("_", " ")}</td>
                      <td>
                        {row.classification === "error"
                          ? <span className="import-row-error">{row.error_message}</span>
                          : <span className={`collection-import-result collection-import-result-${row.classification}`}>
                              {row.classification}: {row.resulting_quantity}
                            </span>}
                        {row.warnings.map((warning) => <small key={warning}>{warning.replaceAll("_", " ")}</small>)}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <div className="button-row">
                <button type="button" disabled={busy || preview.summary.errors > 0} onClick={() => void confirm()}>
                  {operation === "confirm" ? "Confirming..." : "Confirm import"}
                </button>
                <button type="button" disabled={busy} onClick={() => void cancel()}>
                  {operation === "cancel" ? "Cancelling..." : "Cancel import"}
                </button>
                {preview.summary.errors > 0 && (
                  <button type="button" disabled={busy} onClick={downloadErrors}>Download errors CSV</button>
                )}
              </div>
            </section>
          ) : (
            <section className="collection-import-start collection-transfer-card" aria-busy={operation === "review"}>
              <p className="collection-transfer-kicker">Bring cards in</p>
              <h2>Choose a collection CSV</h2>
              <p>Choose one UTF-8 CSV. We will validate every row before anything changes.</p>
              <ul className="collection-import-rules" aria-label="CSV requirements">
                <li><strong>Up to 10,000 rows</strong><span>Large collections are welcome.</span></li>
                <li><strong>2 MiB maximum</strong><span>Keeps review quick and reliable.</span></li>
                <li><strong>Exact printing IDs</strong><span>Protects set and printing accuracy.</span></li>
              </ul>
              <div
                className="collection-import-dropzone"
                onDragOver={(event) => event.preventDefault()}
                onDrop={onDrop}
              >
                <p><strong>Drop a CSV here</strong> or use the file picker below.</p>
                <label>
                  Choose collection CSV
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) => chooseFile(event.target.files?.[0] ?? null, "picker")}
                  />
                </label>
                {file ? (
                  <div className="collection-import-file" aria-live="polite">
                    <span className="collection-import-file-icon" aria-hidden="true">CSV</span>
                    <span className="collection-import-file-copy">
                      <strong>{file.name}</strong>
                      <span>Ready to review · {file.name} is selected</span>
                    </span>
                    <span className="collection-import-file-size">{formatFileSize(file.size)}</span>
                  </div>
                ) : null}
              </div>
              <p className="collection-import-privacy">
                Your CSV is sent only to this private WynterLabs server for normalization. Raw CSV
                content is never shown in the page or sent to another service.
              </p>
              <div className="button-row">
                <button className="collection-import-primary" type="button" disabled={busy} onClick={() => void review()}>
                  {operation === "review" ? "Checking every row..." : "Review CSV"}
                </button>
              </div>
            </section>
          )}
        </div>

        <aside className="workspace-export-panel" aria-labelledby="collection-export-heading" aria-busy={operation === "export"}>
          <div className="collection-export-mark" aria-hidden="true">↓</div>
          <p className="eyebrow">Private backup</p>
          <h2 id="collection-export-heading">Export current collection</h2>
          <p>Download a portable CSV containing your current collection details.</p>
          <ul className="collection-export-details">
            <li>Card printing, finish, condition, and quantity</li>
            <li>No photo or credential data</li>
            <li>Ready to import back into WynterLabs</li>
          </ul>
          {(operation === "export" || exportComplete) ? (
            <div className={`collection-export-status ${exportComplete ? "is-complete" : "is-working"}`} role="status" aria-live="polite">
              <strong>{exportComplete ? "Export ready" : "Preparing your CSV"}</strong>
              <span>{exportComplete
                ? "Downloaded as wynterlabs-collection.csv."
                : "Building your private collection backup..."}</span>
            </div>
          ) : null}
          <button className="collection-export-button" type="button" disabled={busy} onClick={() => void exportCsv()}>
            {operation === "export" ? "Preparing CSV..." : exportComplete ? "Download a fresh export" : "Export CSV"}
          </button>
        </aside>
      </div>
    </section>
  );
}
