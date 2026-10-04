import { chromium } from "playwright";
import { setTimeout as sleep } from "node:timers/promises";
import { extractCompany } from "./extract.mjs";
import { checkSections, validateCompany } from "./contract.mjs";
export class ScreenerCollector {
  constructor({ interval = 2000 } = {}) {
    this.interval = interval;
    this.lastRequest = 0;
    this.cooldownUntil = 0;
    this.requestTail = Promise.resolve();
  }
  async pace() {
    const task = this.requestTail.then(async () => {
      let wait;
      while (
        (wait =
          Math.max(this.lastRequest + this.interval, this.cooldownUntil) -
          Date.now()) > 0
      )
        await sleep(wait);
      this.lastRequest = Date.now();
    });
    this.requestTail = task.catch(() => {});
    return task;
  }
  async collect(symbol) {
    if (!this.browser?.isConnected())
      this.browser = await chromium.launch({ headless: true });
    const page = await this.browser.newPage({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 1,
    });
    page.setDefaultTimeout(45000);
    page.on("response", (response) => {
      if (response.status() !== 429) return;
      const value = response.headers()["retry-after"];
      const seconds = Number(value);
      const until =
        value && Number.isFinite(seconds)
          ? Date.now() + seconds * 1000
          : value
            ? Date.parse(value)
            : NaN;
      this.cooldownUntil = Math.max(
        this.cooldownUntil,
        Number.isFinite(until) && until > Date.now()
          ? until
          : Date.now() + 60000,
      );
    });
    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        url.hostname === "www.screener.in" &&
        ["document", "xhr", "fetch"].includes(request.resourceType())
      )
        await this.pace();
      await route.continue().catch(() => {});
    });
    try {
      let data, lastError;
      for (const basis of ["consolidated", "standalone"]) {
        try {
          const url = `https://www.screener.in/company/${encodeURIComponent(symbol)}/${basis === "consolidated" ? "consolidated/" : ""}`;
          const response = await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 60000,
          });
          if (!response?.ok())
            throw Error("Screener HTTP " + response?.status());
          await page.locator("#top h1").waitFor({ state: "visible" });
          const actual = new URL(page.url());
          if (
            actual.hostname !== "www.screener.in" ||
            !actual.pathname.startsWith(
              `/company/${encodeURIComponent(symbol)}/`,
            )
          )
            throw Error("Unexpected company page");
          data = await page.evaluate(extractCompany, {
            symbol,
            url: page.url(),
            basis: actual.pathname.includes("/consolidated/")
              ? "consolidated"
              : "standalone",
          });
          checkSections(data, symbol);
          break;
        } catch (e) {
          lastError = e;
          data = null;
          if (basis === "standalone") throw lastError;
        }
      }
      const images = {};
      await page.locator("#chart").scrollIntoViewIfNeeded();
      await page.waitForFunction(
        () =>
          Object.values(window.Chart?.instances || {}).some((c) =>
            c.data.datasets.some(
              (d) => d.label?.startsWith("Price") && d.data.length > 0,
            ),
          ),
        null,
        { timeout: 45000 },
      );
      for (const [range, label, days] of [
        ["1y", "1Yr", "365"],
        ["3y", "3Yr", "1095"],
        ["5y", "5Yr", "1825"],
        ["max", "Max", "10000"],
      ]) {
        let expected = null;
        if (
          range !== "1y" ||
          (await page
            .locator("#company-chart-days button.active")
            .textContent()
            .then((t) => t.trim())) !== label
        ) {
          const [r] = await Promise.all([
            page.waitForResponse(
              (r) =>
                r.url().includes("/chart/") &&
                new URL(r.url()).searchParams.get("days") === days,
              { timeout: 45000 },
            ),
            page
              .locator("#company-chart-days")
              .getByRole("button", { name: label, exact: true })
              .click(),
          ]);
          if (!r.ok()) throw Error(`Chart ${range}: HTTP ${r.status()}`);
          expected = (await r.json()).datasets?.find((d) =>
            d.label?.startsWith("Price"),
          );
          if (!expected?.values?.length && !expected?.data?.length)
            throw Error("Empty chart response " + range);
        }
        if (expected) {
          const values = expected.data || expected.values;
          await page.waitForFunction(
            ({ length, first, last }) =>
              Object.values(window.Chart?.instances || {}).some((c) =>
                c.data.datasets.some(
                  (d) =>
                    d.label?.startsWith("Price") &&
                    d.data.length === length &&
                    String(d.data[0]?.x) === first &&
                    String(d.data.at(-1)?.x) === last,
                ),
              ),
            {
              length: values.length,
              first: String(values[0]?.x ?? values[0]?.[0]),
              last: String(values.at(-1)?.x ?? values.at(-1)?.[0]),
            },
          );
        }
        // Let the page finish handling the chart response and settle its canvas animation.
        await page.waitForFunction(
          (expected) =>
            document
              .querySelector("#company-chart-days button.active")
              ?.textContent.trim() === expected &&
            Object.values(window.Chart?.instances || {}).some((c) =>
              c.data.datasets.some(
                (d) => d.label?.startsWith("Price") && d.data.length > 0,
              ),
            ),
          label,
        );
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        const state = await page.evaluate(() => {
          for (const c of Object.values(window.Chart?.instances || {})) {
            c.stop();
            c.update("none");
          }
          return Object.values(window.Chart?.instances || {}).flatMap((c) =>
            c.data.datasets.map((d) => ({
              label: d.label,
              points: d.data.length,
              first: d.data[0],
              last: d.data.at(-1),
            })),
          );
        });
        const price = state.find(
          (d) => d.label?.startsWith("Price") && d.points > 0,
        );
        if (!price) throw Error("Empty price chart " + range);
        if (!state.some((d) => d.label === "Volume" && d.points > 0))
          throw Error("Empty volume chart " + range);
        images[range] = await page
          .locator("#chart")
          .screenshot({ type: "png" });
        data.chart_snapshots[range] = {
          range,
          image: `pending/${range}.png`,
          captured_at: new Date().toISOString(),
          source_url: data.source.url,
          price_label: price.label,
          volume_included: state.some(
            (d) => d.label === "Volume" && d.points > 0,
          ),
        };
      }
      validateCompany(data, symbol);
      return { data, images };
    } finally {
      await page.close().catch(() => {});
    }
  }
  async close() {
    await this.browser?.close();
  }
}
