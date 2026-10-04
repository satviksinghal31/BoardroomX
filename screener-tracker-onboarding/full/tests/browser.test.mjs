import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createApp } from "../server.js";
test(
  "Workers UI: Start, running, completion, failure drawer and mobile layout",
  { skip: process.env.BROWSER_QA !== "1", timeout: 30000 },
  async () => {
    let run = null,
      starts = 0;
    const store = {
      async current() {
        return { run, universe_total: 3 };
      },
      async start() {
        starts++;
        run = {
          id: "browser-qa",
          status: "running",
          total: 3,
          pass: "first",
          processed: 0,
          successful: 0,
          failed: 0,
          awaiting_retry: 0,
          current_company: "TCS",
          started_at: new Date().toISOString(),
          failures: [],
        };
        return run;
      },
    };
    const server = createApp({ store }).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto("http://127.0.0.1:" + server.address().port);
      await page.waitForFunction(
        () => !document.querySelector("#start").disabled,
      );
      await page.getByRole("button", { name: "Collapse navigation" }).click();
      assert.equal(
        await page
          .locator("#rail")
          .evaluate((e) => e.getBoundingClientRect().width),
        60,
      );
      await page.getByRole("button", { name: "Start refresh" }).click();
      await page.waitForFunction(
        () => document.querySelector("#status").textContent === "Running",
      );
      assert.equal(await page.locator("#start").isDisabled(), true);
      assert.equal(starts, 1);
      Object.assign(run, {
        status: "completed_with_failures",
        processed: 3,
        successful: 2,
        failed: 1,
        pass: "retry",
        current_company: null,
        finished_at: new Date().toISOString(),
        failures: [
          {
            symbol: "SBIN",
            status: "failed",
            attempts: 2,
            error: "Missing section: quarterly_results",
          },
        ],
      });
      await page.waitForFunction(
        () =>
          document.querySelector("#status").textContent ===
          "Completed with failures",
      );
      assert.equal(await page.locator("#start").isDisabled(), false);
      assert.match(await page.locator("#processed").textContent(), /3 \/ 3/);
      await page.getByRole("button", { name: "View failures" }).click();
      assert.equal(await page.locator("#drawer").isVisible(), true);
      assert.match(
        await page.locator("#failure-list").textContent(),
        /SBIN.*2\/2 attempts.*Missing section/,
      );
      await page.getByRole("button", { name: "Close failure details" }).click();
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await new Promise((r) => server.close(r));
    }
  },
);
