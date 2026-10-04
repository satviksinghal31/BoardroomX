import Ajv from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
const schema = JSON.parse(
  readFileSync(
    new URL("../docs/screener-worker/company.schema.v3.json", import.meta.url),
    "utf8",
  ),
);
const validate = new Ajv({ allErrors: true }).compile(schema);
export function checkSections(data, symbol) {
  if (
    !data.overview?.company_name ||
    (!data.overview.market_cap && !data.overview.current_price)
  )
    throw Error("Overview is missing");
  if (
    data.overview.nse_symbol &&
    data.overview.nse_symbol.toUpperCase() !== symbol &&
    data.overview.bse_code !== symbol
  )
    throw Error("Company identity mismatch");
  for (const [key, t] of Object.entries({
    quarterly_results: data.quarterly_results,
    profit_and_loss: data.profit_and_loss,
    balance_sheet: data.balance_sheet,
    cash_flows: data.cash_flows,
    ratios: data.ratios,
    shareholding_quarterly: data.shareholding_pattern?.quarterly,
    shareholding_yearly: data.shareholding_pattern?.yearly,
  })) {
    if (
      !t?.periods?.length ||
      !t.rows?.length ||
      !t.rows.some((r) => r.values.some((v) => v !== null && v !== ""))
    )
      throw Error(`Missing or empty section: ${key}`);
    if (t.rows.some((r) => r.values.length !== t.periods.length))
      throw Error(`Misaligned table: ${key}`);
  }
}
export function validateCompany(data, symbol = data.overview?.symbol) {
  checkSections(data, symbol);
  if (!validate(data))
    throw Error(
      "Invalid company JSON: " +
        validate.errors.map((e) => `${e.instancePath} ${e.message}`).join("; "),
    );
  for (const [range, c] of Object.entries(data.chart_snapshots))
    if (!c.image || !c.captured_at || c.range !== range)
      throw Error("Missing chart: " + range);
  return data;
}
