import { type ReactNode, useEffect, useRef, useState } from "react";

import { expandScanCandidates, getScanCandidates } from "../lib/catalog";
import { addCollectionItem, getCollectionSummary } from "../lib/collection";
import { recognizeCardPhoto } from "../lib/scanner";
import type { CollectionCondition, ScanCandidate } from "../lib/types";
import {
  addSessionCapture,
  canConfirmSessionItem,
  confirmSessionItem,
  createMultiScanSession,
  removeSessionItem,
  replaceSessionCapture,
  selectSessionItem,
  setAllMatchedSessionItemsConfirmed,
  setSessionItemError,
  updateSessionItem,
  type MultiScanSession as MultiScanSessionState,
} from "../scanner/multi-scan-session";
import { filterConfidentScanCandidates } from "../scanner/title-confidence";
import { rankScanCandidates, uniqueDetectedPrintingId } from "../scanner/printing-match";
import { CardImage } from "./CardImage";
import { CardScanner, type CapturedScan } from "./CardScanner";

const CONDITIONS: Array<[CollectionCondition, string]> = [
  ["near_mint", "Near mint"],
  ["lightly_played", "Lightly played"],
  ["moderately_played", "Moderately played"],
  ["heavily_played", "Heavily played"],
  ["damaged", "Damaged"],
];

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function previewPrice(candidate: ScanCandidate, finish: string) {
  const value = finish === "foil"
    ? candidate.prices.usd_foil ?? candidate.prices.usd
    : finish === "etched"
      ? candidate.prices.usd_etched ?? candidate.prices.usd
      : candidate.prices.usd;
  if (!value) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? usd.format(amount) : null;
}

const sessionItemId = (sequence: number) =>
  globalThis.crypto?.randomUUID?.() ?? `scan-${Date.now()}-${sequence}`;

export function MultiScanSession({
  preferredSet = "",
  preferredSetGame = "",
  preferredGame = "",
  topControls,
  stableFrameAutoCapture = true,
  onCaptureAccepted,
}: {
  preferredSet?: string;
  preferredSetGame?: string;
  preferredGame?: string;
  topControls?: ReactNode;
  stableFrameAutoCapture?: boolean;
  onCaptureAccepted?: () => void;
}) {
  const [session, setSessionState] = useState(() => createMultiScanSession());
  const [retakeId, setRetakeId] = useState("");
  const [sessionStatus, setSessionStatus] = useState("");
  const [stopped, setStopped] = useState(false);
  const [filters, setFilters] = useState<Record<string, { set: string; collector: string }>>({});
  const [saveFeedback, setSaveFeedback] = useState<{ saved: number; failed: number } | null>(null);
  const [collectionTotal, setCollectionTotal] = useState<number | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const sessionRef = useRef(session);
  const captures = useRef(new Map<string, CapturedScan>());
  const requests = useRef(new Map<string, AbortController>());
  const generations = useRef(new Map<string, number>());
  const queue = useRef(Promise.resolve());
  const sequence = useRef(0);
  const active = useRef(true);
  const savePass = useRef(false);

  const setSession = (change: (current: MultiScanSessionState) => MultiScanSessionState) => {
    setSessionState((current) => {
      const next = change(current);
      sessionRef.current = next;
      return next;
    });
  };

  useEffect(() => () => {
    active.current = false;
    for (const controller of requests.current.values()) controller.abort();
    for (const item of sessionRef.current.items) URL.revokeObjectURL?.(item.previewUrl);
  }, []);

  const enqueueRecognition = (id: string, scan: CapturedScan, manualTitle?: string) => {
    queue.current = queue.current
      .catch(() => undefined)
      .then(() => active.current ? recognizeItem(id, scan, manualTitle) : undefined);
  };

  const recognizeItem = async (id: string, scan: CapturedScan, manualTitle?: string) => {
    requests.current.get(id)?.abort();
    const controller = new AbortController();
    requests.current.set(id, controller);
    const generation = (generations.current.get(id) ?? 0) + 1;
    generations.current.set(id, generation);
    setSession((current) => updateSessionItem(current, id, {
      status: "recognizing",
      error: "",
      candidates: [],
      selectedPrintingId: "",
      confirmed: false,
    }));
    try {
      let privateTitles: string[] = [];
      let privateSet = "";
      let privateCollector = "";
      if (!manualTitle && scan.imageBlob) {
        try {
          const privateHints = await recognizeCardPhoto(scan.imageBlob, controller.signal);
          privateTitles = [privateHints.name, ...privateHints.titleCandidates];
          privateSet = privateHints.set ?? scan.hints.set ?? "";
          privateCollector = privateHints.collector ?? scan.hints.collector ?? "";
        } catch (reason) {
          if ((reason as Error).name === "AbortError") throw reason;
        }
      }
      const titles = [...new Set([
        ...(manualTitle ? [manualTitle] : privateTitles),
        scan.hints.name,
        ...scan.hints.titleCandidates,
      ].map((value) => value.trim()).filter(Boolean))].slice(0, 5);
      let candidates: ScanCandidate[] = [];
      let detectedTitle = manualTitle?.trim() ?? privateTitles[0]?.trim() ?? scan.hints.name.trim();
      for (const title of titles) {
        const result = await getScanCandidates({
          name: title,
          set: privateSet || scan.hints.set,
          collector: privateCollector || scan.hints.collector,
          preferredSet: preferredSet || undefined,
          preferredGame: preferredSetGame || undefined,
          game: preferredGame || undefined,
        }, controller.signal);
        candidates = filterConfidentScanCandidates(title, result);
        if (candidates.length) {
          candidates = rankScanCandidates(
            await expandScanCandidates(candidates, controller.signal, preferredGame || undefined),
            {
              set: privateSet || scan.hints.set,
              collector: privateCollector || scan.hints.collector,
            },
            preferredSet,
            preferredSetGame,
          );
          detectedTitle = title;
          break;
        }
      }
      if (generations.current.get(id) !== generation) return;
      const detectedPrintingId = uniqueDetectedPrintingId(candidates, {
        name: detectedTitle,
        set: privateSet || scan.hints.set,
        collector: privateCollector || scan.hints.collector,
      }, preferredSet, preferredSetGame);
      const detectedPrinting = candidates.find(
        (candidate) => candidate.printing_id === detectedPrintingId,
      );
      setSession((current) => updateSessionItem(current, id, {
        detectedTitle,
        searchTitle: manualTitle?.trim() ?? detectedTitle,
        candidates,
        selectedPrintingId: detectedPrintingId,
        finish: detectedPrinting?.finishes[0] ?? "",
        status: "review",
        error: candidates.length ? "" : "No confident match found. Search the card title or retake it.",
      }));
    } catch (reason) {
      if (generations.current.get(id) === generation && (reason as Error).name !== "AbortError") {
        setSession((current) => setSessionItemError(
          current,
          id,
          reason instanceof Error ? reason.message : "Recognition unavailable.",
        ));
      }
    } finally {
      if (requests.current.get(id) === controller) requests.current.delete(id);
    }
  };

  const receiveScan = (scan: CapturedScan) => {
    const replacing = retakeId;
    if (replacing) {
      const previous = sessionRef.current.items.find((item) => item.id === replacing);
      if (!previous) {
        URL.revokeObjectURL?.(scan.previewUrl);
        setRetakeId("");
        return;
      }
      captures.current.set(replacing, scan);
      setSession((current) => replaceSessionCapture(current, replacing, {
        previewUrl: scan.previewUrl,
        imageBlob: scan.imageBlob ?? new Blob(),
      }));
      if (previous && previous.previewUrl !== scan.previewUrl) {
        URL.revokeObjectURL?.(previous.previewUrl);
      }
      setRetakeId("");
      setSessionStatus("Replacement captured. Check the exact printing.");
      onCaptureAccepted?.();
      enqueueRecognition(replacing, scan);
      return;
    }
    if (sessionRef.current.items.length >= sessionRef.current.maximumItems) {
      URL.revokeObjectURL?.(scan.previewUrl);
      return;
    }
    sequence.current += 1;
    const id = sessionItemId(sequence.current);
    captures.current.set(id, scan);
    setSession((current) => addSessionCapture(current, {
      id,
      previewUrl: scan.previewUrl,
      imageBlob: scan.imageBlob ?? new Blob(),
      status: "queued",
      detectedTitle: scan.hints.name,
      searchTitle: scan.hints.name,
      candidates: [],
      selectedPrintingId: "",
      finish: "",
      condition: "near_mint",
      quantity: 1,
      confirmed: false,
      error: "",
    }));
    setSessionStatus(`Card ${sessionRef.current.items.length + 1} captured.`);
    onCaptureAccepted?.();
    enqueueRecognition(id, scan);
  };

  const selected = session.items.find((item) => item.id === session.selectedId);
  const selectedCandidate = selected?.candidates.find(
    (candidate) => candidate.printing_id === selected.selectedPrintingId,
  );
  const selectedPrice = selectedCandidate
    ? previewPrice(selectedCandidate, selected?.finish ?? "")
    : null;
  const confirmableItems = session.items.filter(canConfirmSessionItem);
  const confirmedItems = confirmableItems.filter((item) => item.confirmed);
  const allMatchedConfirmed = confirmableItems.length > 0
    && confirmedItems.length === confirmableItems.length;
  const needsAttention = session.items.filter(
    (item) => item.status !== "saved" && item.status !== "saving" && !canConfirmSessionItem(item),
  ).length;
  const selectedFilters = selected ? filters[selected.id] ?? { set: "", collector: "" } : { set: "", collector: "" };
  const selectedSetOptions = selected
    ? [...new Map(selected.candidates.map((candidate) => [candidate.set.code.toUpperCase(), candidate.set.name])).entries()]
      .sort((left, right) => left[1].localeCompare(right[1]))
    : [];
  const visibleCandidates = selected?.candidates.filter((candidate) => {
    const setMatches = !selectedFilters.set
      || candidate.set.code.toUpperCase() === selectedFilters.set;
    const collector = selectedFilters.collector.trim().toLocaleLowerCase();
    return setMatches
      && (!collector || candidate.collector_number.toLocaleLowerCase().includes(collector));
  }) ?? [];
  const sessionFeedback = sessionStatus || (session.items.length
    ? `${session.items.length} ${session.items.length === 1 ? "card" : "cards"} captured. Choose a card to review.`
    : "Ready to capture cards.");

  const chooseCandidate = (candidate: ScanCandidate) => {
    if (!selected) return;
    setSession((current) => updateSessionItem(current, selected.id, {
      selectedPrintingId: candidate.printing_id,
      finish: candidate.finishes[0] ?? "",
      condition: "near_mint",
      quantity: 1,
      confirmed: false,
      status: "review",
      error: "",
    }));
  };

  const saveConfirmed = async () => {
    if (savePass.current) return;
    savePass.current = true;
    setSavingAll(true);
    const ready = sessionRef.current.items.filter((item) => item.confirmed && item.status === "ready");
    let saved = 0;
    let failed = 0;
    try {
      for (const item of ready) {
        setSession((current) => updateSessionItem(current, item.id, { status: "saving", error: "" }));
        try {
          await addCollectionItem({
            printing_id: item.selectedPrintingId,
            finish: item.finish,
            condition: item.condition as CollectionCondition,
            quantity: item.quantity,
          });
          saved += 1;
          captures.current.delete(item.id);
          generations.current.delete(item.id);
          setFilters((current) => {
            const next = { ...current };
            delete next[item.id];
            return next;
          });
          URL.revokeObjectURL?.(item.previewUrl);
          setSession((current) => removeSessionItem(current, item.id));
        } catch (reason) {
          failed += 1;
          setSession((current) => updateSessionItem(current, item.id, {
            status: "ready",
            confirmed: true,
            error: reason instanceof Error ? reason.message : "This card could not be added.",
          }));
        }
      }
      if (saved) {
        try {
          const summary = await getCollectionSummary();
          setCollectionTotal(summary.total_copies);
        } catch {
          setCollectionTotal(null);
        }
        setSessionStatus(`${saved} ${saved === 1 ? "card" : "cards"} added to your collection.`);
      }
      setSaveFeedback({ saved, failed });
    } finally {
      savePass.current = false;
      setSavingAll(false);
    }
  };

  return <section className="multi-scan-session" aria-labelledby="multi-scan-session-title">
    <h2 id="multi-scan-session-title">Card-by-card session</h2>
    <p>Start the camera, hold one card steady, then replace it with the next card. Every result still needs your confirmation.</p>
    {!stopped && <section className="multi-scan-camera-workspace scanner-primary-grid" aria-label="Scanner workspace">
      <CardScanner
        topControls={<>
          {topControls}
          <section className="scanner-session-summary scanner-session-strip" aria-label="Multi-card scanning session">
            <p role="status" aria-label="Multi-card scanning session">{sessionFeedback}</p>
          </section>
        </>}
        continuous
        stableFrameAutoCapture={stableFrameAutoCapture}
        captureCount={session.items.length}
        maximumCaptures={session.maximumItems}
        onResult={receiveScan}
        onReset={() => {
          setStopped(true);
          setSessionStatus("Scanning stopped. Review or save the cards below.");
        }}
      />
      <aside
        className="multi-scan-selected-preview"
        aria-labelledby="multi-scan-selected-preview-title"
        aria-live="polite"
      >
        <span className="scanner-status-chip">Selected printing</span>
        <h3 id="multi-scan-selected-preview-title">Selected card preview</h3>
        {selectedCandidate ? <>
          <CardImage
            className="multi-scan-selected-preview-image"
            name={selectedCandidate.name}
            imageUris={selectedCandidate.image_uris}
          />
          <div className="multi-scan-selected-preview-details">
            <strong>{selectedCandidate.name}</strong>
            <span>{selectedCandidate.set.name}</span>
            <span>{selectedCandidate.set.code.toUpperCase()} · {selectedCandidate.collector_number}</span>
          </div>
          <div
            className="multi-scan-selected-preview-price"
            role="status"
            aria-label="Selected card price"
          >
            <span>Informational price</span>
            <strong>{selectedPrice ?? "Price unavailable"}</strong>
            <small>Market values may be delayed.</small>
          </div>
        </> : <div className="multi-scan-selected-preview-empty" role="status">
          <strong>{selected?.status === "recognizing"
            ? "Reading card…"
            : "No exact printing selected yet"}</strong>
          <p>{selected
            ? "Choose the correct printing below to preview it here."
            : "Capture a card to see the selected printing here."}</p>
        </div>}
      </aside>
    </section>}
    {stopped && <button type="button" onClick={() => setStopped(false)}>Resume scanning</button>}
    {stopped && sessionStatus && <p role="status">{sessionStatus}</p>}

    {session.items.length > 0 && <>
      <ol className="multi-scan-filmstrip scanner-session-strip" aria-label="Cards captured this session">
        {session.items.map((item, index) => <li key={item.id}>
          <button
            type="button"
            className={item.id === session.selectedId ? "is-selected" : ""}
            aria-label={`Card ${index + 1}, ${item.detectedTitle || "reading"}, ${item.status}`}
            onClick={() => setSession((current) => selectSessionItem(current, item.id))}
          >
            <img src={item.previewUrl} alt={`Captured card ${index + 1}`} />
            <span>{item.detectedTitle || `Card ${index + 1}`}</span>
            <small>{item.status}</small>
          </button>
        </li>)}
      </ol>

      {selected && <section
        className="multi-scan-editor scanner-review-grid"
        aria-label="Multi-card review workspace"
      >
        <h3 id="multi-scan-editor-title">Fix or confirm selected card</h3>
        {selected.status === "recognizing" && <p role="status">Reading this card&hellip;</p>}
        {selected.error && <p role="alert">{selected.error}</p>}
        <div className="form-actions">
          <button type="button" onClick={() => {
            setRetakeId(selected.id);
            setSessionStatus("Show the replacement card, then capture it.");
          }}>Retake selected card</button>
          <button type="button" onClick={() => {
            enqueueRecognition(selected.id, {
              previewUrl: selected.previewUrl,
              imageBlob: selected.imageBlob,
              hints: {
                name: selected.detectedTitle,
                titleCandidates: [selected.detectedTitle],
                rawText: selected.detectedTitle,
              },
            });
          }}>Retry recognition</button>
          <button type="button" onClick={() => {
            requests.current.get(selected.id)?.abort();
            captures.current.delete(selected.id);
            URL.revokeObjectURL?.(selected.previewUrl);
            setSession((current) => removeSessionItem(current, selected.id));
          }}>Remove selected card</button>
        </div>
        <label>Search title
          <input
            type="text"
            maxLength={120}
            value={selected.searchTitle}
            onChange={(event) => setSession((current) => updateSessionItem(
              current,
              selected.id,
              { searchTitle: event.target.value, confirmed: false },
            ))}
          />
        </label>
        <button type="button" onClick={() => {
          if (selected.searchTitle.trim()) {
            enqueueRecognition(
              selected.id,
              {
                previewUrl: selected.previewUrl,
                imageBlob: selected.imageBlob,
                hints: {
                  name: selected.searchTitle,
                  titleCandidates: [selected.searchTitle],
                  rawText: selected.detectedTitle,
                },
              },
              selected.searchTitle,
            );
          }
        }}>Search this title</button>

        {selected.candidates.length > 0 && <>
          <div className="scanner-result-toolbar">
            <label>Filter by set<select value={selectedFilters.set} onChange={(event) => {
              setFilters((current) => ({ ...current, [selected.id]: { ...selectedFilters, set: event.target.value } }));
              setSession((current) => updateSessionItem(current, selected.id, { selectedPrintingId: "", confirmed: false }));
            }}>
              <option value="">All sets</option>
              {selectedSetOptions.map(([code, name]) => <option value={code} key={code}>{name} ({code})</option>)}
            </select></label>
            <label>Filter by collector number<input value={selectedFilters.collector} onChange={(event) => {
              setFilters((current) => ({ ...current, [selected.id]: { ...selectedFilters, collector: event.target.value } }));
              setSession((current) => updateSessionItem(current, selected.id, { selectedPrintingId: "", confirmed: false }));
            }} /></label>
            <strong>Showing {visibleCandidates.length} of {selected.candidates.length} printings</strong>
          </div>
          {!visibleCandidates.length && <p className="state-panel">No printings match these filters. Clear a filter to see every printing again.</p>}
          <div className="scan-candidate-grid">
          {visibleCandidates.map((candidate) => <label className="scan-candidate" key={candidate.printing_id}>
            <input
              type="radio"
              name={`scan-printing-${selected.id}`}
              checked={selected.selectedPrintingId === candidate.printing_id}
              onChange={() => chooseCandidate(candidate)}
              aria-label={`${candidate.name}, ${candidate.set.code}, ${candidate.collector_number}`}
            />
            <CardImage name={candidate.name} imageUris={candidate.image_uris} />
            <strong>{candidate.name}</strong>
            <span>{candidate.set.name}</span>
            <span>{candidate.set.code.toUpperCase()} · {candidate.collector_number}</span>
          </label>)}
          </div>
        </>}

        {selectedCandidate && <fieldset className="scan-confirmation">
          <legend>Confirm collection details</legend>
          <p><strong>{selectedCandidate.name}</strong> · {selectedCandidate.set.name} · {selectedCandidate.collector_number}</p>
          <label>Finish<select value={selected.finish} onChange={(event) => setSession((current) => updateSessionItem(current, selected.id, { finish: event.target.value, confirmed: false }))}>
            {selectedCandidate.finishes.map((value) => <option value={value} key={value}>{value}</option>)}
          </select></label>
          <label>Condition<select value={selected.condition} onChange={(event) => setSession((current) => updateSessionItem(current, selected.id, { condition: event.target.value, confirmed: false }))}>
            {CONDITIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select></label>
          <label>Quantity<input type="number" min="1" max="9999" value={selected.quantity} onChange={(event) => setSession((current) => updateSessionItem(current, selected.id, { quantity: Number(event.target.value), confirmed: false }))} /></label>
          <label className="confirmation-check"><input
            type="checkbox"
            checked={selected.confirmed}
            onChange={(event) => setSession((current) => event.target.checked
              ? confirmSessionItem(current, selected.id)
              : updateSessionItem(current, selected.id, { confirmed: false, status: "review" }))}
          />Confirm this exact printing and collection details</label>
          <label className="confirmation-check"><input
            type="checkbox"
            checked={allMatchedConfirmed}
            disabled={!confirmableItems.length}
            onChange={(event) => setSession((current) =>
              setAllMatchedSessionItemsConfirmed(current, event.target.checked))}
          />Confirm all scanned cards in this session</label>
          <p role="status">
            {confirmedItems.length} of {confirmableItems.length} scanned cards confirmed.
            {needsAttention > 0 && <> {needsAttention} {needsAttention === 1 ? "card needs" : "cards need"} attention.</>}
          </p>
          <div className="scanner-confirm-actions">
            <button
              className="button primary"
              type="button"
              disabled={savingAll || !session.items.some((item) => item.confirmed && item.status === "ready")}
              onClick={() => void saveConfirmed()}
            >{savingAll ? "Adding confirmed cards..." : "Add confirmed cards"}</button>
          </div>
        </fieldset>}
      </section>}
      {saveFeedback && <section className="scanner-save-feedback" role="status" aria-label="Cards added">
        <span className="scanner-status-chip">{saveFeedback.saved ? "Added" : "Needs attention"}</span>
        <h3>{saveFeedback.saved ? "Confirmed cards added" : "No cards were added"}</h3>
        <p><strong>{saveFeedback.saved} {saveFeedback.saved === 1 ? "card" : "cards"} added.</strong>{saveFeedback.failed > 0 && <> {saveFeedback.failed} need attention.</>}</p>
        {collectionTotal !== null && <p>Your collection now has <strong>{collectionTotal} total cards</strong>.</p>}
        <div className="form-actions">
          <a className="button primary" href="/scan">Scan more cards</a>
          <a className="button ghost" href="/collection">View collection</a>
        </div>
      </section>}
    </>}
  </section>;
}
