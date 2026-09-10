import { StatTile } from "./workspace/StatTile";
import type { CollectionMarketTotal } from "../lib/types";

const usd = new Intl.NumberFormat("en-US", {style: "currency", currency: "USD"});
export function CollectionMarketValue({data, showPrices}: {data?: CollectionMarketTotal | null; showPrices: boolean}) {
  const value = !showPrices ? "Hidden" : data?.value_usd != null ? usd.format(Number(data.value_usd)) : "Unavailable";
  return <StatTile label="Sales-based value" value={value} detail={!showPrices
    ? <span>Enable prices in Account to show this estimate.</span>
    : <>
      <span>Estimated total from sold-market prices</span>
      {data && <span>{data.priced_copies} of {data.priced_copies + data.unpriced_copies} copies priced
        {data.unpriced_copies > 0 && <> · {data.unpriced_copies} unpriced</>}</span>}
      <small>TCGplayer Market Price × your quantities</small>
      {data?.unpriced_copies ? <small>Partial total — unmatched cards are excluded.</small> : null}
      <details>
        <summary>How this total compares</summary>
        {data?.asking_value_usd != null && <p>Asking-price total for the same copies: <strong>{usd.format(Number(data.asking_value_usd))}</strong>.
          {data.value_usd != null && <> Asking minus market: <strong>{usd.format(Number(data.asking_value_usd) - Number(data.value_usd))}</strong>.</>}</p>}
        <p>Matches each card’s printing and finish. Market prices summarize sales; this is an estimated collection value, not money you have received from selling cards.</p>
        <p>Conditions are mixed. Fees and shipping are not deducted. Missing prices are excluded, never replaced by catalog estimates.</p>
        <p>TCGplayer via TCGCSV · refreshed daily. {data?.provider_updated_at && <>Prices from {new Date(data.provider_updated_at).toLocaleString()}.</>}</p>
      </details>
      {data && data.stale_copies > 0 && <small>{data.stale_copies} priced copies use older or undated data.</small>}
    </>} />;
}
