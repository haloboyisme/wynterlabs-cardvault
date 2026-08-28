import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { searchCards } from "../lib/catalog";
import { getCollection } from "../lib/collection";
import type { CardSummary, CollectionItem } from "../lib/types";
import {
  createTrade,
  createWant,
  deleteTrade,
  deleteWant,
  getTradeMatches,
  getTrades,
  getTradingAccount,
  getWants,
  reportTrade,
  type TradeListing,
  type TradeMatch,
  type TradingAccount,
  type WantListing,
} from "../lib/trading";

const REPORT_REASONS = [
  ["spam", "Spam"],
  ["scam", "Suspected scam"],
  ["misrepresentation", "Misrepresentation"],
  ["harassment", "Harassment"],
  ["other", "Other"],
] as const;

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export function TradingPage() {
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const [account, setAccount] = useState<TradingAccount | null>(null);
  const [collection, setCollection] = useState<CollectionItem[]>([]);
  const [trades, setTrades] = useState<TradeListing[]>([]);
  const [wants, setWants] = useState<WantListing[]>([]);
  const [matches, setMatches] = useState<TradeMatch[]>([]);
  const [collectionItemId, setCollectionItemId] = useState("");
  const [tradeQuantity, setTradeQuantity] = useState(1);
  const [wantQuery, setWantQuery] = useState("");
  const [wantCandidates, setWantCandidates] = useState<CardSummary[]>([]);
  const [reportListingId, setReportListingId] = useState("");
  const [reportReason, setReportReason] = useState("spam");
  const [reportDetails, setReportDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const current = ++generation.current;
    setLoading(true);
    try {
      const [nextAccount, nextCollection, nextTrades, nextWants, nextMatches] =
        await Promise.all([
          getTradingAccount(controller.signal),
          getCollection({ page: 1, page_size: 100 }, controller.signal),
          getTrades(controller.signal),
          getWants(controller.signal),
          getTradeMatches(controller.signal),
        ]);
      if (current !== generation.current || controller.signal.aborted) return;
      setAccount(nextAccount);
      setCollection(nextCollection.items);
      setTrades(nextTrades.items);
      setWants(nextWants.items);
      setMatches(nextMatches.items);
      setError("");
    } catch (reason) {
      if (current === generation.current && !isAbort(reason)) {
        setError(reason instanceof Error ? reason.message : "Private trades could not be loaded.");
      }
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      ++generation.current;
      request.current?.abort();
    };
  }, [load]);

  const suspended = account?.status === "suspended";

  async function mutate(action: () => Promise<unknown>, message: string) {
    if (busy || suspended) return;
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      await action();
      setFeedback(message);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The trading change could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  function offer(event: FormEvent) {
    event.preventDefault();
    if (!collectionItemId) return;
    void mutate(
      () => createTrade({ collection_item_id: collectionItemId, quantity: tradeQuantity }),
      "Card listed for trade.",
    );
  }

  async function findWanted(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await searchCards({ q: wantQuery, page: 1, page_size: 10 });
      setWantCandidates(result.items);
      if (!result.items.length) setError("No cards matched that search.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Card search failed.");
    } finally {
      setBusy(false);
    }
  }

  function addWant(card: CardSummary) {
    void mutate(
      () => createWant({
        oracle_id: card.oracle_id,
        printing_id: null,
        finish: null,
        condition: null,
        quantity: 1,
      }),
      `${card.name} added to wants.`,
    );
  }

  function submitReport(event: FormEvent) {
    event.preventDefault();
    void mutate(
      () => reportTrade({
        listing_id: reportListingId,
        reason: reportReason,
        details: reportDetails.trim() || null,
      }),
      "Report submitted for moderator review.",
    );
    setReportListingId("");
    setReportDetails("");
  }

  return (
    <article className="trading-page">
      <header>
        <p className="eyebrow">Private community</p>
        <h1>Private trades</h1>
        <p>List cards and find compatible wants. Matches show display names and card details only&mdash;no messaging or personal contact information.</p>
      </header>

      {loading && <p role="status">Loading private trades&hellip;</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {feedback && <p className="form-success" role="status">{feedback}</p>}

      {suspended && (
        <section className="trade-status suspended" aria-labelledby="trading-unavailable-heading">
          <h2 id="trading-unavailable-heading">Trading is unavailable</h2>
          <p>Your account, collection, and decks remain available.</p>
          <Link to="/account">Review trading status in Account</Link>
        </section>
      )}

      <div className="trading-grid">
        <section className="trade-panel" aria-labelledby="my-trades-heading">
          <h2 id="my-trades-heading">My trade list</h2>
          <form onSubmit={offer}>
            <label>Owned card
              <select value={collectionItemId} onChange={(event) => setCollectionItemId(event.target.value)} required disabled={suspended || busy}>
                <option value="">Choose a card</option>
                {collection.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.card.name} &middot; {item.card.set.code.toUpperCase()} &middot; {item.finish} &middot; {item.quantity} owned
                  </option>
                ))}
              </select>
            </label>
            <label>Quantity to offer
              <input type="number" min="1" max="9999" value={tradeQuantity} onChange={(event) => setTradeQuantity(Number(event.target.value))} disabled={suspended || busy} />
            </label>
            <button type="submit" disabled={suspended || busy || !collectionItemId}>List card for trade</button>
          </form>
          {!trades.length && <p>No cards listed for trade.</p>}
          <ul className="trade-list">
            {trades.map((trade) => (
              <li key={trade.id}>
                <strong>{trade.card_name}</strong>
                <span>{trade.set_code.toUpperCase()} #{trade.collector_number} &middot; {trade.finish} &middot; {trade.condition}</span>
                <span>{trade.quantity} offered of {trade.owned_quantity} owned &middot; {trade.status}</span>
                {trade.status === "active" && (
                  <button type="button" disabled={suspended || busy} onClick={() => {
                    if (confirm(`Remove ${trade.card_name} from your trade list?`)) {
                      void mutate(() => deleteTrade(trade.id, trade.revision), "Trade listing removed.");
                    }
                  }}>Remove {trade.card_name}</button>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="trade-panel" aria-labelledby="wants-heading">
          <h2 id="wants-heading">My wants</h2>
          <form onSubmit={(event) => void findWanted(event)}>
            <label>Find a card to want
              <input value={wantQuery} onChange={(event) => setWantQuery(event.target.value)} minLength={2} required disabled={suspended || busy} />
            </label>
            <button type="submit" disabled={suspended || busy}>Search cards</button>
          </form>
          {wantCandidates.length > 0 && (
            <ul className="want-candidates">
              {wantCandidates.map((card) => (
                <li key={card.printing_id}>
                  <span>{card.name} &middot; {card.set.name}</span>
                  <button type="button" disabled={suspended || busy} onClick={() => addWant(card)}>Want any printing</button>
                </li>
              ))}
            </ul>
          )}
          {!wants.length && <p>No wanted cards yet.</p>}
          <ul className="trade-list">
            {wants.map((want) => (
              <li key={want.id}>
                <strong>{want.card_name}</strong>
                <span>{want.quantity} wanted &middot; {want.status}</span>
                {want.status === "active" && (
                  <button type="button" disabled={suspended || busy} onClick={() => {
                    if (confirm(`Remove ${want.card_name} from wants?`)) {
                      void mutate(() => deleteWant(want.id, want.revision), "Want removed.");
                    }
                  }}>Remove wanted {want.card_name}</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="trade-panel trade-matches" aria-labelledby="matches-heading">
        <h2 id="matches-heading">Compatible member cards</h2>
        <p>These members explicitly listed a compatible card. Contact and messaging are not available in Phase 5.</p>
        {!matches.length && !loading && <p>No compatible cards are listed right now.</p>}
        <ul className="trade-match-grid">
          {matches.map((match) => (
            <li key={match.listing_id}>
              <strong>{match.card_name}</strong>
              <span>{match.set_name} ({match.set_code.toUpperCase()}) #{match.collector_number}</span>
              <span>{match.finish} &middot; {match.condition} &middot; {match.available_quantity} available</span>
              <span>Listed by <strong>{match.member_display_name}</strong></span>
              <button type="button" disabled={suspended || busy} onClick={() => setReportListingId(match.listing_id)}>Report listing</button>
            </li>
          ))}
        </ul>
      </section>

      {reportListingId && (
        <form className="trade-panel report-form" onSubmit={submitReport}>
          <h2>Report a trade listing</h2>
          <label>Report reason
            <select value={reportReason} disabled={suspended || busy} onChange={(event) => setReportReason(event.target.value)}>
              {REPORT_REASONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>
          <label>Incident details
            <textarea maxLength={1000} value={reportDetails} disabled={suspended || busy} onChange={(event) => setReportDetails(event.target.value)} />
          </label>
          <button type="submit" disabled={suspended || busy}>Submit report</button>
          <button type="button" onClick={() => setReportListingId("")}>Cancel</button>
        </form>
      )}
    </article>
  );
}
