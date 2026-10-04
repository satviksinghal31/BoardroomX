// Runs inside the browser. Preserve source labels, periods and display strings.
export function extractCompany({ symbol, url, basis }) {
  const text = (x) => x?.textContent?.replace(/\s+/g, " ").trim() || null;
  const absolute = (x) => (x ? new URL(x, location.href).href : null);
  function table(id, index = 0, unit = "Rs. Crores") {
    const el = document.querySelectorAll(id + " table.data-table")[index];
    if (!el) return { basis, unit, periods: [], rows: [] };
    const periods = [...el.querySelectorAll("thead tr th")]
      .map(text)
      .filter(Boolean);
    const rows = [];
    let filing_links = [];
    for (const tr of el.querySelectorAll("tbody tr")) {
      const cells = [...tr.querySelectorAll(":scope > td")];
      if (!cells.length) continue;
      const label = text(cells[0])?.replace(/\s*\+\s*$/, "");
      if (!label) continue;
      if (label === "Raw PDF") {
        filing_links = cells
          .slice(1)
          .map((td) => absolute(td.querySelector("a")?.getAttribute("href")));
        continue;
      }
      rows.push({ label, values: periods.map((_, i) => text(cells[i + 1])) });
    }
    return {
      basis,
      unit,
      periods,
      rows,
      ...(filing_links.length ? { filing_links } : {}),
    };
  }
  const metrics = {};
  for (const li of document.querySelectorAll("#top-ratios li"))
    metrics[text(li.querySelector(".name"))] = text(li.querySelector(".value"));
  const links = [...document.querySelectorAll("a[href]")].map((a) => ({
    text: text(a) || "",
    url: a.href,
  }));
  const top = document.querySelector("#top");
  const quote = document.querySelector(".font-size-18.strong");
  const change = quote?.querySelector(".up,.down");
  const overview = {
    symbol,
    company_name: text(document.querySelector("#top h1")),
    website:
      [...top.querySelectorAll("a[href]")].find(
        (a) =>
          a.href.startsWith("http") &&
          !/screener\.in|bseindia\.com|nseindia\.com/.test(
            new URL(a.href).hostname,
          ),
      )?.href || null,
    nse_symbol:
      links
        .find((l) => l.text.startsWith("NSE:"))
        ?.text.replace(/^NSE:\s*/, "") || null,
    bse_code:
      links
        .find((l) => l.text.startsWith("BSE:"))
        ?.text.replace(/^BSE:\s*/, "") || null,
    logo_url: absolute(
      document.querySelector("#top h1 img")?.getAttribute("src"),
    ),
    price_change_percent: change
      ? (change.classList.contains("down") && !text(change)?.startsWith("-")
          ? "-"
          : "") + text(change)
      : null,
    price_as_of: text(quote?.querySelector(".font-size-11")),
    market_cap: metrics["Market Cap"] || null,
    current_price: metrics["Current Price"] || null,
    high_low: metrics["High / Low"] || null,
    stock_pe: metrics["Stock P/E"] || null,
    book_value: metrics["Book Value"] || null,
    dividend_yield: metrics["Dividend Yield"] || null,
    roce: metrics.ROCE || null,
    roe: metrics.ROE || null,
    face_value: metrics["Face Value"] || null,
    about: text(document.querySelector(".company-profile .about")),
    key_points: text(document.querySelector(".company-profile .commentary")),
  };
  const growth_metrics = {};
  for (const table of document.querySelectorAll(
    "#profit-loss table.ranges-table",
  )) {
    const label = text(table.querySelector("th"));
    if (!label) continue;
    const periods = {};
    for (const tr of table.querySelectorAll("tr")) {
      const td = tr.querySelectorAll("td");
      if (td.length === 2) periods[text(td[0]).replace(/:$/, "")] = text(td[1]);
    }
    growth_metrics[label] = periods;
  }
  return {
    contract_version: "3.0.0",
    source: {
      url,
      basis,
      fetched_at: new Date().toISOString(),
      scraper_name: "playwright",
      scraper_version: "1.61.0",
    },
    overview,
    chart_snapshots: {},
    quarterly_results: table("#quarters"),
    profit_and_loss: { ...table("#profit-loss"), growth_metrics },
    balance_sheet: table("#balance-sheet"),
    cash_flows: table("#cash-flow"),
    ratios: table("#ratios", 0, "As displayed on Screener"),
    shareholding_pattern: {
      unit: "Percentages; No. of Shareholders is a count",
      quarterly: table(
        "#shareholding",
        0,
        "Percentages; shareholder count is a count",
      ),
      yearly: table(
        "#shareholding",
        1,
        "Percentages; shareholder count is a count",
      ),
    },
  };
}
