import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { CardImage } from "../components/CardImage";
import { CatalogGameFilter } from "../components/CatalogGameFilter";
import { CatalogNotices } from "../components/CatalogNotices";
import { getAllCatalogSets, getCatalogStatus, searchCards } from "../lib/catalog";
import type { CardPage, CardSearchParams, CardSort, CatalogStatus, CardSet } from "../lib/types";
import { catalogGameName, selectedSetFromValue, setSelectionValue, setsForGame } from "../scanner/catalog-games";

const PAGE_SIZES = [25, 50, 75, 100] as const;
const EMPTY: CardSearchParams = { page: 1, page_size: 25 };
const RARITIES = ["common", "uncommon", "rare", "mythic", "special", "bonus"];
const COLORS = [["W", "White"], ["U", "Blue"], ["B", "Black"], ["R", "Red"], ["G", "Green"], ["C", "Colorless"]];
const FORMATS = ["standard", "pioneer", "modern", "legacy", "vintage", "commander", "pauper"];
const FINISHES = ["nonfoil", "foil", "etched", "glossy"];
const SORTS: Array<[CardSort, string]> = [["relevance", "Relevance"], ["name", "Name"], ["released", "Newest release"], ["set", "Set"], ["collector", "Collector number"], ["rarity", "Rarity"]];
function catalogDate(value: string | null) {
  if (!value) return "Waiting for first import";
  return `Catalog updated ${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value))}`;
}

function LoadingGrid() {
  return (
    <div className="catalog-loading" role="status" aria-label="Searching the catalog">
      <span className="visually-hidden">Searching the catalog</span>
      <div className="catalog-skeleton-grid" aria-hidden="true">
        {Array.from({ length: 8 }, (_, index) => (
          <div className="catalog-skeleton-card" key={index} />
        ))}
      </div>
    </div>
  );
}



export function CardsPage() {
  const [draft, setDraft] = useState(EMPTY);
  const [query, setQuery] = useState(EMPTY);
  const [status, setStatus] = useState<CatalogStatus | null>(null);
  const [sets, setSets] = useState<CardSet[]>([]);
  const [results, setResults] = useState<CardPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refinementsOpen, setRefinementsOpen] = useState(false);
  const catalogAvailable = Boolean(status?.ready) || sets.some(
    (set) => !draft.game || set.game === draft.game,
  );

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([getCatalogStatus(controller.signal), getAllCatalogSets(controller.signal)])
      .then(([nextStatus, nextSets]) => {
        setStatus(nextStatus);
        setSets(nextSets.items);
      })
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setError(reason.message);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery({ ...draft, page: 1 }), 250);
    return () => window.clearTimeout(timer);
  }, [draft.q, draft.set, draft.game, draft.collector, draft.rarity, draft.color, draft.type, draft.legality, draft.finish, draft.sort]);

  useEffect(() => {
    if (status && !catalogAvailable) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    searchCards(query, controller.signal)
      .then(setResults)
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setError(reason.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, catalogAvailable]);

  function setFilter(key: keyof CardSearchParams, value: string) {
    setDraft((current) => ({ ...current, [key]: value || undefined }));
  }

  function setGame(game: string) {
    setDraft((current) => {
      const compatibleSets = setsForGame(sets, game);
      const set = current.set && !compatibleSets.some((item) => item.code === current.set)
        ? undefined
        : current.set;
      return { ...current, game: game || undefined, set, page: 1 };
    });
  }

  function setCatalogSet(value: string) {
    const selectedSet = selectedSetFromValue(sets, value);
    setDraft((current) => ({
      ...current,
      set: selectedSet?.code || undefined,
      game: selectedSet ? selectedSet.game : current.game,
      page: 1,
    }));
  }

  function setPage(page: number) {
    const bounded = Math.max(1, Math.min(results?.pages || 1, page));
    setDraft((current) => ({ ...current, page: bounded }));
    setQuery((current) => ({ ...current, page: bounded }));
  }

  function setPageSize(pageSize: number) {
    setDraft((current) => ({ ...current, page: 1, page_size: pageSize }));
    setQuery((current) => ({ ...current, page: 1, page_size: pageSize }));
  }

  function clearFilters() {
    setDraft({ ...EMPTY });
    setQuery({ ...EMPTY });
  }

  const activeFilterLabels = [
    query.game && `Game: ${catalogGameName(query.game)}`,
    query.q && `Search: ${query.q}`,
    query.set && `Set: ${sets.find((item) =>
      item.code === query.set && (!query.game || item.game === query.game)
    )?.name ?? query.set}`,
    query.collector && `Collector number: ${query.collector}`,
    query.rarity && `Rarity: ${query.rarity}`,
    query.color && `Color: ${COLORS.find(([value]) => value === query.color)?.[1] ?? query.color}`,
    query.type && `Card type: ${query.type}`,
    query.legality && `Format legality: ${query.legality}`,
    query.finish && `Finish: ${query.finish}`,
    query.sort && query.sort !== "relevance" && `Sort: ${query.sort}`,
  ].filter((label): label is string => Boolean(label));
  const resultLabel = results ? `${results.total} ${results.total === 1 ? "card" : "cards"} found` : "";
  const selectedGame = draft.game ?? "";
  const selectableSets = setsForGame(sets, selectedGame);
  const selectedSet = sets.find((item) => item.code === draft.set && (!selectedGame || item.game === selectedGame));
  const selectedSetValue = selectedSet ? setSelectionValue(selectedSet) : "";
  const noticeGames = selectedGame
    ? [selectedGame]
    : [...new Set(results?.items.map((card) => card.set.game) ?? [])];


  return (
    <section className="catalog-page">
      <header className="catalog-hero">
        <div><p className="eyebrow">{selectedGame ? catalogGameName(selectedGame) : "All supported games"}</p><h1>{selectedGame ? `${catalogGameName(selectedGame)} card catalog` : "Card catalog"}</h1><p>Search supported-game printings stored privately by WynterLabs.</p></div>
        {status && <p className="freshness-chip">{catalogDate(status.source_updated_at)}</p>}
      </header>
      {status?.stale && <p className="catalog-warning" role="status">Catalog data may be out of date. The last working catalog remains available.</p>}
      {status && !catalogAvailable ? (
        <div className="state-panel"><h2>Catalog is being prepared</h2><p>Card search will appear after the first safe import completes.</p></div>
      ) : (
        <>
          <form className="catalog-filters" role="search" aria-label="Card catalog search" onSubmit={(event) => event.preventDefault()}>
            <fieldset className="catalog-search-group">
              <legend>Find cards</legend>
              <label>Search cards<input type="search" autoComplete="off" placeholder="Name, rules text, or type" value={draft.q ?? ""} onChange={(event) => setFilter("q", event.target.value)} /></label>
            </fieldset>
            <button
              type="button"
              className="catalog-refine-toggle"
              aria-expanded={refinementsOpen}
              aria-controls="catalog-refinements"
              onClick={() => setRefinementsOpen((open) => !open)}
            >Refine results <span aria-hidden="true">{refinementsOpen ? "-" : "+"}</span></button>
            <fieldset id="catalog-refinements" className={`catalog-refine-group${refinementsOpen ? " is-open" : ""}`}>
              <legend>Refine results</legend>
              <CatalogGameFilter value={draft.game ?? ""} onChange={setGame} idPrefix="cards" />
              <label>Set<select value={selectedSetValue} onChange={(event) => setCatalogSet(event.target.value)}><option value="">All sets</option>{selectableSets.map((item) => <option key={item.id} value={setSelectionValue(item)}>{item.name} ({catalogGameName(item.game)})</option>)}</select></label>
              <label>Rarity<select value={draft.rarity ?? ""} onChange={(event) => setFilter("rarity", event.target.value)}><option value="">All rarities</option>{RARITIES.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label>Color<select value={draft.color ?? ""} onChange={(event) => setFilter("color", event.target.value)}><option value="">All colors</option>{COLORS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>Card type<input value={draft.type ?? ""} onChange={(event) => setFilter("type", event.target.value)} /></label>
              <label>Format legality<select value={draft.legality ?? ""} onChange={(event) => setFilter("legality", event.target.value)}><option value="">Any format</option>{FORMATS.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label>Finish<select value={draft.finish ?? ""} onChange={(event) => setFilter("finish", event.target.value)}><option value="">Any finish</option>{FINISHES.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label>Collector number<input value={draft.collector ?? ""} onChange={(event) => setFilter("collector", event.target.value)} /></label>
              <label>Sort<select value={draft.sort ?? "relevance"} onChange={(event) => setFilter("sort", event.target.value)}>{SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            </fieldset>
          </form>
          <div className="catalog-toolbar">
            <p aria-live="polite">{!loading && !error ? resultLabel : ""}</p>
            <p>Showing printings, not unique card names</p>
          </div>
          {error ? <div className="state-panel compact"><p className="form-error" role="alert">{error}</p><p>Your last search is safe. Try again when the connection returns.</p></div> : loading ? <LoadingGrid /> : results?.items.length ? (
            <>
              <ul className="catalog-results" aria-label="Card search results">{results.items.map((card) => (
                <li key={card.printing_id}><article className="catalog-card"><Link aria-label={`View ${card.name} details`} to={`/cards/${card.printing_id}`}><CardImage name={card.name} imageUris={card.image_uris} /><div className="catalog-card-copy"><h2>{card.name}</h2><p className="catalog-game-badge">Game: {catalogGameName(card.set.game)}</p><p>{card.set.name} · {card.collector_number}</p><p>{card.type_line}</p><span className={`rarity rarity-${card.rarity}`}>{card.rarity}</span></div></Link></article></li>
              ))}</ul>
              <div className="catalog-results-footer">
                <nav className="catalog-pagination" aria-label="Card results pages"><button type="button" disabled={results.page <= 1} onClick={() => setPage(results.page - 1)}>Previous</button><span>Page {results.page} of {results.pages}</span><button type="button" disabled={results.page >= results.pages} onClick={() => setPage(results.page + 1)}>Next</button></nav>
                <label className="catalog-page-size">
                  Cards per page
                  <select value={query.page_size ?? 25} onChange={(event) => {
                    const pageSize = Number(event.target.value);
                    if (PAGE_SIZES.includes(pageSize as typeof PAGE_SIZES[number])) {
                      setPageSize(pageSize);
                    }
                  }}>
                    {PAGE_SIZES.map((pageSize) => <option key={pageSize} value={pageSize}>{pageSize}</option>)}
                  </select>
                </label>
              </div>
            </>
          ) : <div className="state-panel compact"><h2>No cards matched your search</h2>{activeFilterLabels.length > 0 ? <><p>These filters returned no cards: {activeFilterLabels.join(" · ")}.</p><button type="button" className="button ghost" onClick={clearFilters}>Clear filters</button></> : <p>Try a shorter name or remove one of the filters.</p>}</div>}
        </>
      )}
      <CatalogNotices games={noticeGames} />
    </section>
  );
}
