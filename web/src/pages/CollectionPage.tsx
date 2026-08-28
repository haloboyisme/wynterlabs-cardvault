import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";

import { CardImage } from "../components/CardImage";
import { CatalogGameFilter } from "../components/CatalogGameFilter";
import { DisclosurePanel } from "../components/workspace/DisclosurePanel";
import { FeedbackBanner } from "../components/workspace/FeedbackBanner";
import { PageHeader } from "../components/workspace/PageHeader";
import { StatTile } from "../components/workspace/StatTile";
import { ApiError } from "../lib/api";
import { readAppearance } from "../lib/appearance";
import {
  COLLECTION_DISPLAY_STORAGE_KEY,
  readCollectionDisplay,
} from "../lib/collection-display";
import {
  deleteCollectionItem, getCollection, getCollectionSummary, readCollectionSort,
  updateCollectionItem, writeCollectionSort,
} from "../lib/collection";
import { createDeck, DECK_FORMATS, formatsForGame, setDeckCard } from "../lib/decks";
import { catalogGameName } from "../scanner/catalog-games";
import type {
  CollectionCondition, CollectionItem, CollectionItemUpdate, CollectionPageData,
  CollectionPageSize, CollectionPriceStatus, CollectionSort, CollectionSummary, DeckFormat,
} from "../lib/types";

const CONDITIONS: Array<[CollectionCondition, string]> = [
  ["near_mint", "Near mint"], ["lightly_played", "Lightly played"],
  ["moderately_played", "Moderately played"], ["heavily_played", "Heavily played"],
  ["damaged", "Damaged"],
];
const PAGE_SIZES: CollectionPageSize[] = [25, 50, 75, 100];
const RARITIES = ["common", "uncommon", "rare", "mythic", "special", "bonus"] as const;
const SORT_OPTIONS: Array<[CollectionSort, string]> = [
  ["updated", "Recently updated"],
  ["created_desc", "Newest added"],
  ["created_asc", "Oldest added"],
  ["name", "Name A–Z"],
  ["name_desc", "Name Z–A"],
  ["quantity", "Highest quantity"],
  ["quantity_asc", "Lowest quantity"],
  ["price_desc", "Highest price"],
  ["price_asc", "Lowest price"],
  ["missing_price", "Missing prices first"],
];
const SORT_LABELS = new Map<CollectionSort, string>(SORT_OPTIONS);
const EMPTY_PAGE: CollectionPageData = { items: [], page: 1, page_size: 25, total: 0, pages: 0 };

interface EditState {
  id: string;
  finish: string;
  condition: CollectionCondition;
  quantity: number;
}

function message(reason: unknown) {
  return reason instanceof Error ? reason.message : "The request could not be completed.";
}

function informationalPrice(item: CollectionItem) {
  const prices = item.card.prices;
  if (item.finish === "foil") return prices.usd_foil ?? prices.usd;
  if (item.finish === "etched") return prices.usd_etched ?? prices.usd;
  return prices.usd;
}

function displayValue(value: string) {
  const words = value.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function selectionName(item: CollectionItem) {
  const condition = item.condition.replaceAll("_", " ").replace(
    /\b\w/g,
    (character) => character.toUpperCase(),
  );
  return `Select ${item.card.name} — ${item.card.set.name} (${item.card.set.code.toUpperCase()}) #${item.card.collector_number}, ${displayValue(item.finish)}, ${condition}`;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const date = new Intl.DateTimeFormat("en-US", {
  year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
});

export function CollectionPage() {
  const [collection, setCollection] = useState<CollectionPageData | null>(null);
  const [summary, setSummary] = useState<CollectionSummary | null>(null);
  const [q, setQ] = useState("");
  const [setCode, setSetCode] = useState("");
  const [game, setGame] = useState("");
  const [collectorNumber, setCollectorNumber] = useState("");
  const [rarity, setRarity] = useState("");
  const [finish, setFinish] = useState("");
  const [condition, setCondition] = useState<CollectionCondition | "">("");
  const [priceStatus, setPriceStatus] = useState<CollectionPriceStatus | "">("");
  const [sort, setSort] = useState<CollectionSort>(readCollectionSort);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<CollectionPageSize>(25);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [edit, setEdit] = useState<EditState | null>(null);
  const [expandedId, setExpandedId] = useState("");
  const [display, setDisplay] = useState(readCollectionDisplay);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Map<string, CollectionItem>>(() => new Map());
  const [staleSelectedIds, setStaleSelectedIds] = useState<Set<string>>(() => new Set());
  const [quickDeckOpen, setQuickDeckOpen] = useState(false);
  const [quickDeckName, setQuickDeckName] = useState("");
  const [quickDeckFormat, setQuickDeckFormat] = useState<DeckFormat>("commander");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [resultDeck, setResultDeck] = useState<{ id: string; name: string } | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const listGeneration = useRef(0);
  const summaryGeneration = useRef(0);
  const alertRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    setRetryKey((value) => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const generation = ++listGeneration.current;
    setError("");
    getCollection({
      q,
      set: setCode,
      game: game || undefined,
      collector_number: collectorNumber,
      rarity,
      finish,
      condition,
      price_status: priceStatus || undefined,
      sort,
      page,
      page_size: pageSize,
    }, controller.signal)
      .then((result) => {
        if (generation !== listGeneration.current) return;
        setCollection(result);
        setSelected((current) => {
          const next = new Map(current);
          for (const item of result.items) {
            if (next.has(item.id)) next.set(item.id, item);
          }
          return next;
        });
        setStaleSelectedIds((current) => {
          const next = new Set(current);
          for (const item of result.items) next.delete(item.id);
          return next;
        });
        if (result.pages > 0 && page > result.pages) setPage(result.pages);
      })
      .catch((reason: Error) => {
        if (generation === listGeneration.current && reason.name !== "AbortError") setError(message(reason));
      });
    return () => controller.abort();
  }, [q, setCode, game, collectorNumber, rarity, finish, condition, priceStatus, sort, page, pageSize, retryKey]);

  useEffect(() => {
    const syncDisplay = (event: StorageEvent) => {
      if (event.key === COLLECTION_DISPLAY_STORAGE_KEY) setDisplay(readCollectionDisplay());
    };
    window.addEventListener("storage", syncDisplay);
    return () => window.removeEventListener("storage", syncDisplay);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const generation = ++summaryGeneration.current;
    getCollectionSummary(controller.signal)
      .then((result) => {
        if (generation === summaryGeneration.current) setSummary(result);
      })
      .catch((reason: Error) => {
        if (generation === summaryGeneration.current && reason.name !== "AbortError" && !collection) setError(message(reason));
      });
    return () => controller.abort();
  }, [retryKey]);

  useEffect(() => {
    if (error || mutationError) alertRef.current?.focus();
  }, [error, mutationError]);

  async function mutate(item: CollectionItem, payload: CollectionItemUpdate, success: string) {
    setBusyId(item.id);
    setError("");
    setMutationError("");
    setFeedback("");
    try {
      await updateCollectionItem(item.id, payload);
      setFeedback(success);
      setEdit(null);
      refresh();
    } catch (reason) {
      const stale = reason instanceof ApiError && reason.status === 409;
      setMutationError(stale ? `${message(reason)} The current collection has been refreshed.` : message(reason));
      if (stale) refresh();
    } finally {
      setBusyId("");
    }
  }

  async function remove(item: CollectionItem) {
    if (!window.confirm(`Remove ${item.card.name} from your collection?`)) return;
    setBusyId(item.id);
    setError("");
    setMutationError("");
    setFeedback("");
    try {
      await deleteCollectionItem(item.id, item.revision);
      setFeedback(`${item.card.name} removed from your collection.`);
      refresh();
    } catch (reason) {
      const stale = reason instanceof ApiError && reason.status === 409;
      setMutationError(stale ? `${message(reason)} The current collection has been refreshed.` : message(reason));
      if (stale) refresh();
    } finally {
      setBusyId("");
    }
  }

  function toggleSelectionMode() {
    if (bulkBusy || busyId) return;
    if (selectionMode) {
      setSelected(new Map());
      setQuickDeckOpen(false);
      setQuickDeckName("");
    } else {
      setEdit(null);
      setExpandedId("");
    }
    setSelectionMode((value) => !value);
  }

  function setItemSelected(item: CollectionItem, checked: boolean) {
    setSelected((current) => {
      const next = new Map(current);
      if (checked) next.set(item.id, item);
      else next.delete(item.id);
      return next;
    });
  }

  function selectPage(items: CollectionItem[]) {
    setSelected((current) => {
      const next = new Map(current);
      for (const item of items) next.set(item.id, item);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Map());
  }

  async function createQuickDeck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (bulkBusy || selected.size === 0) return;
    const name = quickDeckName.trim();
    if (!name) {
      setMutationError("Enter a quick deck name before continuing.");
      return;
    }
    const uniquePrintings = new Map<string, CollectionItem>();
    for (const item of selected.values()) {
      if (!uniquePrintings.has(item.printing_id)) uniquePrintings.set(item.printing_id, item);
    }
    const selectedGames = new Set([...uniquePrintings.values()].map((item) => item.card.set.game || "mtg"));
    if (selectedGames.size !== 1) {
      setMutationError("Choose cards from one game to create a deck. Filter your collection, then try again.");
      return;
    }

    setBulkBusy(true);
    setError("");
    setMutationError("");
    setFeedback("");
    setResultDeck(null);
    try {
      const selectedGame = [...selectedGames][0]!;
      const allowedFormats = formatsForGame(selectedGame);
      const deck = await createDeck({
        name,
        game: selectedGame,
        format: allowedFormats.includes(quickDeckFormat) ? quickDeckFormat : allowedFormats[0]!,
        description: null,
      });
      setResultDeck({ id: deck.id, name: deck.name });
      const failedPrintingIds = new Set<string>();
      for (const item of uniquePrintings.values()) {
        try {
          await setDeckCard(deck.id, {
            printing_id: item.printing_id,
            section: "mainboard",
            quantity: 1,
          });
        } catch {
          failedPrintingIds.add(item.printing_id);
        }
      }

      setSelected((current) => new Map(
        [...current].filter(([, item]) => failedPrintingIds.has(item.printing_id)),
      ));
      setQuickDeckOpen(false);
      setQuickDeckName("");
      if (failedPrintingIds.size > 0) {
        setMutationError(
          `${failedPrintingIds.size} of ${uniquePrintings.size} unique cards could not be added. Review the created deck, then retry the failed selection.`,
        );
      } else {
        setFeedback(`${deck.name} created with ${uniquePrintings.size} unique cards.`);
      }
    } catch (reason) {
      setMutationError(message(reason));
    } finally {
      setBulkBusy(false);
    }
  }

  const hasSelectedStale = [...staleSelectedIds].some((id) => selected.has(id));
  const selectedGames = new Set([...selected.values()].map((item) => item.card.set.game || "mtg"));
  const quickDeckFormats = selectedGames.size === 1
    ? formatsForGame([...selectedGames][0]!)
    : DECK_FORMATS;

  async function removeSelected() {
    if (bulkBusy || selected.size === 0 || hasSelectedStale) return;
    const items = [...selected.values()];
    if (!window.confirm(`Remove ${items.length} selected cards from your collection?`)) return;

    setBulkBusy(true);
    setError("");
    setMutationError("");
    setFeedback("");
    setResultDeck(null);
    setQuickDeckOpen(false);
    try {
      const results = await Promise.allSettled(
        items.map((item) => deleteCollectionItem(item.id, item.revision)),
      );
      const failedIds = new Set(items
        .filter((_item, index) => results[index].status === "rejected")
        .map((item) => item.id));
      const staleFailedIds = new Set(items
        .filter((_item, index) => {
          const result = results[index];
          return result.status === "rejected"
            && result.reason instanceof ApiError
            && result.reason.status === 409;
        })
        .map((item) => item.id));
      if (staleFailedIds.size > 0) listGeneration.current += 1;
      setSelected((current) => new Map(
        [...current].filter(([id]) => failedIds.has(id)),
      ));
      setStaleSelectedIds((current) => new Set([...current, ...staleFailedIds]));
      if (failedIds.size > 0) {
        setMutationError(
          `${failedIds.size} of ${items.length} selected cards could not be removed.${staleFailedIds.size > 0
            ? ` ${staleFailedIds.size} changed while removal was running. A successful reload or visit to a Collection result containing each changed row is required before retrying.`
            : " Try the failed cards again."}`,
        );
      } else {
        setFeedback(
          `${items.length} selected ${items.length === 1 ? "card" : "cards"} removed from your collection.`,
        );
      }
      refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  const data = collection ?? EMPTY_PAGE;
  const activeFilters: Array<{
    key: "q" | "set" | "game" | "collector_number" | "rarity" | "finish" | "condition" | "price_status";
    label: string;
    clearLabel: string;
  }> = [];
  if (q) activeFilters.push({ key: "q", label: `Search: ${q}`, clearLabel: "Clear Search" });
  if (setCode) activeFilters.push({
    key: "set",
    label: `Set: ${summary?.sets.find((entry) => entry.code === setCode)?.name ?? setCode}`,
    clearLabel: "Clear Set",
  });
  if (game) activeFilters.push({
    key: "game",
    label: `Game: ${catalogGameName(game)}`,
    clearLabel: "Clear Game",
  });
  if (collectorNumber) activeFilters.push({
    key: "collector_number",
    label: `Collector number: ${collectorNumber}`,
    clearLabel: "Clear Collector Number",
  });
  if (rarity) activeFilters.push({
    key: "rarity",
    label: `Rarity: ${displayValue(rarity)}`,
    clearLabel: "Clear Rarity",
  });
  if (finish) activeFilters.push({
    key: "finish",
    label: `Finish: ${displayValue(finish)}`,
    clearLabel: "Clear Finish",
  });
  if (condition) activeFilters.push({
    key: "condition",
    label: `Condition: ${displayValue(condition)}`,
    clearLabel: "Clear Condition",
  });
  if (priceStatus) activeFilters.push({
    key: "price_status",
    label: `Price status: ${displayValue(priceStatus)}`,
    clearLabel: "Clear Price Status",
  });

  function clearFilter(key: (typeof activeFilters)[number]["key"]) {
    if (key === "q") setQ("");
    if (key === "set") setSetCode("");
    if (key === "game") setGame("");
    if (key === "collector_number") setCollectorNumber("");
    if (key === "rarity") setRarity("");
    if (key === "finish") setFinish("");
    if (key === "condition") setCondition("");
    if (key === "price_status") setPriceStatus("");
    setPage(1);
  }

  function clearAllFilters() {
    setQ("");
    setSetCode("");
    setGame("");
    setCollectorNumber("");
    setRarity("");
    setFinish("");
    setCondition("");
    setPriceStatus("");
    setPage(1);
    setFeedback("Collection filters cleared.");
  }

  return (
    <section className="collection-page">
      <PageHeader
        eyebrow="Private inventory"
        description="Track exact printings, finishes, conditions, and quantities."
        actions={<>
          <button
            type="button"
            className="button ghost"
            disabled={bulkBusy || Boolean(busyId)}
            onClick={toggleSelectionMode}
          >{selectionMode ? "Done selecting" : "Select cards"}</button>
          <Link
            className="button-link"
            to="/collection/import"
            aria-disabled={bulkBusy || undefined}
            onClick={(event) => { if (bulkBusy) event.preventDefault(); }}
          >Import / Export CSV</Link>
        </>}
      >
        Collection
      </PageHeader>

      {summary && <section className="collection-overview" aria-label="Collection overview">
        <StatTile
          label="Estimated value"
          value={display.showPrices ? usd.format(Number(summary.estimated_value_usd)) : "Hidden"}
          detail={display.showPrices ? <>
            <span>{summary.priced_copies} of {summary.total_copies} copies priced
              {summary.unpriced_copies > 0 && <> · {summary.unpriced_copies} unpriced</>}
            </span>
            {summary.price_snapshot_at && <span>Prices from {date.format(new Date(summary.price_snapshot_at))}</span>}
            <small>Informational USD estimate · condition is not adjusted.</small>
          </> : <span>Enable prices in Account to show this estimate.</span>}
        />
        <StatTile label="Total copies" value={summary.total_copies} detail={`${summary.total_copies} total copies`} />
        <StatTile
          label="Unique cards"
          value={summary.distinct_oracle_cards}
          detail={`${summary.distinct_oracle_cards} unique cards · ${summary.distinct_items} distinct items`}
        />
        <StatTile label="Sets" value={summary.distinct_sets} detail={`${summary.distinct_sets} sets`} />
        <div className="collection-overview-details">
          <details
            className="collection-more-stats"
            open={readAppearance().complexity === "advanced" ? true : undefined}
          >
            <summary>More collection stats</summary>
            <dl>
              {summary.finishes.map((entry) => <div key={`finish-${entry.value}`}>
                <dt>{entry.value.replaceAll("_", " ")}</dt><dd>{entry.copies} copies</dd>
              </div>)}
              {summary.conditions.map((entry) => <div key={`condition-${entry.value}`}>
                <dt>{entry.value.replaceAll("_", " ")}</dt><dd>{entry.copies} copies</dd>
              </div>)}
            </dl>
            {summary.sets.length > 0 && <ul className="collection-set-stats" aria-label="Cards by set">
              {summary.sets.map((entry) => <li key={`${entry.game || "mtg"}-${entry.code}`}>
                <span>{catalogGameName(entry.game || "mtg")} · {entry.name}</span><strong>{entry.copies} copies</strong>
              </li>)}
            </ul>}
          </details>
        </div>
      </section>}

      <form className="collection-filters" onSubmit={(event) => event.preventDefault()}>
        <div className="collection-primary-filters">
          <label>Search collection<input value={q} onChange={(event) => { setQ(event.target.value); setPage(1); }} /></label>
          <label>Set filter<select value={setCode} onChange={(event) => { setSetCode(event.target.value); setPage(1); }}>
            <option value="">All sets</option>{summary?.sets
              .filter((entry) => !game || (entry.game || "mtg") === game)
              .map((entry) => <option value={entry.code} key={`${entry.game || "mtg"}-${entry.code}`}>{entry.name}</option>)}
          </select></label>
        </div>
        <DisclosurePanel
          title="Advanced collection filters"
          defaultOpen={readAppearance().complexity === "advanced"}
          className="collection-advanced-filters"
        >
          <div className="collection-secondary-filters">
            <CatalogGameFilter
              value={game}
              onChange={(value) => {
                setGame(value);
                if (setCode && !summary?.sets.some((entry) => entry.code === setCode && (!value || (entry.game || "mtg") === value))) setSetCode("");
                setPage(1);
              }}
              idPrefix="collection"
            />
            <label>Collector number filter<input
              value={collectorNumber}
              onChange={(event) => { setCollectorNumber(event.target.value); setPage(1); }}
            /></label>
            <label>Rarity filter<select
              value={rarity}
              onChange={(event) => { setRarity(event.target.value); setPage(1); }}
            >
              <option value="">All rarities</option>
              {RARITIES.map((value) => <option value={value} key={value}>
                {displayValue(value)}
              </option>)}
            </select></label>
            <label>Finish filter<select value={finish} onChange={(event) => { setFinish(event.target.value); setPage(1); }}>
              <option value="">All finishes</option><option value="nonfoil">Nonfoil</option><option value="foil">Foil</option><option value="etched">Etched</option>
            </select></label>
            <label>Condition filter<select value={condition} onChange={(event) => { setCondition(event.target.value as CollectionCondition | ""); setPage(1); }}>
              <option value="">All conditions</option>{CONDITIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select></label>
            <label>Price status filter<select
              value={priceStatus}
              onChange={(event) => {
                setPriceStatus(event.target.value as CollectionPriceStatus | "");
                setPage(1);
              }}
            >
              <option value="">All price statuses</option>
              <option value="priced">Priced</option>
              <option value="missing">Missing price</option>
            </select></label>
            <label>Sort<select value={sort} onChange={(event) => {
              const next = event.target.value as CollectionSort;
              setSort(next); writeCollectionSort(next); setPage(1);
            }}>
              {SORT_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select></label>
            <button
              type="button"
              className="button ghost collection-clear-filters"
              onClick={clearAllFilters}
            >Clear collection filters</button>
          </div>
        </DisclosurePanel>
      </form>

      {activeFilters.length > 0 && <div className="collection-active-filters" aria-label="Active collection filters">
        {activeFilters.map((filter) => <button
          key={filter.key}
          type="button"
          className="collection-filter-chip"
          aria-label={filter.clearLabel}
          onClick={() => clearFilter(filter.key)}
        ><span>{filter.label}</span><span aria-hidden="true">×</span></button>)}
      </div>}
      {collection && <p className="collection-result-feedback" role="status">
        {data.total} matching {data.total === 1 ? "item" : "items"}
        {activeFilters.length > 0
          && ` · ${activeFilters.length} active ${activeFilters.length === 1 ? "filter" : "filters"}`}
        {` · Sorted by ${SORT_LABELS.get(sort) ?? "Recently updated"}`}
      </p>}

      {selectionMode && <>
        <div
          className="collection-bulk-actions"
          role="group"
          aria-label="Selected collection actions"
        >
          <strong aria-live="polite">{selected.size} selected</strong>
          <button
            type="button"
            className="button ghost"
            disabled={bulkBusy || data.items.length === 0}
            onClick={() => selectPage(data.items)}
          >Select page</button>
          <button
            type="button"
            className="button ghost"
            disabled={bulkBusy || selected.size === 0}
            onClick={clearSelection}
          >Clear selection</button>
          <button
            type="button"
            className="button ghost"
            disabled={bulkBusy || selected.size === 0}
            aria-expanded={quickDeckOpen}
            onClick={() => setQuickDeckOpen((value) => !value)}
          >Quick deck</button>
          <button
            type="button"
            className="button ghost collection-bulk-remove"
            disabled={bulkBusy || selected.size === 0 || hasSelectedStale}
            onClick={() => void removeSelected()}
          >{bulkBusy ? "Working…" : "Remove selected"}</button>
        </div>
        {quickDeckOpen && <form
          className="collection-quick-deck"
          aria-label="Create quick deck"
          onSubmit={(event) => void createQuickDeck(event)}
        >
          <label>Quick deck name
            <input
              required
              value={quickDeckName}
              disabled={bulkBusy}
              onChange={(event) => setQuickDeckName(event.target.value)}
            />
          </label>
          <label>Quick deck format
            <select
              value={quickDeckFormats.includes(quickDeckFormat) ? quickDeckFormat : quickDeckFormats[0]}
              disabled={bulkBusy}
              onChange={(event) => setQuickDeckFormat(event.target.value as DeckFormat)}
            >
              {quickDeckFormats.map((format) => <option value={format} key={format}>
                {displayValue(format)}
              </option>)}
            </select>
          </label>
          <div className="collection-quick-deck-actions">
            <button
              className="button primary"
              disabled={bulkBusy || selected.size === 0}
            >{bulkBusy ? "Creating quick deck" : "Create quick deck"}</button>
            <button
              type="button"
              className="button ghost"
              disabled={bulkBusy}
              onClick={() => setQuickDeckOpen(false)}
            >Cancel</button>
          </div>
        </form>}
      </>}

      {(mutationError || error) && <FeedbackBanner tone="error" className="collection-feedback">
        <div className="collection-feedback-content" tabIndex={-1} ref={alertRef}>
          <span>{mutationError || error}</span>
          {resultDeck && <Link to={`/decks/${resultDeck.id}`}>View {resultDeck.name}</Link>}
          {error && <button type="button" className="text-button" onClick={refresh}>Retry</button>}
          {mutationError && <button type="button" className="text-button" onClick={() => {
            setMutationError(""); setResultDeck(null);
          }}>Dismiss message</button>}
        </div>
      </FeedbackBanner>}
      {feedback && <FeedbackBanner tone="success" className="collection-feedback">
        <div className="collection-feedback-content">
          <span>{feedback}</span>
          {resultDeck && <Link to={`/decks/${resultDeck.id}`}>View {resultDeck.name}</Link>}
          <button type="button" className="text-button" onClick={() => {
            setFeedback(""); setResultDeck(null);
          }}>Dismiss message</button>
        </div>
      </FeedbackBanner>}
      {!collection && !error && <p role="status">Loading collection...</p>}
      {collection && data.items.length === 0 && <section className="collection-empty"><h2>No cards match your collection filters.</h2><p><Link to="/cards">Browse cards</Link> to add an exact printing.</p></section>}

      {data.items.length > 0 && <ul
        className="collection-results"
        aria-label="Collection cards"
        data-view={display.view}
        data-size={display.size}
        data-animate={String(display.animateDetails)}
      >
        {data.items.map((item) => {
          const editing = edit?.id === item.id;
          const expanded = expandedId === item.id;
          const price = informationalPrice(item);
          const itemSelected = selected.has(item.id);
          return <li key={item.id}><article
            className={`collection-card${itemSelected ? " is-selected" : ""}`}
          >
            {selectionMode && <label className="collection-select-control">
              <input
                type="checkbox"
                aria-label={selectionName(item)}
                checked={itemSelected}
                disabled={bulkBusy}
                onChange={(event) => setItemSelected(item, event.target.checked)}
              />
              <span aria-hidden="true">Select</span>
            </label>}
            {item.card.active ? <Link to={`/cards/${item.printing_id}`}><CardImage name={item.card.name} imageUris={item.card.image_uris} /></Link> : <div className="inactive-card-image"><CardImage name={item.card.name} imageUris={item.card.image_uris} /></div>}
            <div className="collection-item-copy">
              <h2>{item.card.active ? <Link to={`/cards/${item.printing_id}`}>{item.card.name}</Link> : item.card.name}</h2>
              <span className="collection-quantity" aria-label={`${item.quantity} copies`}>{item.quantity}×</span>
              <span className="collection-finish-badge">{displayValue(item.finish)}</span>
              <p className="collection-game-meta">Game: {catalogGameName(item.card.set.game)}</p>
              {!item.card.active && <p className="inactive-printing" role="status">Inactive printing · card catalog details unavailable.</p>}
              {display.showSet && <p>{item.card.set.name} · {item.card.collector_number}{display.showLanguage && <> · {item.card.language.toUpperCase()}</>}</p>}
              {display.showLanguage && <p>Language: {item.card.language.toUpperCase()}</p>}
              {display.showTypeRarity && <p>{item.card.type_line} · {item.card.rarity}</p>}
              {display.showPrices && price && <p className="collection-card-price">
                <span className="sr-only">Informational price: </span>{usd.format(Number(price))}
                <small> per copy estimate</small>
              </p>}
              <button
                type="button"
                className="collection-details-toggle"
                aria-expanded={expanded}
                aria-controls={`${item.id}-details`}
                aria-label={`Details for ${item.card.name}`}
                disabled={selectionMode || bulkBusy}
                onClick={() => {
                  setExpandedId(expanded ? "" : item.id);
                  setEdit(null);
                }}
              >{expanded ? "Close details" : "View details"}</button>
              {expanded && <section
                id={`${item.id}-details`}
                className="collection-detail-bubble"
                role="region"
                aria-label={`${item.card.name} details`}
              >
                <dl className="collection-card-facts">
                  <div><dt>Quantity</dt><dd>{item.quantity}</dd></div>
                  <div><dt>Finish</dt><dd>{item.finish.replaceAll("_", " ")}</dd></div>
                  <div><dt>Condition</dt><dd>{item.condition.replaceAll("_", " ")}</dd></div>
                  {display.showSet && <div><dt>Set</dt><dd>{item.card.set.name} · {item.card.collector_number}</dd></div>}
                  {display.showLanguage && <div><dt>Language</dt><dd>{item.card.language.toUpperCase()}</dd></div>}
                  {display.showTypeRarity && <div><dt>Card</dt><dd>{item.card.type_line} · {item.card.rarity}</dd></div>}
                  {display.showPrices && price && <div><dt>Informational price</dt><dd>${price}</dd></div>}
                </dl>
                {editing ? <form className="collection-edit" onSubmit={(event) => {
                event.preventDefault();
                void mutate(item, {
                  finish: edit.finish, condition: edit.condition, quantity: edit.quantity,
                  expected_revision: item.revision,
                }, `${item.card.name} updated.`);
              }}>
                <label>Finish for {item.card.name}<select value={edit.finish} onChange={(event) => setEdit({ ...edit, finish: event.target.value })}>
                  {item.card.finishes.map((value) => <option value={value} key={value}>{value.replaceAll("_", " ")}</option>)}
                </select></label>
                <label>Condition for {item.card.name}<select value={edit.condition} onChange={(event) => setEdit({ ...edit, condition: event.target.value as CollectionCondition })}>
                  {CONDITIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select></label>
                <label>Quantity for {item.card.name}<input type="number" min="1" max="9999" required value={edit.quantity} onChange={(event) => setEdit({ ...edit, quantity: Number(event.target.value) })} /></label>
                <div className="collection-actions"><button className="button primary" disabled={busyId === item.id}>Save {item.card.name}</button><button type="button" className="button ghost" onClick={() => setEdit(null)}>Cancel</button></div>
              </form> : <>
                <div className="collection-actions">
                  <button type="button" className="button ghost" disabled={busyId === item.id || item.quantity >= 9999} aria-label={`Increment ${item.card.name}`} onClick={() => void mutate(item, { quantity: item.quantity + 1, expected_revision: item.revision }, `${item.card.name} quantity increased.`)}>+1</button>
                  <button type="button" className="button ghost" aria-label={`Edit ${item.card.name}`} onClick={() => setEdit({ id: item.id, finish: item.finish, condition: item.condition, quantity: item.quantity })}>Edit</button>
                  <button type="button" className="button ghost" disabled={busyId === item.id} aria-label={`Remove ${item.card.name}`} onClick={() => void remove(item)}>Remove</button>
                </div>
              </>}
              </section>}
            </div>
          </article></li>;
        })}
      </ul>}

      <footer className="collection-results-footer">
        <nav className="catalog-pagination" aria-label="Collection pages">
          <button type="button" disabled={bulkBusy || page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
          <span>Page {data.pages ? data.page : 0} of {data.pages}</span>
          <button type="button" disabled={bulkBusy || !data.pages || page >= data.pages} onClick={() => setPage((value) => value + 1)}>Next</button>
        </nav>
        <label className="collection-page-size">Cards per page<select disabled={bulkBusy} value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value) as CollectionPageSize); setPage(1); }}>
          {PAGE_SIZES.map((value) => <option value={value} key={value}>{value}</option>)}
        </select></label>
      </footer>
    </section>
  );
}
