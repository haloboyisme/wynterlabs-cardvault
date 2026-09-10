# Price details and interactive value history

Included in Version 2.6.0. Originally developed as the V2.5.10 private candidate.

Open **Price details** on a collection card. The bubble keeps the collection's existing per-copy and quantity estimate, and compares TCGplayer low/median/high asking prices with its sales-based Market Price. Each finish/variant is separate. Median minus market shows the asking-price gap. Quotes are USD, mix conditions, and exclude shipping; they are not an appraisal of the user's exact condition. Market Price is an aggregate, not a list of completed sales. eBay sold-listing links support manual research; eBay sold totals are not imported.

## Collection-wide sales-based value

The Collection overview has a separate Sales-based value tile. It multiplies each
owned quantity by a unique matching printing/finish Market Price. It reports
priced and unpriced copy counts, partial totals and stale coverage. Expand the
tile to compare asking prices for the same copies. This is estimated inventory
value, not revenue received from selling cards.

## Free daily source

[TCGCSV](https://tcgcsv.com/docs) exposes TCGplayer's daily public cache without an API key. The production API refreshes once every 24 hours and checks the provider build timestamp before syncing. A shared filesystem lock prevents overlapping workers; atomic cache writes preserve complete responses. New collection cards join the next provider refresh. Only owned, active, English-language public catalog printings are matched. Matching requires a unique set and exact card name/collector number, or an existing TCGplayer product identifier. Ambiguous, custom, non-English and unsupported cards remain unmatched. All returned variants are labeled independently.

The feed is fetched server-side with a custom User-Agent, at least 120 ms between requests, 25 MB response bounds, and at most 300 matched set groups per daily run. Each URL is cached for 24 hours, including failures to prevent retry storms. Quotes live under the existing catalog-media volume in `market-prices/`; no new database schema, paid service or dependency is required. Cache files contain catalog identifiers/quotes, not account identities. They are rebuildable rather than part of the database backup.

Provider and fetch timestamps are separate. Prices older than 36 hours are marked stale; missing or failed feeds do not become zero-dollar sales. The endpoint authorizes access through the user's collection item before reading cached quotes. Development/test mode does not start the network updater.

## Dashboard

The graph positions snapshots by elapsed time, adds an accessible slider and selected-point cursor, displays exact value, timestamp, priced/unpriced copy counts and change from the previous snapshot, and supplies a scrollable data table. Value changes can result from added/removed cards as well as prices; they must not be described as investment returns.

## Validation

Focused collection, chart, pricing and dashboard tests, type checking and production build passed. Cache tests cover exact matching, ambiguous matches, zero/missing/invalid prices, variant separation, once-daily requests, source freshness and collection-account isolation.
