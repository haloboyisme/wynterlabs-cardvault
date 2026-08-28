import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { DisclosurePanel } from "../components/workspace/DisclosurePanel";
import { EmptyState } from "../components/workspace/EmptyState";
import { FeedbackBanner } from "../components/workspace/FeedbackBanner";
import { PageHeader } from "../components/workspace/PageHeader";
import { StatTile } from "../components/workspace/StatTile";
import { ApiError } from "../lib/api";
import { readAppearance } from "../lib/appearance";
import { createDeck, DECK_FORMATS, deleteDeck, formatsForGame, listDecks } from "../lib/decks";
import type { Deck, DeckFormat, DeckPage } from "../lib/types";
import { CATALOG_GAMES, catalogGameName } from "../scanner/catalog-games";

function title(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function message(reason: unknown) {
  return reason instanceof Error ? reason.message : "The request could not be completed.";
}

function updatedText(value: string) {
  const updated = Date.parse(value);
  const absolute = new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  if (!Number.isFinite(updated)) return absolute;
  const days = Math.round((updated - Date.now()) / 86_400_000);
  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(days, "day");
  return `${relative} · ${absolute}`;
}

export function DecksPage() {
  const [data, setData] = useState<DeckPage | null>(null);
  const [name, setName] = useState("");
  const [game, setGame] = useState("mtg");
  const [format, setFormat] = useState<DeckFormat>("commander");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [query, setQuery] = useState("");
  const [formatFilter, setFormatFilter] = useState<DeckFormat | "">("");
  const [sort, setSort] = useState<"updated" | "name">("updated");
  const generation = useRef(0);
  const alertRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => setRetryKey((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const request = ++generation.current;
    setError("");
    listDecks(controller.signal)
      .then((result) => {
        if (request === generation.current) setData(result);
      })
      .catch((reason: Error) => {
        if (request === generation.current && reason.name !== "AbortError") {
          setError(message(reason));
        }
      });
    return () => controller.abort();
  }, [retryKey]);

  useEffect(() => {
    if (error || mutationError) alertRef.current?.focus();
  }, [error, mutationError]);

  const deckItems = data?.items ?? [];
  const formatCounts = useMemo(() => {
    const counts = new Map<DeckFormat, number>();
    for (const deck of deckItems) counts.set(deck.format, (counts.get(deck.format) ?? 0) + 1);
    return counts;
  }, [deckItems]);
  const visibleDecks = useMemo(() => {
    const cleanQuery = query.trim().toLocaleLowerCase();
    return [...deckItems]
      .filter((deck) => !cleanQuery || deck.name.toLocaleLowerCase().includes(cleanQuery))
      .filter((deck) => !formatFilter || deck.format === formatFilter)
      .sort((a, b) => sort === "name"
        ? a.name.localeCompare(b.name)
        : Date.parse(b.updated_at) - Date.parse(a.updated_at));
  }, [deckItems, formatFilter, query, sort]);
  const recentlyUpdated = deckItems.filter((deck) => {
    const age = Date.now() - Date.parse(deck.updated_at);
    return age >= 0 && age <= 30 * 86_400_000;
  }).length;
  const creationOpen = readAppearance().complexity === "advanced" || !data?.total;
  const creationFormats = formatsForGame(game);

  function resetDeckFilters() {
    setQuery("");
    setFormatFilter("");
    setSort("updated");
  }

  function changeGame(nextGame: string) {
    const formats = formatsForGame(nextGame);
    setGame(nextGame);
    setFormat((current) => formats.includes(current) ? current : formats[0]!);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return;
    setBusy(true);
    setMutationError("");
    setFeedback("");
    try {
      const created = await createDeck({
        name: cleanName,
        game,
        format,
        description: description.trim() || null,
      });
      setName("");
      setDescription("");
      setFeedback(`${created.name} created.`);
      refresh();
    } catch (reason) {
      setMutationError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  async function remove(deck: Deck) {
    if (!window.confirm(`Delete ${deck.name}? This removes its saved card list.`)) return;
    setBusy(true);
    setMutationError("");
    setFeedback("");
    try {
      await deleteDeck(deck.id, deck.revision);
      setFeedback(`${deck.name} deleted.`);
      refresh();
    } catch (reason) {
      const stale = reason instanceof ApiError && reason.status === 409;
      setMutationError(stale ? `${message(reason)} The deck list has been refreshed.` : message(reason));
      if (stale) refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="decks-page">
      <PageHeader
        eyebrow="Private deck builder"
        description="Build exact printing lists with ownership and format checks."
      >
        Decks
      </PageHeader>

      <section className="deck-overview" aria-label="Deck overview">
        <StatTile label="Saved decks" value={`${data?.total ?? 0} saved decks`} detail="Private to your account" />
        <StatTile
          label="Formats"
          value={`${formatCounts.size} formats`}
          detail={Array.from(formatCounts.entries())
            .sort(([left], [right]) => title(left).localeCompare(title(right)))
            .map(([deckFormat, count]) => <span key={deckFormat}>{title(deckFormat)} · {count}</span>)}
        />
        <StatTile label="Recently updated" value={recentlyUpdated} detail="Changed in the last 30 days" />
      </section>

      <DisclosurePanel title="Create a deck" defaultOpen={creationOpen} className="deck-create-card">
        <form onSubmit={(event) => void submit(event)}>
          <label>Deck name<input value={name} maxLength={120} required onChange={(event) => setName(event.target.value)} /></label>
          <label>Game<select value={game} onChange={(event) => changeGame(event.target.value)}>
            {CATALOG_GAMES.map((value) => <option value={value.id} key={value.id}>{value.name}</option>)}
          </select></label>
          <label>Format<select value={format} onChange={(event) => setFormat(event.target.value as DeckFormat)}>
            {creationFormats.map((value) => <option value={value} key={value}>{title(value)}</option>)}
          </select></label>
          <label className="deck-description">Description<textarea value={description} maxLength={2000} onChange={(event) => setDescription(event.target.value)} /></label>
          <button className="button primary" disabled={busy}>Create deck</button>
        </form>
      </DisclosurePanel>

      {(error || mutationError) && <div className="deck-feedback-focus" tabIndex={-1} ref={alertRef}>
        <FeedbackBanner tone="error">
          {mutationError || error} {error && <button type="button" className="text-button" onClick={refresh}>Retry</button>}
        </FeedbackBanner>
      </div>}
      {feedback && <FeedbackBanner tone="success" className="deck-feedback">{feedback}</FeedbackBanner>}
      {!data && !error && <p role="status">Loading decks...</p>}
      {data?.items.length === 0 && <EmptyState title="No decks yet." description="Create your first deck above." />}

      {data && data.items.length > 0 && <section className="deck-browser" aria-label="Find a saved deck">
        <div className="deck-filter-bar">
          <label>Search decks<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <label>Format filter<select value={formatFilter} onChange={(event) => setFormatFilter(event.target.value as DeckFormat | "")}>
            <option value="">All formats</option>
            {DECK_FORMATS.map((value) => <option value={value} key={value}>{title(value)}</option>)}
          </select></label>
          <label>Sort decks<select value={sort} onChange={(event) => setSort(event.target.value as "updated" | "name")}>
            <option value="updated">Recently updated</option>
            <option value="name">Name</option>
          </select></label>
          <button type="button" className="button ghost" aria-label="Reset deck filters" onClick={resetDeckFilters}>Reset</button>
        </div>
        <p className="deck-result-feedback" role="status">
          Showing {visibleDecks.length} of {deckItems.length} saved decks.
        </p>
      </section>}

      {data && data.items.length > 0 && visibleDecks.length === 0 && (
        <EmptyState title="No decks match these filters." description="Change or reset the local filters to see your saved decks.">
          <button type="button" className="button ghost" onClick={resetDeckFilters}>Reset deck filters</button>
        </EmptyState>
      )}

      {visibleDecks.length > 0 && <ul className="deck-list" aria-label="Saved decks">
        {visibleDecks.map((deck) => <li key={deck.id}><article>
          <div>
            <p className="deck-format-chip">{title(deck.format)}</p>
            <p className="deck-game-chip">{catalogGameName(deck.game || "mtg")}</p>
            <h2>{deck.name}</h2>
            <p>{deck.description || "No description."}</p>
            <small>Updated {updatedText(deck.updated_at)}</small>
          </div>
          <div className="deck-list-actions">
            <Link className="button primary" to={`/decks/${deck.id}`} aria-label={`Open ${deck.name}`}>Open deck</Link>
            <button type="button" className="button ghost" disabled={busy} aria-label={`Delete ${deck.name}`} onClick={() => void remove(deck)}>Delete</button>
          </div>
        </article></li>)}
      </ul>}
    </section>
  );
}
