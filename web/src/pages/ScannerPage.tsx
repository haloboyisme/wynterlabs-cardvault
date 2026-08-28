import { type ReactNode, useEffect, useRef, useState } from "react";

import { CardImage } from "../components/CardImage";
import { CardScanner, type CapturedScan } from "../components/CardScanner";
import { MultiScanSession } from "../components/MultiScanSession";
import { ScanPreferenceSelector } from "../components/ScanPreferenceSelector";
import { expandScanCandidates, getAllCatalogSets, getScanCandidates } from "../lib/catalog";
import { addCollectionItem, getCollectionSummary } from "../lib/collection";
import { recognizeCardPhoto } from "../lib/scanner";
import type { CardSet, CollectionCondition, ScanCandidate } from "../lib/types";
import { rankScanCandidates, uniqueDetectedPrintingId } from "../scanner/printing-match";
import { filterConfidentScanCandidates } from "../scanner/title-confidence";
import { selectedSetFromValue } from "../scanner/catalog-games";

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

type ScannerMode = "single" | "multiple";

function ScanModeToggle({ mode, onChange, children }: {
  mode: ScannerMode;
  onChange: (mode: ScannerMode) => void;
  children: ReactNode;
}) {
  return <fieldset className="scanner-mode-toggle scanner-control-bar">
    <legend>Scanning mode</legend>
    <label><input
      type="radio"
      name="scanner-mode"
      checked={mode === "single"}
      onChange={() => onChange("single")}
    />Single card (manual)</label>
    <label><input
      type="radio"
      name="scanner-mode"
      checked={mode === "multiple"}
      onChange={() => onChange("multiple")}
    />Multiple cards (session)</label>
    {children}
  </fieldset>;
}

export function ScannerPage() {
  const [mode, setMode] = useState<ScannerMode>("single");
  const [catalogSets, setCatalogSets] = useState<CardSet[]>([]);
  const [preferredGame, setPreferredGame] = useState("");
  const [preferredSet, setPreferredSet] = useState("");
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const [capturedPhoto, setCapturedPhoto] = useState("");
  const [candidates, setCandidates] = useState<ScanCandidate[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [finish, setFinish] = useState("");
  const [condition, setCondition] = useState<CollectionCondition>("near_mint");
  const [quantity, setQuantity] = useState(1);
  const [confirmed, setConfirmed] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [sessionAdded, setSessionAdded] = useState(0);
  const [nextCardSignal, setNextCardSignal] = useState(0);
  const [scanHints, setScanHints] = useState<CapturedScan["hints"] | null>(null);
  const [detectedTitle, setDetectedTitle] = useState("");
  const [setFilter, setSetFilter] = useState("");
  const [collectorFilter, setCollectorFilter] = useState("");
  const [collectionTotal, setCollectionTotal] = useState<number | null>(null);
  const preferredSetRecord = selectedSetFromValue(catalogSets, preferredSet);
  const preferredSetCode = preferredSetRecord?.code ?? "";
  const preferredSetGame = preferredSetRecord?.game ?? "";

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    void getAllCatalogSets(controller.signal)
      .then((page) => setCatalogSets(page.items))
      .catch((reason) => {
        if ((reason as Error).name !== "AbortError") setCatalogSets([]);
      });
    return () => controller.abort();
  }, []);

  const selectCandidate = (candidate: ScanCandidate) => {
    setSelectedId(candidate.printing_id);
    setFinish(candidate.finishes[0] ?? "");
    setCondition("near_mint");
    setQuantity(1);
    setConfirmed(false);
    setError("");
    setSuccess("");
  };

  const resetScan = () => {
    request.current?.abort();
    request.current = null;
    generation.current += 1;
    setCapturedPhoto("");
    setCandidates([]);
    setSelectedId("");
    setFinish("");
    setCondition("near_mint");
    setQuantity(1);
    setConfirmed(false);
    setSearching(false);
    setSearched(false);
    setSaving(false);
    setError("");
    setSuccess("");
    setScanHints(null);
    setDetectedTitle("");
    setSetFilter("");
    setCollectorFilter("");
  };

  const findCandidates = async (
    hints: CapturedScan["hints"],
    requestedTitles: string[],
    imageBlob?: Blob,
  ) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const current = ++generation.current;
    setSearching(true);
    setSearched(true);
    setCandidates([]);
    setSelectedId("");
    setConfirmed(false);
    setError("");
    setSuccess("");
    try {
      let privateTitles: string[] = [];
      let privateSet = "";
      let privateCollector = "";
      if (imageBlob) {
        try {
          const privateHints = await recognizeCardPhoto(imageBlob, controller.signal);
          privateTitles = [privateHints.name, ...privateHints.titleCandidates];
          privateSet = privateHints.set ?? hints.set ?? "";
          privateCollector = privateHints.collector ?? hints.collector ?? "";
        } catch (reason) {
          if ((reason as Error).name === "AbortError") throw reason;
        }
      }
      const privateTitleKeys = new Set(
        privateTitles.map((value) => value.trim().toLocaleLowerCase()).filter(Boolean),
      );
      const titles = [...new Set([...privateTitles, ...requestedTitles]
        .map((value) => value.trim())
        .filter(Boolean))]
        .slice(0, 5);
      for (const name of titles) {
        const privateTitle = privateTitleKeys.has(name.toLocaleLowerCase());
        const matchHints = {
          name,
          set: privateTitle ? privateSet || undefined : hints.set,
          collector: privateTitle ? privateCollector || undefined : hints.collector,
        };
        const result = await getScanCandidates({
          name,
          set: matchHints.set,
          collector: matchHints.collector,
          preferredSet: preferredSetCode || undefined,
          preferredGame: preferredSetGame || undefined,
          game: preferredGame || undefined,
        }, controller.signal);
        if (current !== generation.current) return;
        const confident = filterConfidentScanCandidates(name, result);
        if (confident.length) {
          const expanded = rankScanCandidates(
            await expandScanCandidates(confident, controller.signal, preferredGame || undefined),
            matchHints,
            preferredSetCode,
            preferredSetGame,
          );
          if (current !== generation.current) return;
          setDetectedTitle(name);
          setCandidates(expanded);
          const detectedId = uniqueDetectedPrintingId(
            expanded,
            matchHints,
            preferredSetCode,
            preferredSetGame,
          );
          const detected = expanded.find((candidate) => candidate.printing_id === detectedId);
          if (detected) selectCandidate(detected);
          setSetFilter("");
          setCollectorFilter("");
          return;
        }
      }
    } catch (reason) {
      if (current === generation.current && (reason as Error).name !== "AbortError") {
        setError(reason instanceof Error ? reason.message : "Card candidates could not be loaded.");
      }
    } finally {
      if (current === generation.current) setSearching(false);
    }
  };

  const receiveScan = async ({ hints, previewUrl, imageBlob }: CapturedScan) => {
    setCapturedPhoto(previewUrl);
    setScanHints(hints);
    setDetectedTitle(hints.name);
    await findCandidates(hints, [hints.name, ...hints.titleCandidates], imageBlob);
  };

  const searchDetectedTitle = async () => {
    const name = detectedTitle.trim();
    if (!name) {
      setError("Enter a card title to search.");
      return;
    }
    if (!scanHints) return;
    setDetectedTitle(name);
    await findCandidates({ ...scanHints, name, titleCandidates: [name] }, [name]);
  };

  const selected = candidates.find((item) => item.printing_id === selectedId);
  const selectedPrice = selected ? previewPrice(selected, finish) : null;

  const save = async () => {
    if (!selected || !confirmed || !finish) return;
    const current = generation.current;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await addCollectionItem({
        printing_id: selected.printing_id,
        finish,
        condition,
        quantity,
      });
      if (current === generation.current) {
        try {
          const summary = await getCollectionSummary();
          if (current === generation.current) setCollectionTotal(summary.total_copies);
        } catch {
          if (current === generation.current) setCollectionTotal(null);
        }
        setSuccess(selected.name + " was added to your collection.");
        setSessionAdded((value) => value + 1);
        setConfirmed(false);
      }
    } catch (reason) {
      if (current === generation.current) setError(reason instanceof Error ? reason.message : "The card could not be added.");
    } finally {
      if (current === generation.current) setSaving(false);
    }
  };

  const scanNextCard = () => {
    resetScan();
    setNextCardSignal((value) => value + 1);
  };

  const setOptions = [...new Map(candidates.map((candidate) => [
    candidate.set.code.toUpperCase(),
    candidate.set.name,
  ])).entries()].sort((left, right) => left[1].localeCompare(right[1]));
  const visibleCandidates = candidates.filter((candidate) => {
    const setMatches = !setFilter || candidate.set.code.toUpperCase() === setFilter;
    const collector = collectorFilter.trim().toLocaleLowerCase();
    const collectorMatches = !collector
      || candidate.collector_number.toLocaleLowerCase().includes(collector);
    return setMatches && collectorMatches;
  });

  if (mode === "multiple") {
    return <article className="scanner-page">
      <header>
        <p className="eyebrow">Private local tool</p>
        <h1>Scan cards</h1>
        <p>Capture cards one after another, review each result, and add only the exact printings you confirm.</p>
      </header>
      <p className="scanner-mode-note">This session stays only in this browser tab and holds a maximum of 250 captures. Photos are discarded when the session ends or the page reloads.</p>
      <MultiScanSession
        preferredSet={preferredSetCode}
        preferredSetGame={preferredSetGame}
        preferredGame={preferredGame}
        topControls={<ScanModeToggle mode={mode} onChange={setMode}>
          <ScanPreferenceSelector
            sets={catalogSets}
            preferredGame={preferredGame}
            preferredSet={preferredSet}
            onPreferredGameChange={setPreferredGame}
            onPreferredSetChange={setPreferredSet}
          />
        </ScanModeToggle>}
      />
    </article>;
  }

  return (
    <article className="scanner-page">
      <header>
        <p className="eyebrow">Private local tool</p>
        <h1>Scan one card</h1>
        <p>Take or choose one photo. Free AI recognition runs on your private WynterLabs server; the photo is processed in memory and discarded immediately.</p>
      </header>
      <section className="single-scan-primary-workspace scanner-primary-grid" aria-label="Single-card scanner workspace">
        <div className="single-scan-capture-column">
          <CardScanner
            topControls={<>
              <ScanModeToggle mode={mode} onChange={setMode}>
                <ScanPreferenceSelector
                  sets={catalogSets}
                  preferredGame={preferredGame}
                  preferredSet={preferredSet}
                  onPreferredGameChange={setPreferredGame}
                  onPreferredSetChange={setPreferredSet}
                />
              </ScanModeToggle>
              <section className="scanner-session-summary scanner-session-strip" aria-label="Single-card scanning session">
                <p>{sessionAdded
                  ? `${sessionAdded} ${sessionAdded === 1 ? "card" : "cards"} added this session.`
                  : "No cards added in this session yet."}</p>
              </section>
            </>}
            onResult={(result) => void receiveScan(result)}
            onReset={resetScan}
            nextCardSignal={nextCardSignal}
          />
          {capturedPhoto && <article className="single-scan-captured-photo">
            <h2>Your photo</h2>
            <img src={capturedPhoto} alt="Your captured card" />
            <p>This preview stays in this browser. Private server recognition discards the image immediately after reading it.</p>
          </article>}
        </div>
        <aside
          className="multi-scan-selected-preview single-scan-selected-preview"
          aria-labelledby="single-scan-selected-preview-title"
          aria-live="polite"
        >
          <span className="scanner-status-chip">Selected printing</span>
          <h2 id="single-scan-selected-preview-title">Selected card preview</h2>
          {selected ? <>
            <CardImage
              className="multi-scan-selected-preview-image"
              name={selected.name}
              imageUris={selected.image_uris}
            />
            <div className="multi-scan-selected-preview-details">
              <strong>{selected.name}</strong>
              <span>{selected.set.name}</span>
              <span>{selected.set.code.toUpperCase()} · {selected.collector_number} · {selected.language.toUpperCase()}</span>
            </div>
            <div className="multi-scan-selected-preview-price" role="status" aria-label="Selected card price">
              <span>Informational price</span>
              <strong>{selectedPrice ?? "Price unavailable"}</strong>
              <small>Market values may be delayed.</small>
            </div>
          </> : <div className="multi-scan-selected-preview-empty">
            <strong>{searching ? "Finding the closest printing…" : "No exact printing selected yet"}</strong>
            <p>Capture a card to preview the exact printing here.</p>
          </div>}
        </aside>
      </section>
      {capturedPhoto && <section className="single-scan-review-workspace scanner-review-grid" aria-label="Single-card review workspace">
        <div className="single-scan-match-column">
          {searching && <p role="status">Finding possible printings&hellip;</p>}
          {!searching && <section className="scanner-title-recovery" aria-labelledby="scanner-title-recovery-title">
            <h2 id="scanner-title-recovery-title">Search the detected title</h2>
            <p>Only this title is searched. The photo goes only to your private WynterLabs server and is discarded immediately.</p>
            <label htmlFor="scanner-detected-title">Detected card title</label>
            <input
              id="scanner-detected-title"
              type="text"
              maxLength={120}
              value={detectedTitle}
              onChange={(event) => {
                setDetectedTitle(event.target.value);
                setError("");
              }}
            />
            <button className="button ghost" type="button" onClick={() => void searchDetectedTitle()}>
              Search title
            </button>
          </section>}
          {searched && !searching && !candidates.length && !error && (
            <section className="state-panel"><h2>No confident match found</h2><p>Correct the detected title above, retake the photo, or use the card catalog.</p></section>
          )}
          {candidates.length > 0 && <section className="single-scan-candidates" aria-labelledby="scan-candidates-title">
            <h2 id="scan-candidates-title">Choose the exact printing</h2>
            <p>OCR is only a hint. All known printings are shown so you can check the set and collector number yourself.</p>
            <div className="scanner-result-toolbar">
              <label>Filter by set<select value={setFilter} onChange={(event) => {
                setSetFilter(event.target.value);
                setSelectedId("");
                setConfirmed(false);
              }}>
                <option value="">All sets</option>
                {setOptions.map(([code, name]) => <option value={code} key={code}>{name} ({code})</option>)}
              </select></label>
              <label>Filter by collector number<input value={collectorFilter} onChange={(event) => {
                setCollectorFilter(event.target.value);
                setSelectedId("");
                setConfirmed(false);
              }} /></label>
              <strong>Showing {visibleCandidates.length} of {candidates.length} printings</strong>
            </div>
            {!visibleCandidates.length && <p className="state-panel">No printings match these filters. Clear a filter to see every printing again.</p>}
            <div className="scan-candidate-grid">
              {visibleCandidates.map((candidate) => <label className="scan-candidate" key={candidate.printing_id}>
                <input type="radio" name="scan-printing" checked={selectedId === candidate.printing_id} onChange={() => selectCandidate(candidate)} aria-label={candidate.name + ", " + candidate.set.code + ", " + candidate.collector_number} />
                <CardImage name={candidate.name} imageUris={candidate.image_uris} />
                <strong>{candidate.name}</strong>
                <span>{candidate.set.name}</span>
                <span>{candidate.set.code.toUpperCase()} · {candidate.collector_number} · {candidate.language.toUpperCase()}</span>
              </label>)}
            </div>
          </section>}
        </div>
        <div className="single-scan-confirm-column">
          {selected ? <section className="scan-confirmation" aria-labelledby="scan-confirm-title">
            <h2 id="scan-confirm-title">Confirm collection details</h2>
            <p><strong>{selected.name}</strong> · {selected.set.name} · {selected.collector_number}</p>
            <label>Finish<select value={finish} onChange={(event) => { setFinish(event.target.value); setConfirmed(false); }}>
              {selected.finishes.map((value) => <option value={value} key={value}>{value}</option>)}
            </select></label>
            <label>Condition<select value={condition} onChange={(event) => { setCondition(event.target.value as CollectionCondition); setConfirmed(false); }}>
              {CONDITIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select></label>
            <label>Quantity<input type="number" min="1" max="9999" value={quantity} onChange={(event) => { setQuantity(Number(event.target.value)); setConfirmed(false); }} /></label>
            <label className="confirmation-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />Confirm this exact printing and collection details</label>
            <div className="scanner-confirm-actions">
              <button className="button primary" type="button" disabled={!confirmed || !finish || quantity < 1 || saving} onClick={() => void save()}>
                {saving ? "Adding card..." : "Confirm and add card"}
              </button>
            </div>
          </section> : <section className="state-panel single-scan-confirm-empty" aria-label="Confirmation status">
            <h2>Ready for your confirmation</h2>
            <p>Select an exact printing to review its finish, condition, and quantity here.</p>
          </section>}
        </div>
      </section>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {success && <section className="scanner-save-feedback" role="status" aria-label="Card added">
        <span className="scanner-status-chip">Added</span>
        <h2>Card added</h2>
        <p>{success}</p>
        <p><strong>1 card added.</strong>{collectionTotal !== null && <> Your collection now has <strong>{collectionTotal} total cards</strong>.</>}</p>
        <div className="form-actions">
          <button className="button primary" type="button" onClick={scanNextCard}>Scan next card</button>
          <a className="button ghost" href="/collection">View collection</a>
        </div>
      </section>}
    </article>
  );
}
