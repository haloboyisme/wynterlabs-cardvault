import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CollectionValueChart } from "./CollectionValueChart";
import type { CollectionValueHistory } from "../lib/types";

const history: CollectionValueHistory = {
  range: "month",
  current_value_usd: "125.50",
  change_usd: "25.50",
  change_percent: "25.50",
  priced_copies: 8,
  unpriced_copies: 2,
  total_copies: 10,
  points: [
    {
      timestamp: "2026-08-01T12:00:00Z", estimated_value_usd: "100.00", priced_copies: 7,
      unpriced_copies: 3, total_copies: 10, oldest_price_snapshot_at: "2026-08-01T00:00:00Z",
    },
    {
      timestamp: "2026-08-27T12:00:00Z", estimated_value_usd: "125.50", priced_copies: 8,
      unpriced_copies: 2, total_copies: 10, oldest_price_snapshot_at: "2026-08-27T00:00:00Z",
    },
  ],
};

describe("CollectionValueChart", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("gives the SVG an accessible name and exposes the values without relying on color", () => {
    render(<CollectionValueChart history={history} />);

    const chart = screen.getByRole("img", { name: /estimated collection value over the last month/i });
    expect(chart).toHaveAccessibleDescription(/from \$100\.00 to \$125\.50/i);
    expect(within(chart).getAllByRole("graphics-symbol")).toHaveLength(2);
    expect(screen.getByText(/estimated collection value increased by \$25\.50 \(25\.50%\)/i)).toBeVisible();
    expect(screen.getByText(/8 of 10 copies priced; 2 copies are unpriced/i)).toBeVisible();
    expect(screen.getByText("Range high").closest("p")).toHaveTextContent("$125.50");
    expect(screen.getByText("Range low").closest("p")).toHaveTextContent("$100.00");
    expect(chart.querySelector("linearGradient")).not.toBeNull();
    expect(chart.querySelector(".collection-value-chart-area")).not.toBeNull();
  });

  it("scales from zero to the next thousand above the selected range high", () => {
    render(<CollectionValueChart history={history} />);

    const scale = screen.getByRole("group", { name: /collection value scale/i });
    expect(within(scale).getAllByText(/^\$/).map((label) => label.textContent)).toEqual([
      "$1K", "$750", "$500", "$250", "$0",
    ]);
    expect(screen.getByText("Scale: $0–$1,000")).toBeVisible();
  });

  it("rounds larger ranges upward by one thousand and caps the supported scale", () => {
    const { rerender } = render(<CollectionValueChart history={{
      ...history,
      current_value_usd: "24400.00",
      points: history.points.map((point, index) => ({
        ...point,
        estimated_value_usd: index === 0 ? "24000.00" : "24400.00",
      })),
    }} />);

    expect(screen.getByText("Scale: $0–$25,000")).toBeVisible();

    rerender(<CollectionValueChart history={{
      ...history,
      current_value_usd: "999999999999.99",
      points: [{ ...history.points[1], estimated_value_usd: "999999999999.99" }],
    }} />);
    expect(screen.getByText("Scale: $0–$999,999,999,999")).toBeVisible();
  });

  it("shows the exact recorded price and time for the active point", () => {
    render(<CollectionValueChart history={history} />);

    expect(screen.getByRole("status", { name: /selected collection value/i })).toHaveTextContent(
      /Aug 27, 2026.*12:00 PM.*\$125\.50/i,
    );

    const [first] = screen.getAllByRole("graphics-symbol");
    fireEvent.mouseEnter(first);
    expect(screen.getByRole("status", { name: /selected collection value/i })).toHaveTextContent(
      /Aug 1, 2026.*12:00 PM.*\$100\.00/i,
    );
  });

  it("uses time labels for an hourly view", () => {
    render(<CollectionValueChart history={{
      ...history,
      range: "hour",
      points: [
        { ...history.points[0], timestamp: "2026-08-27T12:00:00Z" },
        { ...history.points[1], timestamp: "2026-08-27T12:30:00Z" },
      ],
    }} />);

    const timeline = screen.getByRole("group", { name: /collection value timeline/i });
    expect(within(timeline).getByText("12:00 PM")).toBeVisible();
    expect(within(timeline).getByText("12:30 PM")).toBeVisible();
  });

  it("states when only one recorded value is available", () => {
    render(<CollectionValueChart history={{ ...history, change_usd: "0.00", change_percent: null, points: history.points.slice(1) }} />);

    expect(screen.getByText(/one value has been recorded so far/i)).toBeVisible();
    expect(screen.getByText(/estimated collection value change will appear after another snapshot/i)).toBeVisible();
  });

  it("reports a decrease and missing price freshness in text", () => {
    render(<CollectionValueChart history={{
      ...history,
      change_usd: "-10.00",
      change_percent: "-8.70",
      points: [
        { ...history.points[0], estimated_value_usd: "115.50" },
        { ...history.points[1], oldest_price_snapshot_at: null },
      ],
    }} />);

    expect(screen.getByText(/estimated collection value decreased by \$10\.00 \(-8\.70%\)/i)).toBeVisible();
    expect(screen.getByText(/price update time is unavailable, so this estimate may be stale/i)).toBeVisible();
  });

  it("uses the dashboard's seven-day threshold to warn when the oldest contributing price is stale", () => {
    vi.setSystemTime(new Date("2026-08-27T12:00:00Z"));
    render(<CollectionValueChart history={{
      ...history,
      points: [
        history.points[0],
        { ...history.points[1], oldest_price_snapshot_at: "2026-08-20T11:59:59Z" },
      ],
    }} />);

    expect(screen.getByText(/price source may be stale; oldest contributing price: aug 20, 2026/i)).toHaveClass("is-stale");
  });

  it("maps zero-based values and endpoint positions into the chart viewBox", () => {
    render(<CollectionValueChart history={history} />);

    const [first, last] = screen.getAllByRole("graphics-symbol");
    expect(first).toHaveAttribute("cx", "60");
    expect(first).toHaveAttribute("cy", "173");
    expect(last).toHaveAttribute("cx", "460");
    expect(last).toHaveAttribute("cy", "168.665");
  });

  it("keeps flat and one-point histories at their value above the zero baseline", () => {
    const flat = {
      ...history,
      points: history.points.map((point) => ({ ...point, estimated_value_usd: "100.00" })),
    };
    const { rerender } = render(<CollectionValueChart history={flat} />);

    const [first, last] = screen.getAllByRole("graphics-symbol");
    expect(first).toHaveAttribute("cy", "173");
    expect(last).toHaveAttribute("cy", "173");

    rerender(<CollectionValueChart history={{ ...flat, points: flat.points.slice(0, 1) }} />);
    const [single] = screen.getAllByRole("graphics-symbol");
    expect(single).toHaveAttribute("cx", "260");
    expect(single).toHaveAttribute("cy", "173");
  });
});
