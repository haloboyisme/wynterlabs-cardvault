import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { marketplaceLinksForCard } from "../lib/marketplace";
import type { CollectionItem } from "../lib/types";

type Quote = { variant: string; low: string | null; mid: string | null; high: string | null; market: string | null };
export type PriceDetails = {
  unit_estimate_usd: string | null; quantity_estimate_usd: string | null; estimate_source: string;
  catalog_updated_at: string | null; provider: string; provider_updated_at: string | null;
  checked_at: string | null; stale: boolean; product_id: number | null; quotes: Quote[];
  sync_status: string; completed_sales_available: boolean;
};
const usd = (value: string | number | null) => value !== null && Number.isFinite(Number(value))
  ? new Intl.NumberFormat("en-US", {style:"currency",currency:"USD"}).format(Number(value)) : "Unavailable";
const date = (value: string | null) => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(new Date(value)) : "Not supplied";

export function CollectionPriceDetails({ item }: { item: CollectionItem }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<PriceDetails | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setData(null); setError("");
    apiRequest<PriceDetails>(`/api/v1/collection/items/${item.id}/price-details`, {signal:controller.signal})
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Pricing could not be loaded."); });
    return () => controller.abort();
  }, [open, item.id, item.revision, retry]);
  const query = new URLSearchParams({_nkw: [item.card.name,item.card.set.name,item.card.collector_number,item.finish.replaceAll("_"," ")].join(" "),LH_Sold:"1",LH_Complete:"1"});
  return <div className="collection-price-details">
    <button type="button" className="collection-details-toggle" aria-expanded={open} aria-controls={`${item.id}-prices`}
      aria-label={`Price details for ${item.card.name}`} onClick={() => setOpen(!open)}>{open ? "Close price details" : "Price details"}</button>
    {open && <section id={`${item.id}-prices`} className="collection-detail-bubble" aria-label={`${item.card.name} price comparison`}>
      <h3>Price comparison</h3>
      <p>{item.card.set.name} · #{item.card.collector_number} · {item.finish.replaceAll("_"," ")} · {item.condition.replaceAll("_"," ")}</p>
      {error ? <div role="alert">{error} <button type="button" onClick={() => setRetry(retry + 1)}>Retry pricing</button></div>
        : !data ? <p role="status">Loading price details…</p> : <>
          <dl className="collection-price-totals"><div><dt>Collection estimate per copy</dt><dd>{usd(data.unit_estimate_usd)}</dd></div>
            <div><dt>Your {item.quantity} {item.quantity === 1 ? "copy" : "copies"}</dt><dd>{usd(data.quantity_estimate_usd)}</dd></div></dl>
          <p className="collection-price-note">{data.estimate_source}. Catalog price timestamp: {date(data.catalog_updated_at)}.</p>
          {data.quotes.length ? <>
            <p><strong>{data.provider}</strong> · USD per copy</p>
            <div className="collection-price-table-wrap" tabIndex={0} role="region" aria-label="Scrollable price comparison"><table>
              <caption>Asking prices compared with sales-based Market Price</caption>
              <thead><tr><th scope="col">Finish / variant</th><th scope="col">Low asking</th><th scope="col">Median asking</th><th scope="col">High asking</th><th scope="col">Market Price</th><th scope="col">Median − market</th></tr></thead>
              <tbody>{data.quotes.map((quote, index) => <tr key={`${quote.variant}-${index}`}>
                <th scope="row">{quote.variant}</th><td>{usd(quote.low)}</td><td>{usd(quote.mid)}</td><td>{usd(quote.high)}</td><td>{usd(quote.market)}</td>
                <td>{quote.mid !== null && quote.market !== null ? usd(Number(quote.mid)-Number(quote.market)) : "Unavailable"}</td>
              </tr>)}</tbody>
            </table></div>
            <p className="collection-price-note">Market Price is a sales-based aggregate, not an individual completed sale. Listing prices do not include shipping. These quotes mix conditions and are not adjusted to your card’s condition; each variant is shown separately.</p>
            <p className={data.stale ? "collection-price-stale" : "collection-price-note"}>{data.stale ? "Stale provider data · " : ""}Provider updated: {date(data.provider_updated_at)}. Checked: {date(data.checked_at)}.</p>
            {data.product_id && <a href={`https://www.tcgplayer.com/product/${data.product_id}`} target="_blank" rel="noreferrer">View matched TCGplayer product</a>}
          </> : <p role="status">{item.card.is_custom ? "Custom cards use your supplied value; no catalog price match is assumed." : data.sync_status === "refreshing" || data.sync_status === "pending" ? "Daily price sync is preparing. Check again after it finishes." : "No exact daily price match is available for this printing. Use the research links below."}</p>}
          <p className="collection-price-note">Prices refresh automatically once every 24 hours. New collection cards join the next refresh. Missing prices stay unavailable.</p>
        </>}
      <div className="collection-actions">
        <a href={`https://www.ebay.com/sch/i.html?${query}`} target="_blank" rel="noreferrer">Compare eBay sold listings</a>
        {marketplaceLinksForCard({game:item.card.set.game,name:item.card.name,setCode:item.card.set.code,collectorNumber:item.card.collector_number})
          .filter(link => link.label === "Search TCGplayer").map(link => <a key={link.label} href={link.href} target="_blank" rel="noreferrer">{link.label}</a>)}
      </div>
      <p className="collection-price-note">eBay completed-sale totals are not imported. Check the exact edition, finish, condition, shipping and sale date on eBay.</p>
    </section>}
  </div>;
}
