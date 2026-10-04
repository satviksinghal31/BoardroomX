import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.js";
test("server keeps retired routes removed", { timeout: 10000 }, async () => {
  const app = createApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(url + "/health")).status, 200);
    for (const path of ["/api/auth/me", "/auth.html", "/auth.js", "/auth.css"])
      assert.equal((await fetch(url + path)).status, 404);
    for (const path of [
      "/api/auth/signin",
      "/api/auth/signup",
      "/api/auth/refresh",
      "/api/auth/signout",
    ]) {
      assert.equal(
        (
          await fetch(url + path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          })
        ).status,
        404,
      );
    }
    for (const path of [
      "/api/annuals/status",
      "/api/financials/LAURUSLABS",
      "/api/scheduler/log",
      "/api/refresh/LAURUSLABS",
    ]) {
      const response = await fetch(url + path);
      assert.equal(response.status, 404);
      assert.equal((await response.json()).error, "Not found");
    }
    const home = await (await fetch(url)).text();
    assert.match(home, /Screener refresh/);
    assert.doesNotMatch(home, /app\.js|annuals\.js|Sign in/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
