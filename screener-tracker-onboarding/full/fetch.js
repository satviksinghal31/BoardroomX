import { ScreenerScraperPro } from "./node_modules/screener-scraper-pro/dist/index.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const portfolio = JSON.parse(readFileSync(join(__dirname, "portfolio.json"), "utf8"));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Sort quarters chronologically: "Mar 2023" < "Jun 2023" < ...
const Q_ORDER = { Mar: 0, Jun: 1, Sep: 2, Dec: 3 };
function quarterSort(a, b) {
  const [am, ay] = a.split(" ");
  const [bm, by] = b.split(" ");
  return parseInt(ay) !== parseInt(by)
    ? parseInt(ay) - parseInt(by)
    : Q_ORDER[am] - Q_ORDER[bm];
}

function toConsolidatedUrl(url) {
  return url.replace(/\/(consolidated\/)?$/, "/consolidated/");
}

async function scrapeWithFallback(company) {
  const consolidatedUrl = toConsolidatedUrl(company.url);
  try {
    const data = await ScreenerScraperPro(consolidatedUrl);
    if (data.quarters?.headers?.length > 0) return { data, isConsolidated: true };
  } catch {}
  const data = await ScreenerScraperPro(company.url);
  return { data, isConsolidated: false };
}

async function fetchAndStore(company) {
  console.log(`\nFetching: ${company.name} (${company.symbol})...`);
  try {
    const { data, isConsolidated } = await scrapeWithFallback(company);

    const fields    = Object.keys(data.quarters?.data ?? {});
    const isBanking = fields.includes("Financing Profit");
    const { headers = [], data: qData = {} } = data.quarters ?? {};
    const newLastQ  = headers.at(-1) ?? null;

    // Read current latest quarter from results table
    const { data: existingRows } = await supabase
      .from("results")
      .select("quarter, expected_at")
      .eq("symbol", company.symbol)
      .not("data", "is", null)
      .order("quarter", { ascending: false })
      .limit(1);

    const prevLastQ      = existingRows?.[0]?.quarter ?? null;
    const newQuarterPopped = newLastQ && newLastQ !== prevLastQ;

    // 1. Upsert stocks (is_consolidated + is_banking now live here)
    const { error: se } = await supabase.from("stocks").upsert({
      symbol:          company.symbol,
      name:            company.name,
      screener_url:    company.url,
      screener_id:     company.screenerId  ?? null,
      yahoo_symbol:    company.yahooSymbol ?? null,
      is_consolidated: isConsolidated,
      is_banking:      isBanking,
    });
    if (se) throw new Error(`stocks upsert: ${se.message}`);

    // 2. Upsert financials (cagrs + analysis only — no quarters)
    const { error: fe } = await supabase.from("financials").upsert({
      symbol:     company.symbol,
      cagrs:      data.CAGRs    ?? null,
      analysis:   data.analysis ?? null,
      fetched_at: new Date().toISOString(),
    });
    if (fe) throw new Error(`financials upsert: ${fe.message}`);

    // 3. Upsert one row per quarter into results
    const today = new Date().toISOString().split("T")[0];

    for (const quarter of headers) {
      // Build flat data object for this quarter
      const rowData = {};
      for (const [metric, values] of Object.entries(qData)) {
        if (values[quarter] != null) rowData[metric] = values[quarter];
      }

      const payload = {
        symbol:      company.symbol,
        quarter,
        data:        rowData,
        modified_at: new Date().toISOString(),
      };

      // For the newly appeared quarter, record reported_at
      // Use the expected_at already stored by fetch_ann.py if available
      if (newQuarterPopped && quarter === newLastQ) {
        const { data: newQRow } = await supabase
          .from("results")
          .select("expected_at")
          .eq("symbol", company.symbol)
          .eq("quarter", newLastQ)
          .maybeSingle();

        payload.reported_at = newQRow?.expected_at ?? today;
        // Don't set expected_at here — fetch_ann.py owns that field
      }

      const { error: re } = await supabase.from("results").upsert(payload, {
        onConflict: "symbol,quarter",
      });
      if (re) console.warn(`  results warning [${quarter}]: ${re.message}`);
    }

    if (newQuarterPopped) {
      console.log(`  ★ New quarter: ${prevLastQ ?? "none"} → ${newLastQ}`);
    }

    const tag = `[${isConsolidated ? "Consolidated" : "Standalone"}]${isBanking ? " [Banking]" : ""}`;
    console.log(`  ${tag} ${headers.length} quarters, latest: ${newLastQ ?? "unknown"}`);
  } catch (err) {
    console.error(`  Error: ${err.message}`);
  }
}

async function main() {
  const symbols = process.argv.slice(2).map(s => s.toUpperCase());
  const targets = symbols.length
    ? portfolio.filter(c => symbols.includes(c.symbol))
    : portfolio;

  if (!targets.length) {
    console.log("No matching companies. Check portfolio.json or your symbol args.");
    process.exit(1);
  }

  for (const company of targets) await fetchAndStore(company);
  console.log("\nDone.");
}

main();
