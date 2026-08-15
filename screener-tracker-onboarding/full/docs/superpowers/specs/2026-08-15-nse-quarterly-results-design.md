# NSE Quarterly Results Design

**Date:** 2026-08-15

**Status:** Approved for implementation planning

**Scope:** NSE-listed companies present in the active BoardroomX `market_universe`

## 1. Goal

Add a simple Quarterly Results page to BoardroomX and a Railway cron that discovers newly published NSE financial-result filings every five minutes, stores exact XBRL-derived quarterly values in Postgres, and serves the page entirely from the database.

The page shows, for each reported company:

- current quarter;
- immediately previous quarter;
- same quarter in the previous year;
- revenue, calculated EBITDA, and net profit;
- QoQ and YoY growth;
- consolidated data when available, otherwise standalone;
- the exact NSE XBRL source.

## 2. Source Policy

The only permitted financial-data source is NSE Integrated Filing XBRL.

- Discover filings through the NSE India Integrated Filing API.
- Extract the current period from the filing's official NSE XBRL.
- Fetch separate historical NSE XBRLs for the immediately previous quarter and same quarter in the previous year through the same endpoint with its `symbol` filter.
- Do not use PDFs, Screener, social media, company presentations, estimates, inferred values, or reconstructed values as fallbacks.
- Use Screener only as a one-time validation reference for field mapping. It is not a runtime source.
- If an exact source value or a required EBITDA component is absent, store `NULL` and display `N/A`.
- Never convert a missing value to zero.

The source banner must state:

> Source: NSE India Integrated Filing API and NSE XBRL. Historical comparisons use the corresponding historical NSE XBRL filings. EBITDA is calculated from reported XBRL components.

## 3. Metric Mapping

All monetary values are stored in INR at the precision present in XBRL. Conversion to ₹ crore and display rounding happen only in the API response.

### 3.1 Non-financial companies

**Revenue**

Use `RevenueFromOperations`.

**Calculated EBITDA**

Use the signed XBRL values in this fixed formula:

```text
RevenueFromOperations
- CostOfMaterialsConsumed
- PurchasesOfStockInTrade
- ChangesInInventoriesOfFinishedGoodsWorkInProgressAndStockInTrade
- EmployeeBenefitExpense
- OtherExpenses
```

The inventory-change value is subtracted with its reported sign. If it is negative, subtracting it increases calculated EBITDA.

**Net profit**

Use `ProfitLossForPeriod`.

### 3.2 Banking companies

Banking filings use a separate mapping validated against SBI.

**Revenue / Sales**

Use `InterestEarned`, not `Income` or total income.

**Calculated EBITDA**

Use this fixed Screener-compatible formula:

```text
InterestEarned
- EmployeesCost
- OtherOperatingExpenses
- ProvisionsOtherThanTaxAndContingencies
```

**Net profit**

Use:

```text
ProfitLossForThePeriod + ShareOfProfitLossOfAssociates
```

If the associates value is absent, it is treated as unavailable unless the taxonomy explicitly indicates that the field is not applicable. It is not silently assumed to be zero.

### 3.3 Growth

Growth is calculated by the backend from stored values:

```text
growth_percent = ((current - comparison) / abs(comparison)) * 100
```

- QoQ compares current quarter with the immediately previous quarter.
- YoY compares current quarter with the same quarter in the previous year.
- Return `NULL` when either value is missing or the comparison value is zero.
- Growth is rounded to one decimal only in the API response.

## 4. Period Resolution

For a current period ending on date `P`:

- previous quarter is the immediately preceding March, June, September, or December quarter-end;
- prior-year quarter is the same quarter-end one calendar year earlier.

The current filing does not supply the comparison values used by this implementation. Each comparison must come from its own historical NSE XBRL row in the database.

The worker discovers the symbol's historical filings immediately after it discovers a new current filing. Until all three periods are processed, the page displays `N/A` for missing comparisons and growth.

## 5. Consolidated-First Rule

Store consolidated and standalone filings independently.

For the latest company result:

1. select the latest non-superseded consolidated filing when present;
2. otherwise select the latest non-superseded standalone filing.

Use that selected basis for the previous-quarter and prior-year comparisons. Never compare consolidated current data with standalone historical data, or standalone current data with consolidated historical data. If a same-basis historical row is unavailable, display `N/A` for that comparison.

If standalone arrives first, it may be displayed temporarily. When consolidated arrives, database selection switches the current and comparison rows to consolidated without deleting the standalone rows.

## 6. Minimal Database Design

Create one table: `quarterly_results`.

| Column | Type | Purpose |
|---|---|---|
| `nse_seq_id` | `text primary key` | NSE submission identity and duplicate guard |
| `symbol` | `text not null` | Joins to the active stock universe |
| `period_end` | `date not null` | Exact reported quarter end |
| `basis` | `text not null` | `consolidated` or `standalone` |
| `taxonomy` | `text not null` | `indas` or `banking` |
| `source_xbrl_url` | `text not null` | Exact source shown to users |
| `reported_at` | `timestamptz not null` | NSE publication time and default page order |
| `status` | `text not null` | `pending`, `processing`, `retry`, `processed`, or `failed` |
| `revenue_inr` | `numeric` | Direct XBRL revenue/interest-earned value |
| `calculated_ebitda_inr` | `numeric` | Result of the fixed taxonomy formula |
| `net_profit_inr` | `numeric` | Direct or banking-mapped result |
| `ebitda_components_inr` | `jsonb` | Exact named XBRL inputs used in the calculation |
| `last_attempt_at` | `timestamptz` | Claim time, stale-claim recovery, and latest processing time |
| `attempt_count` | `smallint not null default 0` | Bounds retries for temporary failures |
| `next_retry_at` | `timestamptz` | Prevents failed XBRLs from being requested every five minutes |
| `error` | `text` | Failure or missing-source-field diagnostic; null only when processing is complete without a data issue |
| `superseded_by_seq_id` | `text` | Links an older submission to its NSE revision |

Required constraints and indexes:

- checks for valid `basis`, `taxonomy`, and `status` values;
- foreign key from `symbol` to `dhan_instruments(symbol)`;
- self-reference from `superseded_by_seq_id` to `nse_seq_id`;
- index on `(symbol, period_end, basis)` for three-period reads;
- index on `(status, next_retry_at, reported_at)` for worker selection.

No company-level `fetched` boolean is added. It would incorrectly block later quarters and revised filings. `nse_seq_id` plus `status` provides the required idempotency.

The table is written only by the service role. Browser clients do not query it directly; the authenticated Express API owns reads.

## 7. Five-Minute Worker

Add `quarterly-results` to the existing cron runner.

- Railway cron: `*/5 * * * *`.
- Acquire the existing PostgreSQL advisory lock before work.
- Fetch the NSE Integrated Filing feed using its verified `page` and `size` pagination inputs.
- Keep only active symbols from `market_universe`.
- Insert unseen `nse_seq_id` values as `pending`.
- For every newly discovered current filing, request that symbol's filing history and insert only the current, previous-quarter, and prior-year filings required by the page.
- Claim pending rows, due retry rows, and processing rows stale for more than 15 minutes one at a time as `processing`.
- Fetch and parse the associated XBRL.
- Validate period, basis, taxonomy, source tags, and required formula inputs.
- Store exact INR values and calculation components.
- Mark the row `processed`, `retry`, or `failed`.
- When NSE marks a submission as a revision for the same symbol, period, and basis, process the new sequence and set the older active row's `superseded_by_seq_id`.
- Record the run outcome in the existing `scheduler_log` table.

Temporary network/HTTP failures use bounded retries after 5, 15, and 60 minutes. After three failed attempts, mark the row `failed`. Unsupported taxonomies and invalid filing identities fail immediately. The worker does not refetch XBRL for rows already marked `processed` unless a new NSE sequence ID is published.

A separate one-time command backfills the latest results quarter already in progress when this feature is first deployed. It uses the same client, parser, table, and idempotency rules as the cron and stops when the feed reaches an older quarter. It does not backfill unrelated older quarters; required comparisons are fetched only through each discovered symbol's history.

## 8. Read API

Add an authenticated endpoint:

```text
GET /api/quarterly-results
```

Supported parameters:

- `q`: symbol or company-name search;
- `sort`: `reported_at`, `revenue_yoy`, or `profit_yoy`;
- `order`: `asc` or `desc`;
- `page`: positive integer;
- `limit`: 1–50, default 50.

The server:

- selects the latest reported quarter for each company;
- resolves current, previous-quarter, and prior-year rows;
- selects the consolidated-first basis once for the current result and uses that same basis for both comparisons;
- calculates QoQ and YoY growth;
- converts INR to ₹ crore;
- includes source URLs and reported/calculated labels;
- returns deterministic pagination.

Page loads never call NSE.

## 9. Quarterly Results Page

Add `/quarterly-results.html` and a `Quarterly Results` item to the existing main navigation.

The page contains:

- the source banner;
- one search input;
- sort control for latest, revenue YoY, or net-profit YoY;
- ascending/descending control;
- minimal company result tables matching the approved view;
- consolidated/standalone label;
- ₹ crore unit label;
- direct NSE XBRL link;
- current, previous-quarter, and prior-year columns;
- calculated EBITDA information icon.

The information icon opens an accessible tooltip on hover, keyboard focus, or tap. The tooltip shows the applicable fixed formula and states that the value is calculated from reported XBRL components.

## 10. Error Behaviour

- NSE feed unavailable: fail the cron run, log the error, leave stored data unchanged.
- XBRL temporarily unavailable: mark only that filing for bounded retry; leave other filings unaffected.
- Malformed XBRL or unsupported taxonomy: mark failed with the exact reason.
- Missing required source tag: store the available reported values, keep the affected calculated metric null, and record the missing tag in `error` while marking the filing processed.
- Duplicate cron or overlapping deployment: advisory lock prevents simultaneous work; primary key prevents duplicate rows.
- No historical filing: display `N/A`; do not estimate.

## 11. Test and Release Gates

### Unit tests

- non-financial formula, including negative inventory change;
- SBI banking revenue, calculated EBITDA, and net-profit mapping;
- missing fields produce null rather than zero;
- period resolution across year boundaries;
- zero and negative comparison growth;
- source-unit conversion to INR;
- revision supersession;
- consolidated-first selection;
- duplicate sequence IDs are skipped.

### Integration tests

- feed fixture creates pending rows only for active universe symbols;
- processed rows are not refetched on a second run;
- due retry rows are retried and terminal failed rows are not automatically fetched again;
- retry backoff and three-attempt terminal failure work correctly;
- API returns the correct three periods;
- API never mixes consolidated and standalone periods;
- search, sorting, order, and pagination are deterministic;
- every returned company includes its NSE XBRL source;
- page requests only the BoardroomX API.

### Five-company reconciliation

Before deployment, reconcile stored values and formulas against official NSE XBRLs for:

- SBI;
- Hindalco;
- ONGC;
- Castrol India;
- RITES.

All current, previous-quarter, and prior-year source links must be retained in the database. Any mismatch blocks deployment.

### Deployment sequence

1. Run the full automated test suite locally.
2. Apply the schema migration to staging.
3. Run the worker manually against saved fixtures.
4. Run the latest-quarter backfill against live NSE data in staging.
5. Run it twice and confirm the second run writes no duplicate rows and refetches no processed XBRL.
6. Verify the five-company reconciliation and page behaviour.
7. Deploy the web service.
8. Deploy the five-minute Railway cron.
9. Run production API, page, database-count, source-link, and scheduler-log smoke checks.

## 12. Phase 2 — Explicitly Excluded

The following are not part of this implementation:

- PDF extraction or PDF/XBRL reconciliation;
- Screener or other third-party fallbacks;
- OCR;
- company presentations or press releases;
- adjusted/normalized profit growth;
- configurable EBITDA formulas;
- manual data editing;
- alerts or notifications;
- streaming updates;
- historical backfill beyond the quarters required to render current comparisons;
- generalized filing/taxonomy framework beyond Ind AS and banking results required by the active universe.
