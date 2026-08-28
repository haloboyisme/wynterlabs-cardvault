import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { CardImage } from "../components/CardImage";
import { FeedbackBanner } from "../components/workspace/FeedbackBanner";
import { getMissingCollectionPrices, setManualCollectionPrice } from "../lib/collection";
import type { CollectionMissingPriceItem, CollectionMissingPricePage } from "../lib/types";

const label = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export function CollectionPricingPage() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CollectionMissingPricePage | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState("");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    getMissingCollectionPrices(page, controller.signal)
      .then(setData)
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setError(reason.message || "Missing prices could not be loaded.");
      });
    return () => controller.abort();
  }, [page]);

  const save = async (item: CollectionMissingPriceItem) => {
    const value = prices[item.id]?.trim() ?? "";
    if (!/^\d+(?:\.\d{1,2})?$/.test(value) || Number(value) > 999999.99) {
      setError("Enter a valid USD price with no more than two decimal places.");
      return;
    }
    setSavingId(item.id);
    setError("");
    setFeedback("");
    try {
      await setManualCollectionPrice(item.id, value, item.revision);
      setData((current) => current ? {
        ...current,
        items: current.items.filter((candidate) => candidate.id !== item.id),
        total: Math.max(0, current.total - 1),
      } : current);
      setFeedback("Price saved. Collection totals updated.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Price could not be saved.");
    } finally {
      setSavingId("");
    }
  };

  return (
    <section className="collection-pricing-page">
      <header className="workspace-page-header">
        <div><p className="eyebrow">Collection data quality</p><h1>Cards needing prices</h1>
          <p>Research the exact printing, then enter an informational USD value per copy.</p></div>
        <Link className="button" to="/dashboard">Back to dashboard</Link>
      </header>

      {feedback && <FeedbackBanner tone="success">{feedback}</FeedbackBanner>}
      {error && <FeedbackBanner tone="error">{error}</FeedbackBanner>}
      {!data && !error && <p role="status">Loading cards needing prices…</p>}
      {data && data.items.length === 0 && (
        <section className="state-panel"><h2>Every copy in this collection has a price</h2>
          <p>Your estimated collection value now includes every saved copy.</p>
          <Link className="button primary" to="/collection">View collection</Link></section>
      )}
      {data && data.items.length > 0 && (
        <>
          <p role="status">{data.total} {data.total === 1 ? "collection item needs" : "collection items need"} pricing.</p>
          <div className="collection-pricing-grid">
            {data.items.map((item) => (
              <article className="collection-pricing-card" key={item.id}>
                <CardImage name={item.card.name} imageUris={item.card.image_uris} />
                <div>
                  <p className="eyebrow">{item.card.set.code.toUpperCase()} · {item.card.collector_number}</p>
                  <h2>{item.card.name}</h2>
                  <p>{item.card.set.name} · {label(item.finish)} · {label(item.condition)}</p>
                  <p>{item.quantity} {item.quantity === 1 ? "copy" : "copies"}</p>
                  <div className="form-actions">
                    <Link
                      className="button"
                      to={`/cards/${item.printing_id}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Find a price for ${item.card.name}`}
                    >Find price</Link>
                  </div>
                  <label>
                    Manual USD price per copy for {item.card.name}
                    <input
                      type="number"
                      min="0"
                      max="999999.99"
                      step="0.01"
                      inputMode="decimal"
                      value={prices[item.id] ?? ""}
                      onChange={(event) => setPrices((current) => ({ ...current, [item.id]: event.target.value }))}
                    />
                  </label>
                  <button
                    className="button primary"
                    type="button"
                    disabled={savingId === item.id}
                    onClick={() => void save(item)}
                    aria-label={`Save price for ${item.card.name}`}
                  >{savingId === item.id ? "Saving…" : "Save price"}</button>
                </div>
              </article>
            ))}
          </div>
          {data.pages > 1 && <nav className="pagination" aria-label="Missing price pages">
            <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
            <span>Page {data.page} of {data.pages}</span>
            <button type="button" disabled={page >= data.pages} onClick={() => setPage((value) => value + 1)}>Next</button>
          </nav>}
        </>
      )}
    </section>
  );
}
