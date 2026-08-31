import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../app/auth";
import { MEMBER_TRADING_ENABLED } from "../app/features";
import { CardImage } from "../components/CardImage";
import { CollectionValueChart } from "../components/CollectionValueChart";
import { getCatalogStatus } from "../lib/catalog";
import { getCollection, getCollectionSummary, getCollectionValueHistory } from "../lib/collection";
import { listDecks } from "../lib/decks";
import type {
  CatalogStatus, CollectionItem, CollectionSummary, CollectionValueHistory, CollectionValueRange, Deck,
} from "../lib/types";

type StatusState =
  | { kind: "loading" }
  | { kind: "loaded"; catalog: CatalogStatus }
  | { kind: "unavailable" };

function catalogView(state: StatusState) {
  if (state.kind === "loading") return {
    chip: "Checking catalog status",
    intro: "Checking catalog status before reporting availability.",
    state: "loading",
    summary: "Catalog availability is being checked.",
    ready: false,
  };
  if (state.kind === "unavailable") return {
    chip: "Catalog status unavailable",
    intro: "Catalog status is unavailable. Availability could not be confirmed.",
    state: "unavailable",
    summary: "Catalog status could not be confirmed.",
    ready: false,
  };
  if (!state.catalog.ready) return {
    chip: "Catalog preparing",
    intro: "The catalog is preparing its first safe import.",
    summary: "Card catalog is preparing. Search will activate after the import completes.",
    ready: false,
    state: "preparing",
  };
  if (state.catalog.stale) return {
    chip: "Catalog ready · refresh recommended",
    intro: "The catalog is available, but a refresh is recommended.",
    summary: "Card search remains available from the last working catalog.",
    ready: true,
    state: "stale",
  };
  return {
    chip: "Catalog ready",
    intro: "Your private Magic catalog is ready to explore.",
    summary: "Card catalog is ready with search, printings, legalities, and source data.",
    ready: true,
    state: "ready",
  };
}

type WidgetState<T> =
  | { kind: "loading" }
  | { kind: "loaded"; data: T }
  | { kind: "error" };

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function money(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount)
    : "Unavailable";
}

function formatLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function priceSnapshotView(value: string | null) {
  if (!value) return { copy: "Price update time unavailable.", stale: true };
  const snapshot = new Date(value);
  if (Number.isNaN(snapshot.getTime())) {
    return { copy: "Price update time unavailable.", stale: true };
  }
  const elapsedDays = Math.max(0, Math.floor((Date.now() - snapshot.getTime()) / 86_400_000));
  const relative = elapsedDays === 0
    ? "today"
    : elapsedDays === 1
      ? "1 day ago"
      : `${elapsedDays} days ago`;
  const date = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(snapshot);
  return {
    copy: `Prices updated ${date} · ${relative}.`,
    stale: elapsedDays > 7,
  };
}

const VALUE_HISTORY_RANGES: Array<{ value: CollectionValueRange; label: string }> = [
  { value: "hour", label: "Hour" }, { value: "day", label: "Day" }, { value: "week", label: "Week" },
  { value: "month", label: "Month" }, { value: "quarter", label: "Quarter" }, { value: "year", label: "Year" },
  { value: "all", label: "All" },
];

export function DashboardPage() {
  const { user } = useAuth();
  const [catalogState, setCatalogState] = useState<StatusState>({ kind: "loading" });
  const [summaryState, setSummaryState] = useState<WidgetState<CollectionSummary>>({ kind: "loading" });
  const [cardsState, setCardsState] = useState<WidgetState<CollectionItem[]>>({ kind: "loading" });
  const [decksState, setDecksState] = useState<WidgetState<Deck[]>>({ kind: "loading" });
  const [valueHistoryState, setValueHistoryState] = useState<WidgetState<CollectionValueHistory>>({ kind: "loading" });
  const [valueHistoryRange, setValueHistoryRange] = useState<CollectionValueRange>("month");
  const [catalogRequest, setCatalogRequest] = useState(0);
  const [summaryRequest, setSummaryRequest] = useState(0);
  const [cardsRequest, setCardsRequest] = useState(0);
  const [decksRequest, setDecksRequest] = useState(0);
  const [valueHistoryRequest, setValueHistoryRequest] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setCatalogState({ kind: "loading" });
    getCatalogStatus(controller.signal)
      .then((catalog) => setCatalogState({ kind: "loaded", catalog }))
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setCatalogState({ kind: "unavailable" });
      });
    return () => controller.abort();
  }, [catalogRequest]);

  useEffect(() => {
    const controller = new AbortController();
    setSummaryState({ kind: "loading" });
    getCollectionSummary(controller.signal)
      .then((data) => setSummaryState({ kind: "loaded", data }))
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setSummaryState({ kind: "error" });
      });
    return () => controller.abort();
  }, [summaryRequest]);

  useEffect(() => {
    const controller = new AbortController();
    setCardsState({ kind: "loading" });
    getCollection({ sort: "updated", page: 1, page_size: 25 }, controller.signal)
      .then((data) => setCardsState({ kind: "loaded", data: data.items.slice(0, 5) }))
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setCardsState({ kind: "error" });
      });
    return () => controller.abort();
  }, [cardsRequest]);

  useEffect(() => {
    const controller = new AbortController();
    setDecksState({ kind: "loading" });
    listDecks(controller.signal)
      .then((data) => setDecksState({ kind: "loaded", data: data.items.slice(0, 4) }))
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setDecksState({ kind: "error" });
      });
    return () => controller.abort();
  }, [decksRequest]);

  useEffect(() => {
    const controller = new AbortController();
    setValueHistoryState({ kind: "loading" });
    getCollectionValueHistory(valueHistoryRange, controller.signal)
      .then((data) => setValueHistoryState({ kind: "loaded", data }))
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setValueHistoryState({ kind: "error" });
      });
    return () => controller.abort();
  }, [valueHistoryRange, valueHistoryRequest]);

  const view = catalogView(catalogState);
  const summary = summaryState.kind === "loaded" ? summaryState.data : null;
  const recentDecks = decksState.kind === "loaded" ? decksState.data : null;
  const valueHistoryPoints =
    valueHistoryState.kind === "loaded" && Array.isArray(valueHistoryState.data.points)
      ? valueHistoryState.data.points
      : [];
  const emptyWorkspace = summary?.total_copies === 0 && recentDecks?.length === 0;
  const canAdmin = user?.role === "owner" || user?.role === "super_admin" || user?.role === "admin";
  const priceSnapshot = summary ? priceSnapshotView(summary.price_snapshot_at) : null;

  return (
    <section className="dashboard">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Collection command center</p>
          <h1>{greeting(new Date().getHours())}, {user?.display_name}.</h1>
          <p>{view.intro}</p>
        </div>
        <div className={`health-chip state-${view.state}`} role="status" aria-label="Catalog status">
          <span className="status-dot" aria-hidden="true" /> {view.chip}
        </div>
      </header>

      <nav className="dashboard-quick-actions" aria-label="Quick actions">
        <Link className="button primary" to="/scan"><span aria-hidden="true">◎</span> Scan</Link>
        <Link className="button" to="/cards"><span aria-hidden="true">⌕</span> Browse</Link>
        <Link className="button" to="/collection/import"><span aria-hidden="true">⇧</span> Import</Link>
        <Link className="button" to="/decks"><span aria-hidden="true">▤</span> Decks</Link>
        {MEMBER_TRADING_ENABLED && <Link className="button" to="/trades">Trades</Link>}
        {canAdmin && <Link className="button dashboard-admin-shortcut" aria-label="Administration" to="/admin">Admin</Link>}
      </nav>

      {emptyWorkspace && (
        <section className="dashboard-checklist" role="region" aria-labelledby="dashboard-get-started">
          <div>
            <p className="eyebrow">A clean slate</p>
            <h2 id="dashboard-get-started">Get started</h2>
            <p>Build your private workspace at your pace. Any path is a good first step.</p>
          </div>
          <ol>
            <li><Link to="/scan"><strong>Scan your first card</strong><span>Use the private on-device scanner.</span></Link></li>
            <li><Link to="/collection/import"><strong>Import an existing collection</strong><span>Bring in a CSV and review it safely.</span></Link></li>
            <li><Link to="/decks"><strong>Create your first deck</strong><span>Start a format-aware list.</span></Link></li>
          </ol>
        </section>
      )}

      <section aria-labelledby="collection-overview-heading">
        <div className="dashboard-section-heading">
          <div><p className="eyebrow">At a glance</p><h2 id="collection-overview-heading">Collection overview</h2></div>
          <Link className="dashboard-inline-action" to="/collection">View collection</Link>
        </div>
        {summaryState.kind === "loading" && <div className="dashboard-widget-state" role="status">Loading collection summary…</div>}
        {summaryState.kind === "error" && (
          <div className="dashboard-widget-state form-error" role="alert" aria-label="Collection summary unavailable">
            Collection summary could not be loaded.
            <button className="text-button dashboard-widget-retry" type="button" onClick={() => setSummaryRequest((value) => value + 1)}>Retry summary</button>
          </div>
        )}
        {summary && (
          <div className="dashboard-metric-strip">
            <article className="dashboard-value-metric"><span>Estimated value</span><strong>{money(summary.estimated_value_usd)}</strong><small>{summary.priced_copies} of {summary.total_copies} copies priced</small></article>
            <article><span>Total copies</span><strong>{summary.total_copies}</strong></article>
            <article><span>Unique cards</span><strong>{summary.distinct_oracle_cards}</strong></article>
            <article><span>Sets</span><strong>{summary.distinct_sets}</strong></article>
          </div>
        )}
      </section>

      <section className="dashboard-widget dashboard-value-history" aria-labelledby="collection-value-history-heading">
        <div className="dashboard-widget-heading">
          <div><p className="eyebrow">Value over time</p><h2 id="collection-value-history-heading">Collection value history</h2></div>
        </div>
        <div className="collection-value-range" role="group" aria-label="Collection value history range">
          {VALUE_HISTORY_RANGES.map((range) => (
            <button
              key={range.value}
              className="text-button"
              type="button"
              aria-pressed={valueHistoryRange === range.value}
              onClick={() => setValueHistoryRange(range.value)}
            >
              {range.label}
            </button>
          ))}
        </div>
        {valueHistoryState.kind === "loading" && <div className="dashboard-widget-state" role="status">Loading collection value history…</div>}
        {valueHistoryState.kind === "error" && (
          <div className="dashboard-widget-state form-error" role="alert" aria-label="Collection value history unavailable">
            Collection value history could not be loaded.
            <button className="text-button dashboard-widget-retry" type="button" onClick={() => setValueHistoryRequest((value) => value + 1)}>Retry value history</button>
          </div>
        )}
        {valueHistoryState.kind === "loaded" && valueHistoryPoints.length === 0 && (
          <div className="dashboard-widget-state" role="status">
            <strong>No collection value history yet.</strong>
            <span>Value history will appear after collection activity or a price refresh.</span>
          </div>
        )}
        {valueHistoryState.kind === "loaded" && valueHistoryPoints.length > 0 && <CollectionValueChart history={valueHistoryState.data} />}
      </section>

      <div className="dashboard-content-grid">
        <article className="dashboard-widget dashboard-recent-cards" aria-labelledby="recent-cards-heading">
          <div className="dashboard-widget-heading"><div><p className="eyebrow">Latest inventory</p><h2 id="recent-cards-heading">Recent cards</h2></div><Link className="dashboard-inline-action" to="/collection">See all</Link></div>
          {cardsState.kind === "loading" && <p role="status">Loading recent cards…</p>}
          {cardsState.kind === "error" && (
            <div className="dashboard-widget-state form-error" role="alert" aria-label="Recent cards unavailable">
              Could not load recent cards.
              <button className="text-button dashboard-widget-retry" type="button" onClick={() => setCardsRequest((value) => value + 1)}>Retry recent cards</button>
            </div>
          )}
          {cardsState.kind === "loaded" && cardsState.data.length === 0 && <p>No cards yet. Scan or import one to begin.</p>}
          {cardsState.kind === "loaded" && cardsState.data.length > 0 && (
            <ul className="dashboard-card-list">
              {cardsState.data.map((item) => (
                <li key={item.id}>
                  <Link aria-label={`View ${item.card.name}`} to={`/cards/${item.printing_id}`}><CardImage name={item.card.name} imageUris={item.card.image_uris} /></Link>
                  <div><h3>{item.card.name}</h3><p>{item.card.set.code.toUpperCase()} · {item.finish} · {formatLabel(item.condition)}</p><span>{item.quantity} {item.quantity === 1 ? "copy" : "copies"}</span></div>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="dashboard-widget" aria-labelledby="recent-decks-heading">
          <div className="dashboard-widget-heading"><div><p className="eyebrow">Keep building</p><h2 id="recent-decks-heading">Recent decks</h2></div><Link className="dashboard-inline-action" to="/decks">See all</Link></div>
          {decksState.kind === "loading" && <p role="status">Loading recent decks…</p>}
          {decksState.kind === "error" && (
            <div className="dashboard-widget-state form-error" role="alert" aria-label="Recent decks unavailable">
              Could not load recent decks.
              <button className="text-button dashboard-widget-retry" type="button" onClick={() => setDecksRequest((value) => value + 1)}>Retry recent decks</button>
            </div>
          )}
          {recentDecks?.length === 0 && <p>No decks yet. Create one when you are ready to build.</p>}
          {recentDecks && recentDecks.length > 0 && (
            <ul className="dashboard-deck-list">
              {recentDecks.map((deck) => <li key={deck.id}><div><h3>{deck.name}</h3><p>{formatLabel(deck.format)}{deck.description ? ` · ${deck.description}` : ""}</p></div><Link aria-label={`Open ${deck.name}`} to={`/decks/${deck.id}`}>Open</Link></li>)}
            </ul>
          )}
        </article>

        <article className="dashboard-widget" aria-labelledby="top-sets-heading">
          <div className="dashboard-widget-heading"><div><p className="eyebrow">Collection shape</p><h2 id="top-sets-heading">Top sets</h2></div></div>
          {summaryState.kind === "loading" && <p role="status">Loading top sets…</p>}
          {summaryState.kind === "error" && <p>Top sets are unavailable with the collection summary.</p>}
          {summary && summary.sets.length === 0 && <p>Your most collected sets will appear here.</p>}
          {summary && summary.sets.length > 0 && <ol className="dashboard-set-list">{summary.sets.slice(0, 5).map((entry) => <li key={entry.code}><div><strong>{entry.name}</strong><span>{entry.distinct_items} unique</span></div><b>{entry.copies}</b></li>)}</ol>}
        </article>

        <article className="dashboard-widget" aria-labelledby="attention-heading">
          <div className="dashboard-widget-heading"><div><p className="eyebrow">Data quality</p><h2 id="attention-heading">Needs attention</h2></div></div>
          {summaryState.kind === "loading" && <p role="status">Checking collection coverage…</p>}
          {summaryState.kind === "error" && <p>Coverage is unavailable with the collection summary.</p>}
          {summary && (
            <ul className="dashboard-attention-list">
              {summary.total_copies === 0 ? (
                <li className="is-clear">
                  <strong>No collection pricing yet</strong>
                  <span>Add a card or import a collection to begin pricing checks.</span>
                </li>
              ) : (
                <>
                  <li className={summary.unpriced_copies ? "has-warning" : "is-clear"}>
                    {summary.unpriced_copies ? (
                      <Link to="/collection/pricing">
                        <strong>{summary.unpriced_copies} copies need pricing</strong>
                        <span>Value excludes copies without a current price.</span>
                      </Link>
                    ) : (
                      <><strong>Pricing coverage complete</strong><span>Every copy has a current price.</span></>
                    )}
                  </li>
                  {priceSnapshot && <li className={priceSnapshot.stale ? "has-warning" : "is-clear"}><strong>Price freshness</strong><span>{priceSnapshot.copy}</span></li>}
                </>
              )}
              <li className={catalogState.kind === "loaded" && catalogState.catalog.stale ? "has-warning" : "is-clear"}><strong>{view.chip}</strong><span>{view.summary}</span></li>
              {summary.finishes.slice(0, 2).map((entry) => <li className="is-clear" key={`finish-${entry.value}`}><strong>{formatLabel(entry.value)}</strong><span>{entry.copies} {entry.copies === 1 ? "copy" : "copies"} · finish</span></li>)}
              {summary.conditions.slice(0, 2).map((entry) => <li className="is-clear" key={`condition-${entry.value}`}><strong>{formatLabel(entry.value)}</strong><span>{entry.copies} {entry.copies === 1 ? "copy" : "copies"} · condition</span></li>)}
            </ul>
          )}
          {catalogState.kind === "unavailable" && <button className="text-button dashboard-widget-retry" type="button" onClick={() => setCatalogRequest((value) => value + 1)}>Retry catalog status</button>}
        </article>
      </div>
    </section>
  );
}
