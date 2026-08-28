import type { CollectionValueHistory, CollectionValuePoint } from "../lib/types";

type CollectionValueChartProps = {
  history: CollectionValueHistory;
};

const RANGE_LABELS: Record<CollectionValueHistory["range"], string> = {
  hour: "the last hour",
  day: "the last day",
  week: "the last week",
  month: "the last month",
  quarter: "the last quarter",
  year: "the last year",
  all: "all recorded time",
};

function money(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount)
    : "Unavailable";
}

function pointLabel(point: CollectionValuePoint) {
  const timestamp = new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC",
  }).format(new Date(point.timestamp));
  return `${timestamp}: ${money(point.estimated_value_usd)}; ${point.priced_copies} of ${point.total_copies} copies priced.`;
}

function chartPoints(points: CollectionValuePoint[]) {
  const values = points.map((point) => Number(point.estimated_value_usd));
  const low = Math.min(...values);
  const high = Math.max(...values);
  const flat = high === low;
  const span = high - low || 1;
  const width = 296;
  const height = 104;
  return points.map((point, index) => ({
    point,
    x: points.length === 1 ? 160 : 12 + (index / (points.length - 1)) * width,
    y: flat ? 8 + height / 2 : 8 + (1 - ((Number(point.estimated_value_usd) - low) / span)) * height,
  }));
}

function rangeExtrema(points: CollectionValuePoint[]) {
  const values = points
    .map((point) => Number(point.estimated_value_usd))
    .filter(Number.isFinite);
  return values.length === 0
    ? null
    : { low: Math.min(...values), high: Math.max(...values) };
}

function changeSummary(history: CollectionValueHistory) {
  if (history.points.length < 2) {
    return "One value has been recorded so far. Estimated collection value change will appear after another snapshot.";
  }
  const change = Number(history.change_usd);
  const direction = change > 0 ? "increased" : change < 0 ? "decreased" : "did not change";
  const amount = money(Math.abs(change).toFixed(2));
  if (direction === "did not change") return "Estimated collection value did not change over this range.";
  const percentage = history.change_percent === null ? "" : ` (${history.change_percent}%)`;
  return `Estimated collection value ${direction} by ${amount}${percentage} over this range.`;
}

export function CollectionValueChart({ history }: CollectionValueChartProps) {
  const points = chartPoints(history.points);
  const extrema = rangeExtrema(history.points);
  const first = history.points[0];
  const last = history.points.at(-1);
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
          <p><span>Range high</span><strong>{money(extrema.high.toFixed(2))}</strong></p>
          <p><span>Range low</span><strong>{money(extrema.low.toFixed(2))}</strong></p>
          <p><span>Recorded points</span><strong>{history.points.length}</strong></p>
        </div>
      )}
      {history.points.length > 0 && (
        <figure className="collection-value-chart-figure">
          <svg role="img" aria-label={chartName} aria-describedby="collection-value-chart-description" viewBox="0 0 320 128" preserveAspectRatio="none">
            <desc id="collection-value-chart-description">{chartDescription}</desc>
            <defs aria-hidden="true">
              <linearGradient id="collection-value-chart-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent-link)" stopOpacity="0.34" />
                <stop offset="100%" stopColor="var(--accent-link)" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            <line className="collection-value-chart-guide" x1="12" x2="308" y1="8" y2="8" aria-hidden="true" />
            <line className="collection-value-chart-guide" x1="12" x2="308" y1="60" y2="60" aria-hidden="true" />
            <line className="collection-value-chart-baseline" x1="12" x2="308" y1="112" y2="112" aria-hidden="true" />
            {points.length > 1 && (
              <path
                className="collection-value-chart-area"
                d={`M 12 112 L ${points.map(({ x, y }) => `${x} ${y}`).join(" L ")} L 308 112 Z`}
                aria-hidden="true"
              />
            )}
            {points.length > 1 && <polyline className="collection-value-chart-line" points={points.map(({ x, y }) => `${x},${y}`).join(" ")} aria-hidden="true" />}
            {points.map(({ point, x, y }) => (
              <circle
                key={point.timestamp}
                className={`collection-value-chart-point${Number(point.estimated_value_usd) === extrema?.high ? " is-high" : ""}${Number(point.estimated_value_usd) === extrema?.low ? " is-low" : ""}`}
                cx={x}
                cy={y}
                r="4"
                role="graphics-symbol"
                tabIndex={0}
                aria-label={pointLabel(point)}
              >
                <title>{pointLabel(point)}</title>
              </circle>
            ))}
          </svg>
          <figcaption>{chartDescription}</figcaption>
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
