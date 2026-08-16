# Quarterly Results Speed and Date Filter Design

## Scope

Improve the existing quarterly-results page without changing financial data semantics, NSE XBRL ingestion, database schema, or supported result filters.

## Confirmed product behavior

- Move **Reported date** to the final position in the right-side filter panel, after Sorting.
- Show the latest seven distinct reporting dates that contain at least one company result.
- A **View more** control reveals all remaining reporting dates for the selected quarter.
- The expanded control becomes **Show less** and collapses back to seven dates.
- A selected reporting date remains visible and selected while the section is collapsed, even when it is older than the latest seven. This prevents a hidden active filter.
- Changing quarter resets the reporting-date filter and returns the date list to its collapsed state.
- Date counts continue to represent consolidated-first current-choice company rows in IST.

## Performance diagnosis

Production evidence on 16 August 2026:

- Authenticated Railway HTTP requests took 4,061 ms, 3,806 ms, 1,499 ms, and 908 ms as connections warmed.
- The active-quarter financial query executes in approximately 39 ms.
- PostgreSQL statistics show the supporting quarter, date, and count queries averaging approximately 12–30 ms.
- Railway currently runs `portfolio-tracker` in Virginia, while Supabase Auth and PostgreSQL run in AWS `ap-south-1` (Mumbai).

The dominant delay is therefore cross-region connection/authentication/database latency plus repeated metadata queries, not financial calculation or browser rendering.

## Recommended implementation

### 1. Region alignment

Move only the persistent `portfolio-tracker` web/API service from Railway US East to Railway Southeast Asia (Singapore). Keep its public domain and one replica. Cron locations are outside this change because they do not affect interactive page latency.

Expected effect: materially lower user-to-service and service-to-Supabase latency for Indian users. Railway documents region changes as domain-preserving and no-downtime when no volume is attached; this service has no attached volume.

### 2. Metadata reuse

Keep one authenticated API surface, but avoid recomputing invariant quarter metadata for every filter selection:

- Cache only global quarter metadata in the Node process for 60 seconds:
  - newest active-quarter resolution;
  - available quarters and company counts;
  - reporting dates and company counts, keyed by quarter.
- Do not cache user-specific watchlist counts, filtered totals, or result rows.
- Do not cache any financial values.
- A process restart simply produces a cold cache; correctness is unchanged.
- A 60-second maximum active-quarter/date-count lag is acceptable because the ingestion cron itself runs every five minutes. The results list remains uncached and immediately reflects stored rows for its resolved quarter.

This is intentionally an in-memory cache: no new table, Redis service, migration, invalidation job, or future-facing abstraction.

### 3. Request behavior

- Initial page load obtains the active quarter, metadata, filtered total, and first 25 result cards.
- Filter selections continue to request fresh filtered rows and totals.
- Cached global metadata is attached to the response without rerunning active-quarter, available-quarter, or reporting-date queries.
- Existing request cancellation and stale-response protection remain unchanged.

## Error and safety behavior

- Authentication remains mandatory and continues to validate the bearer token through Supabase.
- If metadata loading fails, the request fails rather than serving assumed or fabricated values.
- Cached data is populated only after successful database responses.
- Existing NSE XBRL provenance, consolidated-first selection, historical same-basis comparisons, and `N/A` rules remain unchanged.

## Testing and release gates

- Test-first coverage for:
  - date section appearing last;
  - seven latest distinct dates shown by default;
  - View more / Show less behavior;
  - selected older date remaining visible while collapsed;
  - quarter change resetting date expansion;
  - metadata cache hit, miss, expiry, and no user-specific caching.
- Full automated suite must pass.
- Independent review must find no Critical or Important issues.
- Railway plan must show only the intended web-service region change.
- Production deployment must remain healthy at the same URL.
- Authenticated production HTTP timings will be compared with the current 908–4,061 ms baseline.
- Quarterly five-minute cron must remain deployed and complete successfully after the release.

## Explicitly out of scope

- Industry filter.
- Redis or persistent caching.
- Browser-side storage of financial responses.
- Authentication redesign or local JWT verification.
- Database schema changes or additional indexes.
- Changes to the quarterly-results cron or NSE source logic.
