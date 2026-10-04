import { setTimeout as sleep } from "node:timers/promises";
export async function runBatch(
  id,
  { store, collector, save, delay = sleep, interval = 2000 },
) {
  try {
    for (const [pass, status] of [
      ["first", "pending"],
      ["retry", "awaiting_retry"],
    ]) {
      if (!(await store.isRunning(id))) return;
      await store.setPass(id, pass);
      const items = await store.listItems(id, status);
      for (const { symbol } of items) {
        if (!(await store.isRunning(id))) return;
        await store.fetching(id, symbol);
        let data = null,
          error = null;
        try {
          data = await save(await collector.collect(symbol), id, symbol);
        } catch (e) {
          error = String(e.message || e).slice(0, 1000);
        }
        if (!(await store.isRunning(id))) return;
        await store.outcome(id, symbol, data, error, pass === "retry");
        await delay(interval);
      }
    }
    if (await store.isRunning(id)) await store.finish(id);
  } catch (e) {
    await store.interrupt(id, String(e.message || e)).catch(() => {});
    throw e;
  }
}
