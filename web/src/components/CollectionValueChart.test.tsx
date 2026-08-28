import { render, screen, within } from "@testing-library/react";
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

  it("maps value extrema and endpoint positions into the chart viewBox", () => {
    render(<CollectionValueChart history={history} />);

    const [first, last] = screen.getAllByRole("graphics-symbol");
    expect(first).toHaveAttribute("cx", "12");
    expect(first).toHaveAttribute("cy", "112");
    expect(last).toHaveAttribute("cx", "308");
    expect(last).toHaveAttribute("cy", "8");
  });

  it("centers flat and one-point histories instead of drawing them as a low value", () => {
    const flat = {
      ...history,
      points: history.points.map((point) => ({ ...point, estimated_value_usd: "100.00" })),
    };
    const { rerender } = render(<CollectionValueChart history={flat} />);

    const [first, last] = screen.getAllByRole("graphics-symbol");
    expect(first).toHaveAttribute("cy", "60");
    expect(last).toHaveAttribute("cy", "60");

    rerender(<CollectionValueChart history={{ ...flat, points: flat.points.slice(0, 1) }} />);
    const [single] = screen.getAllByRole("graphics-symbol");
    expect(single).toHaveAttribute("cx", "160");
    expect(single).toHaveAttribute("cy", "60");
  });
});
