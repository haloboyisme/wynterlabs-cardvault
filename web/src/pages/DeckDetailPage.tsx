import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { CardImage } from "../components/CardImage";
import { ApiError } from "../lib/api";
import { searchCards } from "../lib/catalog";
import {
  formatsForGame, getDeck, removeDeckCard, sectionsForFormat, setDeckCard,
  updateDeck, updateDeckCard,
} from "../lib/decks";
import type {
  CardSummary, DeckCard, DeckDetail, DeckFormat, DeckSection,
} from "../lib/types";
import { catalogGameName } from "../scanner/catalog-games";

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function message(reason: unknown) {
  return reason instanceof Error ? reason.message : "The request could not be completed.";
}

interface CardEdit {
  id: string;
  section: DeckSection;
  quantity: number;
}
interface AddChoice {
  section: DeckSection;
  quantity: number;
}
interface MutationContext {
  controller: AbortController;
  generation: number;
  originDeckId: string;
}

export function DeckDetailPage() {
  const { deckId = "" } = useParams();
  const [deck, setDeck] = useState<DeckDetail | null>(null);
  const [error, setError] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [busy, setBusy] = useState("");
  const [editingDetails, setEditingDetails] = useState(false);
  const [name, setName] = useState("");
  const [format, setFormat] = useState<DeckFormat>("modern");
  const [description, setDescription] = useState("");
  const [edit, setEdit] = useState<CardEdit | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CardSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchPage, setSearchPage] = useState(1);
  const [searchPages, setSearchPages] = useState(0);
  const [searchTotal, setSearchTotal] = useState(0);
  const [lastSearch, setLastSearch] = useState("");
  const [choices, setChoices] = useState<Record<string, AddChoice>>({});
  const loadGeneration = useRef(0);
  const searchGeneration = useRef(0);
  const mutationGeneration = useRef(0);
  const mutationActive = useRef(false);
  const routeDeckId = useRef(deckId);
  const searchController = useRef<AbortController | null>(null);
  const mutationController = useRef<AbortController | null>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);

  const refresh = useCallback(() => setRetryKey((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const routeChanged = routeDeckId.current !== deckId;
    routeDeckId.current = deckId;
    if (routeChanged) {
      mutationController.current?.abort();
      mutationGeneration.current += 1;
      mutationActive.current = false;
      searchController.current?.abort();
      searchGeneration.current += 1;
      setDeck(null);
      setBusy("");
      setEditingDetails(false);
      setResults([]);
      setLastSearch("");
      setSearching(false);
      setSearchError("");
      setMutationError("");
      setFeedback("");
      setChoices({});
      setEdit(null);
      setSearchPages(0);
      setSearchTotal(0);
    }
    const generation = ++loadGeneration.current;
    setError("");
    getDeck(deckId, controller.signal)
      .then((result) => {
        if (generation !== loadGeneration.current) return;
        setDeck(result);
        setName(result.name);
        setFormat(result.format);
        setDescription(result.description ?? "");
        setMutationError("");
      })
      .catch((reason: Error) => {
        if (generation === loadGeneration.current && reason.name !== "AbortError") {
          setError(message(reason));
        }
      });
    return () => controller.abort();
  }, [deckId, retryKey]);

  useEffect(() => () => {
    searchController.current?.abort();
    mutationController.current?.abort();
    searchGeneration.current += 1;
    mutationGeneration.current += 1;
    mutationActive.current = false;
  }, []);

  useEffect(() => {
    if (error || mutationError) alertRef.current?.focus();
  }, [error, mutationError]);

  function applyDetail(result: DeckDetail, success: string) {
    setDeck(result);
    setName(result.name);
    setFormat(result.format);
    setDescription(result.description ?? "");
    setFeedback(success);
    setMutationError("");
  }

  function beginMutation(): MutationContext | null {
    if (mutationActive.current) return null;
    mutationActive.current = true;
    const controller = new AbortController();
    mutationController.current = controller;
    return {
      controller,
      generation: ++mutationGeneration.current,
      originDeckId: deckId,
    };
  }

  function mutationIsCurrent(generation: number, originDeckId: string) {
    return generation === mutationGeneration.current &&
      originDeckId === routeDeckId.current;
  }

  function finishMutation(context: MutationContext) {
    if (!mutationIsCurrent(context.generation, context.originDeckId)) return;
    mutationActive.current = false;
    mutationController.current = null;
    setBusy("");
  }

  async function handleMutationError(
    reason: unknown,
    context: MutationContext,
  ) {
    if (!mutationIsCurrent(context.generation, context.originDeckId) ||
      (reason as Error).name === "AbortError") return;
    const stale = reason instanceof ApiError && reason.status === 409;
    if (!stale) {
      setMutationError(message(reason));
      return;
    }
    const staleMessage = message(reason);
    setMutationError(`${staleMessage} Refreshing the current deck...`);
    try {
      const current = await getDeck(context.originDeckId, context.controller.signal);
      if (!mutationIsCurrent(context.generation, context.originDeckId)) return;
      applyDetail(current, "");
      setMutationError(`${staleMessage} Current deck refreshed.`);
    } catch (refreshReason) {
      if (!mutationIsCurrent(context.generation, context.originDeckId) ||
        (refreshReason as Error).name === "AbortError") return;
      setMutationError(`${staleMessage} Refresh failed: ${message(refreshReason)}`);
    }
  }

  async function saveDetails(event: React.FormEvent) {
    event.preventDefault();
    if (!deck || !name.trim()) return;
    const context = beginMutation();
    if (!context) return;
    setBusy("details");
    setMutationError("");
    setFeedback("");
    try {
      await updateDeck(context.originDeckId, {
        name: name.trim(), format, description: description.trim() || null,
        expected_revision: deck.revision,
      }, context.controller.signal);
      const current = await getDeck(context.originDeckId, context.controller.signal);
      if (!mutationIsCurrent(context.generation, context.originDeckId)) return;
      applyDetail(current, "Deck details saved.");
      setEditingDetails(false);
    } catch (reason) {
      await handleMutationError(reason, context);
    } finally {
      finishMutation(context);
    }
  }

  async function search(event: React.FormEvent) {
    event.preventDefault();
    const clean = query.trim();
    if (!clean) return;
    setLastSearch(clean);
    await runSearch(clean, 1);
  }

  async function runSearch(clean: string, page: number) {
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    const generation = ++searchGeneration.current;
    setSearching(true);
    setSearchError("");
    try {
      const result = await searchCards({
        q: clean,
        game: deck?.game || "mtg",
        page,
        page_size: 25,
      }, controller.signal);
      if (generation !== searchGeneration.current) return;
      setResults(result.items);
      setSearchPage(result.page);
      setSearchPages(result.pages);
      setSearchTotal(result.total);
      const firstSection = deck ? sectionsForFormat(deck.format)[0] : "mainboard";
      setChoices(Object.fromEntries(result.items.map((item) => [
        item.printing_id, { section: firstSection, quantity: 1 },
      ])));
    } catch (reason) {
      if (generation === searchGeneration.current &&
        (reason as Error).name !== "AbortError") {
        setSearchError(message(reason));
      }
    } finally {
      if (generation === searchGeneration.current) setSearching(false);
    }
  }

  async function add(card: CardSummary) {
    if (!deck) return;
    const choice = choices[card.printing_id] ?? {
      section: sectionsForFormat(deck.format)[0], quantity: 1,
    };
    const context = beginMutation();
    if (!context) return;
    setBusy(card.printing_id);
    setFeedback("");
    setMutationError("");
    try {
      await setDeckCard(context.originDeckId, {
        printing_id: card.printing_id,
        section: choice.section,
        quantity: choice.quantity,
      }, context.controller.signal);
      const result = await getDeck(context.originDeckId, context.controller.signal);
      if (!mutationIsCurrent(context.generation, context.originDeckId)) return;
      applyDetail(result, `${card.name} added to ${label(choice.section)}.`);
    } catch (reason) {
      await handleMutationError(reason, context);
    } finally {
      finishMutation(context);
    }
  }

  async function saveCard(card: DeckCard) {
    if (!deck || !edit) return;
    const context = beginMutation();
    if (!context) return;
    setBusy(card.id);
    setFeedback("");
    setMutationError("");
    try {
      await updateDeckCard(context.originDeckId, card.id, {
        section: edit.section, quantity: edit.quantity,
        expected_revision: card.revision,
      }, context.controller.signal);
      const result = await getDeck(context.originDeckId, context.controller.signal);
      if (!mutationIsCurrent(context.generation, context.originDeckId)) return;
      applyDetail(result, `${card.card.name} updated.`);
      setEdit(null);
    } catch (reason) {
      await handleMutationError(reason, context);
    } finally {
      finishMutation(context);
    }
  }

  async function remove(card: DeckCard) {
    if (!deck || !window.confirm(`Remove ${card.card.name} from this deck?`)) return;
    const context = beginMutation();
    if (!context) return;
    setBusy(card.id);
    setFeedback("");
    setMutationError("");
    try {
      await removeDeckCard(context.originDeckId, card, context.controller.signal);
      const current = await getDeck(context.originDeckId, context.controller.signal);
      if (!mutationIsCurrent(context.generation, context.originDeckId)) return;
      applyDetail(current, `${card.card.name} removed.`);
    } catch (reason) {
      await handleMutationError(reason, context);
    } finally {
      finishMutation(context);
    }
  }

  if (!deck && !error) return <section className="deck-detail-page"><p role="status">Loading deck...</p></section>;
  if (!deck) return <section className="deck-detail-page"><p className="form-error" role="alert">{error} <button className="text-button" onClick={refresh}>Retry</button></p></section>;
  const sections = sectionsForFormat(deck.format);
  const mutationBusy = busy !== "";

  return (
    <section className="deck-detail-page">
      <Link to="/decks">Back to decks</Link>
      <header className="deck-detail-hero">
        <div><p className="eyebrow">{catalogGameName(deck.game || "mtg")} · {label(deck.format)}</p><h1>{deck.name}</h1><p>{deck.description || "No description."}</p></div>
        <dl><div><dt>Mainboard</dt><dd>{deck.mainboard_count}</dd></div><div><dt>Sideboard</dt><dd>{deck.sideboard_count}</dd></div></dl>
      </header>

      <button type="button" className="button ghost" disabled={mutationBusy} onClick={() => setEditingDetails((value) => !value)}>Edit deck details</button>
      {editingDetails && <form className="deck-details-form" onSubmit={(event) => void saveDetails(event)}>
        <label>Deck name<input value={name} disabled={mutationBusy} required maxLength={120} onChange={(event) => setName(event.target.value)} /></label>
        <label>Format<select value={format} disabled={mutationBusy} onChange={(event) => setFormat(event.target.value as DeckFormat)}>
          {formatsForGame(deck.game || "mtg").map((value) => <option value={value} key={value}>{label(value)}</option>)}
        </select></label>
        <label>Description<textarea value={description} disabled={mutationBusy} maxLength={2000} onChange={(event) => setDescription(event.target.value)} /></label>
        <button className="button primary" disabled={mutationBusy}>Save deck details</button>
      </form>}

      {mutationError && <p className="form-error" role="alert" aria-label="Deck error" tabIndex={-1} ref={alertRef}>
        {mutationError}
        {mutationError.includes("Refresh failed") &&
          <button className="text-button" type="button" onClick={refresh}>Retry</button>}
      </p>}
      {error && <p className="form-error" role="alert">
        {error} <button className="text-button" type="button" onClick={refresh}>Retry</button>
      </p>}
      {feedback && <p className="form-success" role="status">{feedback}</p>}

      {deck.warnings.length > 0 && <section className="deck-warnings" aria-label="Deck warnings">
        <h2>Deck checks</h2>
        {deck.warnings.map((warning, index) => <p role="alert" aria-label="Deck warning" key={`${warning.code}-${warning.printing_id}-${index}`}>{warning.message}</p>)}
      </section>}

      <section className="deck-catalog-search" aria-labelledby="add-card-heading">
        <h2 id="add-card-heading">Add exact printings</h2>
        <form onSubmit={(event) => void search(event)}>
          <label>Search card catalog<input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <button className="button primary">Search printings</button>
        </form>
        {searchError && <p className="form-error" role="alert">{searchError}</p>}
        {searching && <p role="status">Searching printings...</p>}
        {lastSearch && !searching && !searchError && searchTotal === 0 &&
          <p>No printings found for this search.</p>}
        {searchTotal > 0 && <nav className="pagination" aria-label="Search result pages">
          <button type="button" disabled={searchPage <= 1} onClick={() => void runSearch(lastSearch, searchPage - 1)}>Previous search page</button>
          <span>Page {searchPage} of {searchPages}</span>
          <button type="button" disabled={searchPage >= searchPages} onClick={() => void runSearch(lastSearch, searchPage + 1)}>Next search page</button>
        </nav>}
        {results.length > 0 && <ul className="deck-search-results">{results.map((card) => {
          const choice = choices[card.printing_id] ?? { section: sections[0], quantity: 1 };
          return <li key={card.printing_id}><article>
            <CardImage name={card.name} imageUris={card.image_uris} />
            <div><h3>{card.name}</h3><p>{card.set.name} · {card.collector_number} · {card.language.toUpperCase()}</p>
              <label>Section for {card.name}<select value={choice.section} disabled={mutationBusy} onChange={(event) => setChoices({ ...choices, [card.printing_id]: { ...choice, section: event.target.value as DeckSection } })}>
                {sections.map((section) => <option value={section} key={section}>{label(section)}</option>)}
              </select></label>
              <label>Quantity to add for {card.name}<input type="number" disabled={mutationBusy} min="1" max="9999" value={choice.quantity} onChange={(event) => setChoices({ ...choices, [card.printing_id]: { ...choice, quantity: Number(event.target.value) } })} /></label>
              <button type="button" className="button primary" disabled={mutationBusy || !card.active} onClick={() => void add(card)}>Add {card.name}</button>
              {!card.active && <p className="inactive-printing">Inactive printing</p>}
            </div>
          </article></li>;
        })}</ul>}
      </section>

      <section className="deck-board" aria-labelledby="saved-cards-heading">
        <h2 id="saved-cards-heading">Saved cards</h2>
        {deck.cards.length === 0 && <p>No cards in this deck yet.</p>}
        {sections.map((section) => {
          const cards = deck.cards.filter((card) => card.section === section);
          if (!cards.length) return null;
          return <section className="deck-section" key={section}><h3>{label(section)}</h3><ul>{cards.map((card) => {
            const shortage = Math.max(0, card.quantity - card.owned_quantity);
            const editing = edit?.id === card.id;
            return <li key={card.id}><article>
              <CardImage name={card.card.name} imageUris={card.card.image_uris} />
              <div><h4>{card.card.name}</h4><p>{card.card.set.name} · {card.card.collector_number}</p>
                {!card.card.active && <p className="inactive-printing">Inactive printing retained</p>}
                <p><strong>{card.quantity}</strong> saved · <span className="owned-badge">{card.owned_quantity} owned</span>{shortage > 0 && <span className="shortage-badge"> · {shortage} short</span>}</p>
                {editing ? <form className="deck-card-edit" onSubmit={(event) => { event.preventDefault(); void saveCard(card); }}>
                  <label>Section for saved {card.card.name}<select value={edit.section} disabled={mutationBusy} onChange={(event) => setEdit({ ...edit, section: event.target.value as DeckSection })}>
                    {sections.map((value) => <option value={value} key={value}>{label(value)}</option>)}
                  </select></label>
                  <label>Quantity for {card.card.name}<input type="number" disabled={mutationBusy} min="1" max="9999" value={edit.quantity} onChange={(event) => setEdit({ ...edit, quantity: Number(event.target.value) })} /></label>
                  <button className="button primary" disabled={mutationBusy}>Save {card.card.name}</button><button type="button" className="button ghost" disabled={mutationBusy} onClick={() => setEdit(null)}>Cancel</button>
                </form> : <div className="deck-card-actions">
                  <button type="button" className="button ghost" disabled={mutationBusy} onClick={() => setEdit({ id: card.id, section: card.section, quantity: card.quantity })}>Edit {card.card.name}</button>
                  <button type="button" className="button ghost" disabled={mutationBusy} onClick={() => void remove(card)}>Remove {card.card.name}</button>
                </div>}
              </div>
            </article></li>;
          })}</ul></section>;
        })}
      </section>
    </section>
  );
}
