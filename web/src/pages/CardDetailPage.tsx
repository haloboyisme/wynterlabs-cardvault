import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { CardImage } from "../components/CardImage";
import { CatalogNotices } from "../components/CatalogNotices";
import { getCard, getPrintings } from "../lib/catalog";
import { addCollectionItem } from "../lib/collection";
import { marketplaceLinksForCard } from "../lib/marketplace";
import type { CardDetail, CollectionCondition, PrintingPage } from "../lib/types";

function words(value: string) {
  return value.replaceAll("_", " ");
}
function trustedScryfallSource(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const trustedHost = url.hostname === "scryfall.com" || url.hostname.endsWith(".scryfall.com");
    const trustedPort = url.port === "" || url.port === "443";
    if (url.protocol === "https:" && trustedHost && trustedPort && !url.username && !url.password) {
      return value;
    }
  } catch {
    // Invalid URLs do not get rendered as links.
  }
  return null;
}

function Price({ currency, value }: { currency: string; value: string }) {
  const symbol = currency.startsWith("usd") ? "$" : currency.startsWith("eur") ? "€" : "";
  return <li><span>{words(currency)}</span> <strong>{symbol}{value}</strong></li>;
}


const COLLECTION_CONDITIONS: Array<[CollectionCondition, string]> = [
  ["near_mint", "Near mint"], ["lightly_played", "Lightly played"],
  ["moderately_played", "Moderately played"], ["heavily_played", "Heavily played"],
  ["damaged", "Damaged"],
];

function AddToCollection({ card }: { card: CardDetail }) {
  const defaultFinish = card.finishes[0] ?? "";
  const [finish, setFinish] = useState(defaultFinish);
  const [condition, setCondition] = useState<CollectionCondition>("near_mint");
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const alertRef = useRef<HTMLParagraphElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await addCollectionItem({ printing_id: card.printing_id, finish, condition, quantity });
      setFinish(defaultFinish);
      setCondition("near_mint");
      setQuantity(1);
      setSuccess(`${card.name} was added to your collection.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The card could not be added.");
      queueMicrotask(() => alertRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  if (!card.finishes.length) return <section><h2>Add to collection</h2><p>No physical finish is available for this printing.</p></section>;
  return <section className="add-to-collection">
    <h2>Add to collection</h2>
    <p>Save this exact printing. Language: {card.language.toUpperCase()}.</p>
    <form onSubmit={(event) => void submit(event)}>
      <label>Collection finish<select value={finish} onChange={(event) => setFinish(event.target.value)}>
        {card.finishes.map((value) => <option value={value} key={value}>{words(value)}</option>)}
      </select></label>
      <label>Collection condition<select value={condition} onChange={(event) => setCondition(event.target.value as CollectionCondition)}>
        {COLLECTION_CONDITIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
      </select></label>
      <label>Collection quantity<input type="number" min="1" max="9999" required value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label>
      <button className="button primary" disabled={busy || !finish}>{busy ? "Adding..." : "Add to collection"}</button>
    </form>
    {error && <p className="form-error" role="alert" tabIndex={-1} ref={alertRef}>{error}</p>}
    {success && <p className="form-success" role="status">{success}</p>}
  </section>;
}
export function CardDetailPage() {
  const { printingId = "" } = useParams();
  const navigate = useNavigate();
  const [card, setCard] = useState<CardDetail | null>(null);
  const [printings, setPrintings] = useState<PrintingPage | null>(null);
  const [printingPage, setPrintingPage] = useState(1);
  const [error, setError] = useState("");
  const detailGeneration = useRef(0);
  const printingGeneration = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const generation = ++detailGeneration.current;
    setCard(null);
    setPrintings(null);
    setPrintingPage(1);
    setError("");
    getCard(printingId, controller.signal)
      .then((detail) => {
        if (generation === detailGeneration.current) setCard(detail);
      })
      .catch((reason: Error) => {
        if (generation === detailGeneration.current && reason.name !== "AbortError") setError(reason.message);
      });
    return () => controller.abort();
  }, [printingId]);

  useEffect(() => {
    if (!card) return;
    const controller = new AbortController();
    const generation = ++printingGeneration.current;
    getPrintings(card.oracle_id, printingPage, controller.signal)
      .then((page) => {
        if (generation === printingGeneration.current) setPrintings(page);
      })
      .catch((reason: Error) => {
        if (generation === printingGeneration.current && reason.name !== "AbortError") setError(reason.message);
      });
    return () => controller.abort();
  }, [card?.oracle_id, printingPage]);

  if (error) return <section className="state-panel"><p className="form-error" role="alert">{error}</p><Link className="button ghost" to="/cards">Back to cards</Link></section>;
  if (!card) return <section className="state-panel"><p role="status">Loading card details…</p></section>;

  const faces = card.faces.length ? card.faces : [{
    face_index: 0, name: card.name, mana_cost: card.mana_cost, type_line: card.type_line,
    oracle_text: card.oracle_text, colors: card.colors, image_uris: card.image_uris, artist: card.artist,
  }];
  const prices = Object.entries(card.prices).filter((entry): entry is [string, string] => Boolean(entry[1]));
  const printingItems = printings?.items ?? [];
  const printingOptions = printingItems.some((item) => item.printing_id === card.printing_id)
    ? printingItems : [card, ...printingItems];

  const sourceUri = trustedScryfallSource(card.source_uri);
  const marketplaceLinks = marketplaceLinksForCard({
    game: card.set.game,
    name: card.name,
    setCode: card.set.code,
    collectorNumber: card.collector_number,
  });
  return (
    <article className="card-detail-page">
      <Link to="/cards">← Back to card catalog</Link>
      <header><p className="eyebrow">{card.set.code.toUpperCase()} · {card.rarity}</p><h1>{card.name}</h1><p>{card.set.name} · Collector {card.collector_number} · {card.language.toUpperCase()}</p></header>
      <div className="card-detail-layout">
        <section className="card-face-gallery" aria-label="Card faces">{faces.map((face) => (
          <figure key={face.face_index}><CardImage name={face.name} imageUris={face.image_uris} /><figcaption>{face.name}</figcaption></figure>
        ))}</section>
        <div className="card-facts">
          {faces.map((face) => <section key={face.face_index}><h2>{face.name}</h2><p>{face.mana_cost}</p><p>{face.type_line}</p><p className="oracle-text">{face.oracle_text || "No rules text."}</p></section>)}
          <dl className="printing-facts">
            <div><dt>Artist</dt><dd>{card.artist || "Unknown"}</dd></div>
            <div><dt>Mana value</dt><dd>{card.cmc}</dd></div>
            <div><dt>Color identity</dt><dd>{card.color_identity.length ? card.color_identity.join(", ") : "Colorless"}</dd></div>
            <div><dt>Keywords</dt><dd>{card.keywords.length ? card.keywords.join(", ") : "None"}</dd></div>
            <div><dt>Finishes</dt><dd>{card.finishes.length ? card.finishes.map(words).join(", ") : "None listed"}</dd></div>
            <div><dt>Games</dt><dd>{card.games.length ? card.games.map(words).join(", ") : "None listed"}</dd></div>
            <div><dt>Digital</dt><dd>{card.digital ? "Yes" : "No"}</dd></div>
            <div><dt>Promo</dt><dd>{card.promo ? "Yes" : "No"}</dd></div>
            <div><dt>Frame</dt><dd>{card.frame ? words(card.frame) : "Not listed"}</dd></div>
            <div><dt>Border color</dt><dd>{card.border_color ? words(card.border_color) : "Not listed"}</dd></div>
            <div><dt>Image status</dt><dd>{card.image_status ? words(card.image_status) : "Not listed"}</dd></div>
            <div><dt>Price captured</dt><dd>{card.price_snapshot_at ? new Date(card.price_snapshot_at).toLocaleString() : "No snapshot date"}</dd></div>
          </dl>
          <p>{sourceUri ? <a href={sourceUri} target="_blank" rel="noreferrer">View source record</a> : "Source record unavailable."}</p>
          <AddToCollection key={card.printing_id} card={card} />
          <section><h2>Format legalities</h2><ul className="legality-list" aria-label="Format legalities">{Object.entries(card.legalities).map(([format, legality]) => <li data-legality={legality.replaceAll("_", "-")} key={format}><span>{words(format)}</span> <strong>{words(legality)}</strong></li>)}</ul></section>
          <section><h2>Price snapshot</h2>{prices.length ? <ul className="price-list">{prices.map(([currency, value]) => <Price key={currency} currency={currency} value={value} />)}</ul> : <p>No price snapshot available.</p>}<p>Prices are informational only and may be delayed.</p></section>
          <section className="marketplace-handoff"><h2>Find this printing</h2><p>Search third-party marketplaces for {card.set.code.toUpperCase()} · {card.collector_number}. Verify the exact printing, condition, and seller before buying or listing.</p><div className="button-row">{marketplaceLinks.map((link) => <a className="button ghost" href={link.href} target="_blank" rel="noreferrer" key={link.label}>{link.label}</a>)}</div><p className="muted">WynterLabs does not handle the sale, payment, shipping, seller contact, or marketplace account.</p></section>
          <section><h2>Printings</h2><label>Printing<select value={card.printing_id} onChange={(event) => navigate(`/cards/${event.target.value}`)}>{printingOptions.map((item) => <option key={item.printing_id} value={item.printing_id}>{item.set.name} · {item.collector_number}</option>)}</select></label>
          {printings && <nav aria-label="Printing pages"><button type="button" disabled={printings.page <= 1} onClick={() => setPrintingPage(printings.page - 1)}>Previous printings</button><span>Page {printings.page} of {printings.pages}</span><button type="button" disabled={printings.page >= printings.pages} onClick={() => setPrintingPage(printings.page + 1)}>Next printings</button></nav>}</section>
        </div>
      </div>
      <CatalogNotices games={[card.set.game]} />
    </article>
  );
}
