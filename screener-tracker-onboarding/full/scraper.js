// ─────────────────────────────────────────────────────────────────────────────
//  BoardroomX — Screener.in scraper (data agent)
//
//  Exports:
//    scrapeScreener(symbol, opts, supabase)
//        Screener-only: fetches quarterly P&L, upserts into stocks/financials/results.
//        Used by the SCREENER agent and POST /api/watchlist.
//
//    scrapeAndStore(symbol, opts, supabase)  [legacy wrapper]
//        Calls scrapeScreener then syncBoardMeetings. Kept for /api/watchlist
//        non-blocking add flow — gives a freshly added symbol its NSE dates
//        without waiting for the next NSE-agent tick.
//
//  Error codes returned from scrapeScreener:
//    NOT_FOUND          Screener has no page for this symbol (delisted/typo)
//    NO_QUARTERLY_DATA  Page exists but the quarterly results table is empty
//                       (recent listing, no results published yet)
//    NETWORK            Fetch failed before parsing (timeout/DNS/socket)
//    PARSE              Page returned but our parser couldn't read it
//    UNKNOWN            Anything else — full error message in `error`
// ─────────────────────────────────────────────────────────────────────────────

import { ScreenerScraperPro } from "./node_modules/screener-scraper-pro/dist/index.js";
import { syncBoardMeetings } from "./nse_announcements.js";

function toConsolidatedUrl(url) {
  return url.replace(/\/(consolidated\/)?$/, "/consolidated/");
}

async function scrapeWithFallback(baseUrl) {
  const consolidatedUrl = toConsolidatedUrl(baseUrl);
  try {
    const data = await ScreenerScraperPro(consolidatedUrl);
    if (data?.quarters?.headers?.length > 0) {
      return { data, isConsolidated: true };
    }
  } catch (err) {
    // fall through to standalone
  }
  const data = await ScreenerScraperPro(baseUrl);
  return { data, isConsolidated: false };
}

// Classify a thrown error into one of our error codes
function classifyError(err) {
  const msg = (err?.message || String(err)).toLowerCase();
  if (msg.includes("404") || msg.includes("not found"))             return "NOT_FOUND";
  if (msg.includes("timeout") || msg.includes("econnreset") ||
      msg.includes("etimedout") || msg.includes("network") ||
      msg.includes("fetch failed"))                                  return "NETWORK";
  if (msg.includes("parse") || msg.includes("cheerio") ||
      msg.includes("unexpected token"))                              return "PARSE";
  return "UNKNOWN";
}

/**
 * SCREENER ONLY — scrape Screener.in for `symbol` and upsert into
 * stocks/financials/results. Does NOT call NSE sync.
 *
 * @returns {Promise<{ok, stock?, quarters?, error?, errorCode?}>}
 */
export async function scrapeScreener(symbol, opts, supabase) {
  const sym = symbol.toUpperCase();
  const screenerUrl = `https://www.screener.in/company/${sym}/`;
  const today = new Date().toISOString().split("T")[0];

  let data, isConsolidated;
  try {
    const result = await scrapeWithFallback(screenerUrl);
    data           = result.data;
    isConsolidated = result.isConsolidated;
  } catch (err) {
    return {
      ok: false,
      error: err?.message || "Scrape failed",
      errorCode: classifyError(err),
    };
  }

  try {
    const { headers = [], data: qData = {} } = data?.quarters ?? {};
    if (!headers.length) {
      return {
        ok: false,
        error: `No quarterly results table on Screener.in (page exists but no published quarters yet — likely recent listing or filing pending)`,
        errorCode: "NO_QUARTERLY_DATA",
      };
    }

    const fields    = Object.keys(qData);
    const isBanking = fields.includes("Financing Profit");
    const newLastQ  = headers.at(-1) ?? null;

    // 1. Upsert stocks
    const stockRow = {
      symbol:          sym,
      name:            opts?.name        ?? sym,
      screener_url:    screenerUrl,
      screener_id:     opts?.screenerId  ?? null,
      yahoo_symbol:    opts?.yahooSymbol ?? null,
      is_consolidated: isConsolidated,
      is_banking:      isBanking,
    };
    const { error: se } = await supabase.from("stocks").upsert(stockRow);
    if (se) return { ok: false, error: `stocks upsert: ${se.message}`, errorCode: "UNKNOWN" };

    // 2. Upsert financials
    const { error: fe } = await supabase.from("financials").upsert({
      symbol:     sym,
      cagrs:      data?.CAGRs    ?? null,
      analysis:   data?.analysis ?? null,
      fetched_at: new Date().toISOString(),
    });
    if (fe) return { ok: false, error: `financials upsert: ${fe.message}`, errorCode: "UNKNOWN" };

    // 3. Upsert one row per quarter
    for (const quarter of headers) {
      const rowData = {};
      for (const [metric, values] of Object.entries(qData)) {
        if (values[quarter] != null) rowData[metric] = values[quarter];
      }

      const payload = {
        symbol:      sym,
        quarter,
        data:        rowData,
        modified_at: new Date().toISOString(),
      };

      // Mark the newest quarter as reported today (for marker placement)
      // — only if NSE hasn't already supplied a date for it
      if (quarter === newLastQ) {
        payload.reported_at = today;
      }

      const { error: re } = await supabase.from("results").upsert(payload, {
        onConflict: "symbol,quarter",
      });
      if (re) console.warn(`  results warning [${sym} ${quarter}]: ${re.message}`);
    }

    return {
      ok:       true,
      stock:    stockRow,
      quarters: headers.length,
      headers:  headers,   // full array of quarter labels — caller uses this to detect Mar 2026
    };
  } catch (err) {
    return {
      ok: false,
      error: err?.message || "Scrape failed during persistence",
      errorCode: classifyError(err),
    };
  }
}

/**
 * Legacy wrapper: Screener scrape + NSE sync in one call.
 * Used by POST /api/watchlist so a newly added stock gets both populated immediately.
 * The background SCREENER and NSE agents handle ongoing refreshes separately.
 */
export async function scrapeAndStore(symbol, opts, supabase) {
  const result = await scrapeScreener(symbol, opts, supabase);

  if (result.ok) {
    try {
      const bm = await syncBoardMeetings(symbol.toUpperCase(), supabase);
      if (bm.written > 0) {
        console.log(`[scrape] ${symbol} board meetings synced: ${bm.written} dates`);
      }
    } catch (err) {
      console.warn(`[scrape] ${symbol} board-meeting sync failed: ${err.message}`);
    }
  }

  return result;
}
