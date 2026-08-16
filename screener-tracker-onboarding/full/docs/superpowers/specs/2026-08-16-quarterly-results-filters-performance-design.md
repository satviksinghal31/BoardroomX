# Quarterly Results Filters and Performance Design

## Goal

Make the quarterly-results page load quickly, scope it to one explicit reporting quarter, and add accurate server-side filters for reporting date, the signed-in user's watchlist, and NSE market capitalization.

## Phase 1 scope

Included:

- Quarter-specific results with automatic rollover to the newest available quarter.
- Clickable quarter tags for available prior quarters.
- Reporting-date filter with daily company counts in IST.
- Signed-in user's watchlist filter.
- NSE market-cap filter with fixed buckets and custom bounds.
- Search, supported sorting, pagination, removable filter chips, and Clear all.
- Database-query performance correction.
- Responsive right-side filter panel.

Excluded:

- Industry filter. Industry metadata currently covers only 429 of 1,949 result companies.
- Turnaround, TTM PE, and quarterly PE sorting.
- Multiple named watchlists.
- New financial metrics or non-NSE result sources.
- External NSE calls during page requests.

## Quarter behavior

- The API determines the newest processed `period_end` and returns it as the default active quarter.
- The page switches immediately when the first valid processed filing for a newer quarter is available.
- The heading uses the active period, for example `June 2026 quarterly results`.
- The API returns every available quarter and its distinct company count, newest first.
- Compact clickable quarter tags appear below the heading. Selecting a tag reloads that exact quarter.
- The selected quarter tag is visually active and keyboard accessible.
- Selecting another quarter resets reporting date and pagination because those values are quarter-specific. Search, watchlist, market cap, and sorting remain applied.
- No historical period is inferred. Tags come only from processed database rows.

## Filters

### Reporting date

- Values use the NSE `reported_at` timestamp converted to the `Asia/Kolkata` calendar date.
- Options are single-select: `All reporting dates` or one exact date.
- Dates appear newest first as `15 Aug 2026 — 47 companies`.
- The count is the total number of distinct companies with processed filings for that active quarter and IST date.
- Daily counts do not change when watchlist, market-cap, search, or sorting filters change. They remain an ingestion-health reference.
- Selecting a date returns only companies reported on that IST date.
- Rows without an exact NSE publication timestamp are already rejected by ingestion and are never assigned an assumed date.

### Watchlist

- Options are single-select: `All companies` and `My watchlist — N`.
- The count comes from `watchlists` for `req.user.id`.
- Selecting My watchlist restricts results to symbols in that user's watchlist.
- An empty watchlist produces a specific empty state and never falls back to all companies.
- The authenticated user ID is supplied by server middleware; the client cannot submit another user ID.

### Market capitalization

- Source is the latest stored NSE EOD market capitalization in `market_universe.market_cap`, stored in rupees.
- Options are single-select:
  - All market caps.
  - ₹0 to less than ₹50 crore.
  - ₹50 to less than ₹500 crore.
  - ₹500 to less than ₹5,000 crore.
  - ₹5,000 crore and above.
  - Custom minimum and/or maximum in crore.
- Fixed bucket boundaries do not overlap.
- All market caps includes companies with missing market-cap data.
- Any fixed or custom range excludes companies whose market cap is missing.
- Custom values must be non-negative numbers and minimum must not exceed maximum.

### Search and sorting

- Search matches symbol or company name and is combined with all active filters.
- Supported sorts are:
  - Latest reported.
  - Revenue YoY growth.
  - Net profit YoY growth.
- Order is descending or ascending. Null growth remains last in either order.
- Any filter, search, sort, order, or quarter change returns pagination to page 1.
- Page size is 25 companies.

### Removing filters

- Every non-default filter appears as a removable chip with an accessible remove button.
- Selecting the `All` option in a section clears only that section.
- `Clear all` restores the active newest quarter, all dates, all companies, all market caps, empty search, latest-reported descending, and page 1.

## Page layout

- Desktop uses a two-column content layout: results on the left and a sticky filter panel on the right.
- The search field remains above the result cards in the left column.
- The right panel contains, in order: Reported date, Watchlist, Market cap, and Sorting.
- Active filter chips and Clear all appear above the result list.
- Mobile uses a Filters button that opens the same controls in a compact panel; it does not duplicate filter state.
- Loading a new result set preserves existing cards and adds a compact busy indicator. It does not replace the entire page with a large loading placeholder.
- An obsolete request is cancelled when a newer filter request starts.
- Empty states distinguish no matching filters, empty watchlist, and a quarter with no results.

## API contract

The existing authenticated `GET /api/quarterly-results` endpoint remains the only page-data endpoint.

Accepted query parameters:

- `quarter`: optional exact `YYYY-MM-DD` quarter end; defaults to newest processed period.
- `reported_date`: optional exact IST calendar date `YYYY-MM-DD`.
- `watchlist`: optional `true`; any other non-empty value is invalid.
- `market_cap_bucket`: optional `under_50`, `50_500`, `500_5000`, or `5000_plus`.
- `market_cap_min`: optional non-negative crore value.
- `market_cap_max`: optional non-negative crore value.
- Existing `q`, `sort`, `order`, `page`, and `limit`, with `limit` fixed by the UI at 25 and server maximum retained at 50.

Fixed market-cap bucket and custom market-cap parameters are mutually exclusive. Invalid combinations return HTTP 400.

Response shape:

```json
{
  "meta": {
    "activeQuarter": "2026-06-30",
    "activeQuarterLabel": "June 2026",
    "quarters": [
      { "periodEnd": "2026-06-30", "label": "June 2026", "companies": 1949 }
    ],
    "reportedDates": [
      { "date": "2026-08-15", "label": "15 Aug 2026", "companies": 47 }
    ],
    "watchlistCompanies": 14
  },
  "items": [],
  "pagination": {
    "page": 1,
    "limit": 25,
    "total": 1949,
    "totalPages": 78
  }
}
```

The API continues returning current, previous-quarter, and prior-year values for the selected quarter using the same basis as the selected current filing.

## Database query design

### Confirmed production cause

The current query materializes all 10,062 eligible result rows and rescans that materialized set for previous-quarter and prior-year data for every company. Production requests take approximately 10.5 to 12.6 seconds and the measured execution plan reads more than two million temporary blocks.

### Corrected query

- Resolve and validate the active quarter first.
- Calculate the exact previous-quarter and prior-year dates once in application code.
- Read only processed, non-superseded current rows for the selected quarter.
- Choose consolidated before standalone per symbol, then newest exact revision.
- Join historical periods by `symbol`, exact `period_end`, and the chosen `basis` using the existing `quarterly_results_symbol_period_basis_idx` index.
- Join `market_universe` once for company name and latest NSE market cap.
- When watchlist filtering is active, join `watchlists` using both authenticated `user_id` and symbol.
- Apply search, reporting date, and market-cap predicates before sorting and pagination.
- Compute daily date facets for the active quarter independently from user filters so the counts remain stable.

The equivalent quarter-scoped indexed query has been measured against production at approximately 45 ms without a schema change. No new table, materialized view, or cache is required in Phase 1.

## Data-source correctness

- Financial values and publication timestamps remain NSE Integrated Filing and NSE XBRL only.
- Historical comparisons remain exact NSE XBRL rows of the same basis.
- Market cap is the latest stored NSE EOD market-cap fact.
- Watchlist membership is BoardroomX user state.
- The UI must label these sources without implying that watchlist or market-cap metadata came from XBRL.
- No assumed values or fallback financial sources are introduced.

## Error and loading behavior

- Input errors return HTTP 400 with a safe message.
- Authentication errors retain existing HTTP 401 behavior.
- Unexpected database errors return HTTP 500 and do not expose SQL text.
- The client keeps the previous successful result set visible if a refresh fails and shows a retryable inline error.
- The initial load shows a compact skeleton limited to the results column.
- `AbortController` prevents late responses from overwriting newer filter state.

## Testing

Backend tests must cover:

- Default newest-quarter selection and an explicit historical quarter.
- Immediate availability of a newly processed quarter.
- Consolidated-first and same-basis historical joins.
- IST date boundaries around midnight UTC.
- Stable daily counts independent of other filters.
- Watchlist ownership and empty-watchlist behavior.
- Every market-cap boundary and missing market-cap behavior.
- Invalid filter combinations and query injection attempts.
- Search, each supported sort, null-last ordering, and pagination.
- Query structure uses exact period predicates and does not rescan a materialized eligible CTE.

Frontend tests must cover:

- Dynamic quarter heading and accessible quarter tags.
- Right-side filter sections and mobile filter control.
- Active filter chips, per-filter removal, and Clear all.
- Correct request parameters and page reset behavior.
- Preserved results during refresh, stale-request cancellation, error and empty states.
- Removal of Industry, Turnaround, TTM PE, and quarterly PE controls.

Release verification must include:

- Full automated test suite.
- Production-like query timing against populated data.
- Authenticated smoke tests for default, prior quarter, date, watchlist, each market-cap bucket, search, and sorting.
- Confirmation that daily counts equal direct processed-filing counts for at least three dates.
- Desktop and mobile layout checks.
- Production deployment health and HTTP checks.

## Phase 2

- Industry filter after a complete, validated industry backfill.
- Named multiple watchlists only if the product introduces them.
- Additional valuation or turnaround sorting only after authoritative inputs and formulas are defined.
