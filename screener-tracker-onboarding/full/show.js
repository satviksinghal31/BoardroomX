import { readFileSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── ANSI color helpers (no external dep needed) ──
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s) => `\x1b[96m${s}\x1b[0m`;
const yellow = (s) => `\x1b[93m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const gray = (s) => `\x1b[90m${s}\x1b[0m`;
const white = (s) => `\x1b[97m${s}\x1b[0m`;

function pad(str, len, right = false) {
  const s = String(str ?? "");
  const plain = s.replace(/\x1b\[[0-9;]*m/g, ""); // strip ANSI for length calc
  const pad = Math.max(0, len - plain.length);
  return right ? " ".repeat(pad) + s : s + " ".repeat(pad);
}

function fmtVal(val) {
  if (val === undefined || val === null || val === "") return gray("  —");
  if (typeof val === "string" && val.includes("%")) return val;
  const n = parseFloat(String(val).replace(/,/g, ""));
  if (isNaN(n)) return String(val);
  return n >= 0 ? green(String(n)) : red(String(n));
}

function yoy(curr, prev) {
  if (curr == null || prev == null) return gray("  —");
  const c = parseFloat(String(curr).replace(/,/g, ""));
  const p = parseFloat(String(prev).replace(/,/g, ""));
  if (isNaN(c) || isNaN(p) || p === 0) return gray("  —");
  const pct = ((c - p) / Math.abs(p)) * 100;
  const s = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
  return pct >= 0 ? green(s) : red(s);
}

function printTable(headers, rows) {
  const COL = 11;
  const LABEL = 20;
  const line = "─".repeat(LABEL + headers.length * (COL + 1) + 2);

  // Header row
  const hRow = [pad("", LABEL), ...headers.map((h) => pad(cyan(h), COL, true))].join(" │ ");
  console.log("  " + hRow);
  console.log("  " + line);

  for (const [label, values] of rows) {
    const cells = [pad(white(label), LABEL), ...values.map((v) => pad(fmtVal(v), COL, true))];
    console.log("  " + cells.join(" │ "));
  }
  console.log("  " + line);
}

function showCompany(symbol) {
  const filePath = join(__dirname, "data", `${symbol}.json`);
  if (!existsSync(filePath)) {
    console.log(yellow(`  No data for ${symbol}. Run: node fetch.js ${symbol}`));
    return;
  }

  const { name, quarters, CAGRs, analysis, fetchedAt } = JSON.parse(
    readFileSync(filePath, "utf8")
  );

  const qs = quarters.headers;           // e.g. ["Mar 2023", ..., "Mar 2026"]
  const metrics = Object.keys(quarters.data);
  const latestQ = qs.at(-1);
  const prevYQ = qs.at(-5) ?? null;      // same quarter last year

  console.log("\n" + bold(cyan(`━━━  ${name}  (${symbol})  ━━━`)));
  console.log(gray(`  Fetched: ${new Date(fetchedAt).toLocaleString()}   |   Quarters available: ${qs.length}`));

  // ── Latest Quarter vs YoY ──
  console.log("\n" + bold(white(`Latest Quarter: ${yellow(latestQ)}`)));
  if (prevYQ) console.log(gray(`  (YoY vs ${prevYQ})`));

  const summaryHeaders = prevYQ ? [latestQ, prevYQ, "YoY"] : [latestQ];
  const summaryRows = metrics.map((m) => {
    const curr = quarters.data[m][latestQ];
    const prev = prevYQ ? quarters.data[m][prevYQ] : null;
    return [
      m,
      prevYQ
        ? [fmtVal(curr), fmtVal(prev), yoy(curr, prev)]
        : [fmtVal(curr)],
    ];
  });
  printTable(summaryHeaders, summaryRows);

  // ── Full Quarterly Series ──
  console.log("\n" + bold(white("Quarterly Results Series  (₹ Cr)")));

  // Show last 8 quarters for readability
  const visibleQs = qs.slice(-8);
  const seriesRows = metrics.map((m) => [
    m,
    visibleQs.map((q) => quarters.data[m][q]),
  ]);
  printTable(visibleQs, seriesRows);

  // ── CAGRs ──
  if (CAGRs) {
    console.log("\n" + bold(white("Growth (CAGR)")));
    const cagrHeaders = Object.keys(Object.values(CAGRs)[0]);
    const cagrRows = Object.entries(CAGRs).map(([metric, vals]) => [
      metric,
      cagrHeaders.map((k) => vals[k]),
    ]);
    printTable(cagrHeaders, cagrRows);
  }

  // ── Analysis ──
  if (analysis) {
    console.log("\n" + bold(white("Screener Analysis")));
    if (analysis.pros?.length) {
      console.log(green("  Pros:"));
      analysis.pros.forEach((p) => console.log(green(`    ✓ ${p}`)));
    }
    if (analysis.cons?.length) {
      console.log(red("  Cons:"));
      analysis.cons.forEach((c) => console.log(red(`    ✗ ${c}`)));
    }
  }

  console.log();
}

function main() {
  const args = process.argv.slice(2).map((s) => s.toUpperCase());
  if (args.length > 0) {
    for (const sym of args) showCompany(sym);
    return;
  }
  const files = readdirSync(join(__dirname, "data")).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.log(yellow("No data yet. Run: node fetch.js"));
    return;
  }
  for (const file of files) showCompany(file.replace(".json", ""));
}

main();
