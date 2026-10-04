import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.js";
test("Start returns immediately, rejects duplicate run, validates subset and returns DB progress", async () => {
  let active = false,
    launches = 0,
    stocks;
  const store = {
    async start(symbols) {
      stocks = symbols;
      if (active) {
        const e = Error("A run is already running");
        e.status = 409;
        throw e;
      }
      active = true;
      return { id: "test", status: "running", total: 2 };
    },
    async current() {
      return {
        run: { id: "test", status: "running", processed: 1, total: 2 },
        universe_total: 2,
      };
    },
  };
  const server = createApp({
    store,
    launch() {
      launches++;
    },
  }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    const post = (body) =>
      fetch(base + "/api/screener/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    assert.equal((await post({ symbols: [] })).status, 400);
    assert.equal(
      (await post({ symbols: [" tcs ", "TCS", "SBIN"] })).status,
      202,
    );
    assert.deepEqual(stocks, ["TCS", "SBIN"]);
    assert.equal((await post({})).status, 409);
    assert.equal(launches, 1);
    const response = await fetch(base + "/api/screener/runs/current");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).run.processed, 1);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
