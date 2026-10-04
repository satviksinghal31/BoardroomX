import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateCompany } from "../lib/contract.mjs";
function sample() {
  const data = JSON.parse(
    readFileSync(
      new URL(
        "../docs/screener-worker/company.sample.v3.json",
        import.meta.url,
      ),
    ),
  );
  data.contract_version = "3.0.0";
  return data;
}
test("display strings and legitimate blanks pass without individual field checks", () => {
  const d = sample();
  d.overview.stock_pe = null;
  assert.equal(validateCompany(d), d);
});
test("bank rows need not match industrial-company rows", () => {
  const d = sample();
  d.quarterly_results.rows = [
    {
      label: "Interest Earned",
      values: d.quarterly_results.periods.map(() => "123"),
    },
  ];
  d.ratios.rows = [
    { label: "ROE %", values: d.ratios.periods.map(() => "12%") },
  ];
  assert.equal(validateCompany(d), d);
});
test("missing sections, wrong company, missing chart and misaligned values fail", () => {
  for (const change of [
    (d) => {
      delete d.balance_sheet;
    },
    (d) => (d.overview.nse_symbol = "OTHER"),
    (d) => {
      delete d.chart_snapshots.max;
    },
    (d) => d.ratios.rows[0].values.pop(),
    (d) => (d.cash_flows.rows = []),
    (d) => (d.chart_snapshots.max.volume_included = false),
  ]) {
    const d = sample();
    change(d);
    assert.throws(() => validateCompany(d));
  }
});
