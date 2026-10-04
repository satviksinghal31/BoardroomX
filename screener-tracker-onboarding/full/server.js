import "dotenv/config";
import express from "express";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createStore } from "./lib/store.mjs";
import { ScreenerCollector } from "./lib/screener.mjs";
import { createStorage } from "./lib/storage.mjs";
import { runBatch } from "./lib/worker.mjs";
export function createApp({ store, launch = () => {} } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.get("/health", (_req, res) =>
    res.json({ ok: true, stage: "screener-worker" }),
  );
  app.get("/api/screener/runs/current", async (_req, res, next) => {
    try {
      if (!store)
        return res.status(503).json({ error: "Worker is not configured" });
      res.set("Cache-Control", "no-store").json(await store.current());
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/screener/runs", async (req, res, next) => {
    try {
      if (!store)
        return res.status(503).json({ error: "Worker is not configured" });
      const body = req.body || {};
      if (Object.keys(body).some((k) => k !== "symbols"))
        return res.status(400).json({ error: "Invalid request" });
      let symbols;
      if (body.symbols !== undefined) {
        if (
          !Array.isArray(body.symbols) ||
          !body.symbols.length ||
          body.symbols.length > 20 ||
          body.symbols.some(
            (s) => typeof s !== "string" || !s.trim() || s.length > 32,
          )
        )
          return res.status(400).json({ error: "Invalid test company list" });
        symbols = [...new Set(body.symbols.map((s) => s.trim().toUpperCase()))];
      }
      const run = await store.start(symbols);
      res.status(202).json({ run });
      launch(run.id);
    } catch (e) {
      next(e);
    }
  });
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
  app.use(express.static(fileURLToPath(new URL("./public", import.meta.url))));
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  app.use((err, _req, res, _next) => {
    if (!err.status || err.status >= 500)
      console.error("Request failed:", err.message);
    res
      .status(err.status || 500)
      .json({
        error:
          err.status && err.status < 500
            ? err.message
            : "Server could not complete the request",
      });
  });
  return app;
}
export async function startServer() {
  const store = createStore();
  const collector = new ScreenerCollector();
  const storage = createStorage();
  await store.startup();
  await storage.initialize();
  let active = null,
    stopping = false;
  const launch = (id) => {
    active = {
      id,
      promise: runBatch(id, { store, collector, save: storage.save })
        .catch((e) => console.error("Batch stopped:", e.message))
        .finally(() => {
          if (active?.id === id) active = null;
        }),
    };
  };
  const app = createApp({ store, launch });
  const server = app.listen(process.env.PORT || 3001, () =>
    console.log("BoardroomX Screener worker listening"),
  );
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    server.close();
    if (active)
      await store
        .interrupt(active.id)
        .catch((e) => console.error("Cannot record interruption:", e.message));
    await collector.close();
    if (active) await active.promise;
    await store.close();
    process.exit(0);
  };
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () => {
      const deadline = setTimeout(() => process.exit(1), 15000);
      deadline.unref();
      stop().catch((e) => {
        console.error(e.message);
        process.exit(1);
      });
    });
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  startServer().catch((e) => {
    console.error("Worker startup failed:", e.message);
    process.exit(1);
  });
