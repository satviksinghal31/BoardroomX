import test from "node:test";
import assert from "node:assert/strict";
import { runBatch } from "../lib/worker.mjs";
function repository(symbols) {
  const items = symbols.map((symbol) => ({
    symbol,
    status: "pending",
    attempts: 0,
  }));
  return {
    items,
    active: true,
    pass: "first",
    events: [],
    async isRunning() {
      return this.active;
    },
    async listItems(_id, status) {
      return items.filter((i) => i.status === status);
    },
    async setPass(_id, pass) {
      this.pass = pass;
      this.events.push(pass);
    },
    async fetching(_id, symbol) {
      items.find((i) => i.symbol === symbol).status = "fetching";
    },
    async outcome(_id, symbol, data, error, final) {
      const i = items.find((i) => i.symbol === symbol);
      i.attempts++;
      i.status = data ? "successful" : final ? "failed" : "awaiting_retry";
      i.error = error;
      this.events.push(symbol + ":" + i.status);
    },
    async finish() {
      this.finished = true;
    },
    async interrupt() {
      this.active = false;
      this.interrupted = true;
    },
  };
}
test("first pass covers all companies before one retry; each has a single final outcome", async () => {
  const store = repository(["A", "B", "C"]);
  const calls = [];
  await runBatch("run", {
    store,
    collector: {
      async collect(symbol) {
        calls.push(symbol);
        if (
          symbol === "B" ||
          (symbol === "C" && calls.filter((s) => s === "C").length === 1)
        )
          throw Error("missing section");
        return { symbol };
      },
    },
    save: async (data) => data,
    delay: async () => {},
    interval: 2,
  });
  assert.deepEqual(calls, ["A", "B", "C", "B", "C"]);
  assert.deepEqual(
    store.items.map((i) => [i.status, i.attempts]),
    [
      ["successful", 1],
      ["failed", 2],
      ["successful", 2],
    ],
  );
  assert.equal(store.finished, true);
  assert.equal(
    store.items.filter((i) => ["successful", "failed"].includes(i.status))
      .length,
    3,
  );
});
test("storage failure is a failed attempt, never a successful scrape", async () => {
  const store = repository(["A"]);
  await runBatch("run", {
    store,
    collector: { collect: async () => ({}) },
    save: async () => {
      throw Error("Storage unavailable");
    },
    delay: async () => {},
  });
  assert.equal(store.items[0].status, "failed");
  assert.equal(store.items[0].attempts, 2);
});
test("DB failure stops run and marks it not completed instead of claiming completion", async () => {
  const store = repository(["A"]);
  store.outcome = async () => {
    throw Error("DB unavailable");
  };
  await assert.rejects(
    runBatch("run", {
      store,
      collector: { collect: async () => ({}) },
      save: async (d) => d,
      delay: async () => {},
    }),
    /DB unavailable/,
  );
  assert.equal(store.interrupted, true);
  assert.equal(store.finished, undefined);
});
test("interrupted batch does not continue fetching or automatically restart", async () => {
  const store = repository(["A", "B"]);
  const calls = [];
  await runBatch("run", {
    store,
    collector: {
      async collect(s) {
        calls.push(s);
        store.active = false;
        return {};
      },
    },
    save: async (d) => d,
    delay: async () => {},
  });
  assert.deepEqual(calls, ["A"]);
  assert.equal(store.finished, undefined);
});
