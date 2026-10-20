// Browser-side sync tests: a real Chromium against the real api/ handlers backed by the fake Redis.
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const ok = (n, c, x) => { console.log((c ? "PASS" : "FAIL") + "  " + n + (x !== undefined ? "  (" + x + ")" : "")); if (!c) process.exitCode = 1; };
const pull = () => fetch("http://localhost:8800/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "secret-code", since: 0, push: [] }) }).then((r) => r.json());
const serverHas = async (coll, id) => (await pull()).items.find((x) => x.coll === coll && x.item.id === id);

(async () => {
  const srv = spawn("node", [".test/server.mjs"], { cwd: ROOT });
  await new Promise((r) => srv.stdout.on("data", (d) => String(d).includes("up") && r()));
  const b = await chromium.launch();
  const errs = [];
  const newDevice = async () => {
    const ctx = await b.newContext({ viewport: { width: 1100, height: 850 } }); const pg = await ctx.newPage();
    pg.on("pageerror", (e) => errs.push(e.message));
    await pg.goto("http://localhost:8800/");
    await pg.evaluate(() => { SYNC.code = "secret-code"; saveSync(); });
    return pg;
  };
  try {
    const T = require("./client.tests.cjs");
    for (const [name, fn] of Object.entries(T)) {
      try { await fn({ newDevice, ok, serverHas, pull }); } catch (e) { ok(name + " threw", false, e.message); }
    }
    ok("no page errors", !errs.length, errs.join(" | "));
  } finally { await b.close(); srv.kill(); }
})();
