import { useState } from "react";

import type { CollectionValueHistory, CollectionValuePoint } from "../lib/types";

type CollectionValueChartProps = { history: CollectionValueHistory };

const MAX_CHART_VALUE = 999_999_999_999;
const PLOT = { left: 60, right: 460, top: 20, bottom: 190 } as const;

const RANGE_LABELS: Record<CollectionValueHistory["range"], string> = {
  hour: "the last hour", day: "the last day", week: "the last week",
  month: "the last month", quarter: "the last quarter", year: "the last year",
  all: "all recorded time",
};

function numericValue(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.min(MAX_CHART_VALUE, Math.max(0, amount)) : 0;
}

function money(value: string | number, decimals = true) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("en-US", {
      style: "currency", currency: "USD",
      minimumFractionDigits: decimals ? 2 : 0,
      maximumFractionDigits: decimals ? 2 : 0,
    }).format(amount)
    : "Unavailable";
}

function compactMoney(value: number) {
  if (value < 1_000) return money(value, false);
  const units = [
    { divisor: 1_000_000_000, suffix: "B" },
    { divisor: 1_000_000, suffix: "M" },
    { divisor: 1_000, suffix: "K" },
  ];
  const unit = units.find(({ divisor }) => value >= divisor)!;
  const scaled = value / unit.divisor;
  const digits = Number.isInteger(scaled) ? 0 : scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `$${scaled.toFixed(digits).replace(/\.0+$|(?<=\.[0-9])0$/, "")}${unit.suffix}`;
}

function timestampLabel(point: CollectionValuePoint) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
    timeZone: "UTC", timeZoneName: "short",
  }).format(new Date(point.timestamp));
}

function timelineLabel(timestamp: string, range: CollectionValueHistory["range"]) {
  const options: Intl.DateTimeFormatOptions = range === "hour" || range === "day"
    ? { hour: "numeric", minute: "2-digit", timeZone: "UTC" }
    : range === "week"
      ? { weekday: "short", hour: "numeric", timeZone: "UTC" }
      : range === "year" || range === "all"
        ? { month: "short", year: "numeric", timeZone: "UTC" }
        : { month: "short", day: "numeric", timeZone: "UTC" };
  return new Intl.DateTimeFormat("en-US", options).format(new Date(timestamp));
}

function pointLabel(point: CollectionValuePoint) {
  return `${timestampLabel(point)}: ${money(point.estimated_value_usd)}; ${point.priced_copies} of ${point.total_copies} copies priced.`;
}

function chartMaximum(points: CollectionValuePoint[]) {
  const highest = Math.max(0, ...points.map((point) => numericValue(point.estimated_value_usd)));
  if (highest >= MAX_CHART_VALUE) return MAX_CHART_VALUE;
  return Math.max(1_000, (Math.floor(highest / 1_000) + 1) * 1_000);
}

function chartPoints(points: CollectionValuePoint[], scaleMaximum: number) {
  const width = PLOT.right - PLOT.left;
  const height = PLOT.bottom - PLOT.top;
  return points.map((point, index) => ({
    point,
    x: points.length === 1 ? PLOT.left + width / 2 : PLOT.left + (index / (points.length - 1)) * width,
    y: PLOT.bottom - (numericValue(point.estimated_value_usd) / scaleMaximum) * height,
  }));
}

function timelinePoints(points: CollectionValuePoint[]) {
  if (points.length <= 3) return points.map((point, index) => ({ point, index }));
  const middle = Math.floor((points.length - 1) / 2);
  return [
    { point: points[0], index: 0 },
    { point: points[middle], index: middle },
    { point: points.at(-1)!, index: points.length - 1 },
  ];
}

function rangeExtrema(points: CollectionValuePoint[]) {
  const values = points.map((point) => Number(point.estimated_value_usd)).filter(Number.isFinite);
  return values.length === 0 ? null : { low: Math.min(...values), high: Math.max(...values) };
}

function changeSummary(history: CollectionValueHistory) {
  if (history.points.length < 2) {
    return "One value has been recorded so far. Estimated collection value change will appear after another snapshot.";
  }
  const change = Number(history.change_usd);
  const direction = change > 0 ? "increased" : change < 0 ? "decreased" : "did not change";
  const amount = money(Math.abs(change));
  if (direction === "did not change") return "Estimated collection value did not change over this range.";
  const percentage = history.change_percent === null ? "" : ` (${history.change_percent}%)`;
  return `Estimated collection value ${direction} by ${amount}${percentage} over this range.`;
}

export function CollectionValueChart({ history }: CollectionValueChartProps) {
  const [activeTimestamp, setActiveTimestamp] = useState(() => history.points.at(-1)?.timestamp ?? "");
  const scaleMaximum = chartMaximum(history.points);
  const points = chartPoints(history.points, scaleMaximum);
  const axisValues = Array.from({ length: 5 }, (_, index) => scaleMaximum * (1 - index / 4));
  const extrema = rangeExtrema(history.points);
  const first = history.points[0];
  const last = history.points.at(-1);
  const activePoint = history.points.find((point) => point.timestamp === activeTimestamp) ?? last;
  const chartName = `Estimated collection value over ${RANGE_LABELS[history.range]}`;
  const chartDescription = first && last
    ? `From ${money(first.estimated_value_usd)} to ${money(last.estimated_value_usd)} across ${history.points.length} recorded values.`
    : "No recorded collection values are available.";
  const oldestPrice = last?.oldest_price_snapshot_at;
  const oldestPriceDate = oldestPrice ? new Date(oldestPrice) : null;
  const oldestPriceIsStale = oldestPriceDate !== null
    && Number.isFinite(oldestPriceDate.getTime())
    && Date.now() - oldestPriceDate.getTime() > 7 * 86_400_000;

  return (
    <div className="collection-value-chart">
      <div className="collection-value-chart-summary">
        <p className="collection-value-chart-current"><span>Current estimate</span><strong>{money(history.current_value_usd)}</strong></p>
        <p className="collection-value-chart-change">{changeSummary(history)}</p>
      </div>
      {extrema && (
        <div className="collection-value-chart-metrics" aria-label="Selected range summary">
          <p><span>Range high</span><strong>{money(extrema.high)}</strong></p>
          <p><span>Range low</span><strong>{money(extrema.low)}</strong></p>
          <p><span>Recorded points</span><strong>{history.points.length}</strong></p>
        </div>
      )}
      {history.points.length > 0 && (
        <figure className="collection-value-chart-figure">
          <svg role="img" aria-label={chartName} aria-describedby="collection-value-chart-description" viewBox="0 0 480 240">
            <desc id="collection-value-chart-description">{chartDescription}</desc>
            <defs aria-hidden="true">
              <linearGradient id="collection-value-chart-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent-link)" stopOpacity="0.34" />
                <stop offset="100%" stopColor="var(--accent-link)" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            <g role="group" aria-label="Collection value scale">
              {axisValues.map((value, index) => {
                const y = PLOT.top + ((PLOT.bottom - PLOT.top) * index) / 4;
                return <g key={value}>
                  <line className={index === 4 ? "collection-value-chart-baseline" : "collection-value-chart-guide"} x1={PLOT.left} x2={PLOT.right} y1={y} y2={y} aria-hidden="true" />
                  <text className="collection-value-chart-axis-label" x={PLOT.left - 8} y={y + 4} textAnchor="end">{compactMoney(value)}</text>
                </g>;
              })}
            </g>
            {points.length > 1 && <path className="collection-value-chart-area" d={`M ${PLOT.left} ${PLOT.bottom} L ${points.map(({ x, y }) => `${x} ${y}`).join(" L ")} L ${PLOT.right} ${PLOT.bottom} Z`} aria-hidden="true" />}
            {points.length > 1 && <polyline className="collection-value-chart-line" points={points.map(({ x, y }) => `${x},${y}`).join(" ")} aria-hidden="true" />}
            {points.map(({ point, x, y }) => (
              <circle
                key={point.timestamp}
                className={`collection-value-chart-point${Number(point.estimated_value_usd) === extrema?.high ? " is-high" : ""}${Number(point.estimated_value_usd) === extrema?.low ? " is-low" : ""}`}
                cx={x} cy={y} r="5" role="graphics-symbol" tabIndex={0} aria-label={pointLabel(point)}
                onMouseEnter={() => setActiveTimestamp(point.timestamp)}
                onFocus={() => setActiveTimestamp(point.timestamp)}
                onClick={() => setActiveTimestamp(point.timestamp)}
              ><title>{pointLabel(point)}</title></circle>
            ))}
            <g role="group" aria-label="Collection value timeline">
              {timelinePoints(history.points).map(({ point, index }) => {
                const x = history.points.length === 1 ? (PLOT.left + PLOT.right) / 2 : PLOT.left + (index / (history.points.length - 1)) * (PLOT.right - PLOT.left);
                return <text key={point.timestamp} className="collection-value-chart-axis-label" x={x} y="218" textAnchor={index === 0 ? "start" : index === history.points.length - 1 ? "end" : "middle"}>{timelineLabel(point.timestamp, history.range)}</text>;
              })}
            </g>
          </svg>
          <div className="collection-value-chart-selected" role="status" aria-label="Selected collection value">
            <span>{activePoint ? timestampLabel(activePoint) : "No recorded time"}</span>
            <strong>{activePoint ? money(activePoint.estimated_value_usd) : "Unavailable"}</strong>
          </div>
          <figcaption>{chartDescription} <span>Scale: {money(0, false)}–{money(scaleMaximum, false)}</span></figcaption>
        </figure>
      )}
      <p className="collection-value-chart-coverage">
        {history.priced_copies} of {history.total_copies} copies priced; {history.unpriced_copies} {history.unpriced_copies === 1 ? "copy is" : "copies are"} unpriced and excluded from this estimate.
      </p>
      {oldestPrice === null && <p className="collection-value-chart-freshness is-unavailable">Price update time is unavailable, so this estimate may be stale.</p>}
      {oldestPrice && <p className={`collection-value-chart-freshness${oldestPriceIsStale ? " is-stale" : ""}`}>{oldestPriceIsStale ? "Price source may be stale; " : ""}Oldest contributing price: {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(oldestPriceDate!)}.</p>}
    </div>
  );
}
