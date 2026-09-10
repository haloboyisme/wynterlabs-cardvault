import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CollectionPriceDetails, type PriceDetails } from "./CollectionPriceDetails";
import type { CollectionItem } from "../lib/types";

const item = {id:"item-1",quantity:2,revision:1,finish:"nonfoil",condition:"near_mint",card:{name:"Mocking Sprite",collector_number:"159",set:{game:"mtg",code:"FDN",name:"Foundations"}}} as CollectionItem;
const prices: PriceDetails = {unit_estimate_usd:"1.25",quantity_estimate_usd:"2.50",estimate_source:"Catalog estimate",catalog_updated_at:null,
  provider:"TCGplayer via TCGCSV",provider_updated_at:"2026-09-08T20:00:00Z",checked_at:"2026-09-09T00:00:00Z",stale:false,product_id:42,
  sync_status:"complete",completed_sales_available:false,quotes:[{variant:"Normal",low:"1.00",mid:"2.00",high:"3.00",market:"1.50"}]};
afterEach(() => vi.unstubAllGlobals());
it("loads only when opened and separates asking from sales-based market prices", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(prices),{headers:{"content-type":"application/json"}}));
  vi.stubGlobal("fetch",fetch);
  render(<CollectionPriceDetails item={item} />);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:/price details for mocking sprite/i}));
  expect(await screen.findByText("$2.50")).toBeVisible();
  expect(screen.getByRole("columnheader",{name:"Median asking"})).toBeVisible();
  expect(screen.getByText("$0.50")).toBeVisible();
  expect(screen.getByText(/not an individual completed sale/i)).toBeVisible();
  expect(screen.getByRole("link",{name:/ebay sold/i})).toHaveAttribute("href",expect.stringContaining("LH_Sold=1"));
});
it("does not invent prices when an exact daily match is unavailable", async () => {
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({...prices,quotes:[],product_id:null}),{headers:{"content-type":"application/json"}})));
  render(<CollectionPriceDetails item={item} />);
  fireEvent.click(screen.getByRole("button",{name:/price details for/i}));
  expect(await screen.findByText(/no exact daily price match/i)).toBeVisible();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});
