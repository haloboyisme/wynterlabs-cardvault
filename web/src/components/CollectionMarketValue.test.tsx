import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { CollectionMarketValue } from "./CollectionMarketValue";
const data = {value_usd:"13.75",asking_value_usd:"18.00",priced_copies:5,unpriced_copies:9,stale_copies:0,provider_updated_at:null};
it("shows total and coverage with a same-copy asking comparison", () => {
  render(<CollectionMarketValue data={data} showPrices />);
  expect(screen.getByText("Sales-based value")).toBeVisible();
  expect(screen.getByText("$13.75")).toBeVisible();
  expect(screen.getByText(/5 of 14 copies priced/)).toBeVisible();
  expect(screen.getByText(/Partial total/)).toBeVisible();
  fireEvent.click(screen.getByText("How this total compares"));
  expect(screen.getByText("$18.00")).toBeVisible();
  expect(screen.getByText("$4.25")).toBeVisible();
});
it("honors hidden prices", () => {
  render(<CollectionMarketValue data={data} showPrices={false} />);
  expect(screen.getByText("Hidden")).toBeVisible();
  expect(screen.queryByText("$13.75")).toBeNull();
  expect(screen.queryByText(/How this total/)).toBeNull();
});
it("does not display a fake zero", () => {
  render(<CollectionMarketValue data={{...data,value_usd:null,asking_value_usd:null,priced_copies:0}} showPrices />);
  expect(screen.getByText("Unavailable")).toBeVisible();
  expect(screen.queryByText("$0.00")).toBeNull();
});
