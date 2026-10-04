import test from "node:test";
import assert from "node:assert/strict";
import { ScreenerCollector } from "../lib/screener.mjs";
test("concurrent data requests are spaced and respect a cooldown", async () => {
  const collector = new ScreenerCollector({ interval: 25 });
  const times = [];
  await Promise.all([
    collector.pace().then(() => times.push(Date.now())),
    collector.pace().then(() => times.push(Date.now())),
    collector.pace().then(() => times.push(Date.now())),
  ]);
  assert(times[1] - times[0] >= 24);
  assert(times[2] - times[1] >= 24);
  collector.cooldownUntil = Date.now() + 50;
  const earliest = collector.cooldownUntil;
  await collector.pace();
  assert(Date.now() >= earliest);
});
