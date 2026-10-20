// A tiny in-memory stand-in for Upstash's REST API (single commands + /pipeline), enough for Spark's server.
import http from "http";
export function startMock(port, { failNext = null } = {}) {
  const H = {}, Z = {}, SETS = {}, KV = {}, EXP = {};
  const h = (k) => (H[k] ||= {}), z = (k) => (Z[k] ||= {}), st = (k) => (SETS[k] ||= new Set());
  const live = (k) => { if (EXP[k] && EXP[k] < Date.now()) { delete KV[k]; delete EXP[k]; } return KV[k]; };
  const state = { H, Z, KV, failNext, failWhen: null, calls: 0 };
  function run(c) {
    const [cmd, ...a] = c; const C = String(cmd).toUpperCase();
    if (C === "HGET") return h(a[0])[a[1]] ?? null;
    if (C === "HSET") { for (let i = 1; i < a.length; i += 2) h(a[0])[a[i]] = String(a[i + 1]); return 1; }
    if (C === "HSETNX") { if (h(a[0])[a[1]] !== undefined) return 0; h(a[0])[a[1]] = String(a[2]); return 1; }
    if (C === "HDEL") { let n = 0; a.slice(1).forEach((k) => { if (k in h(a[0])) { delete h(a[0])[k]; n++; } }); return n; }
    if (C === "HMGET") return a.slice(1).map((k) => h(a[0])[k] ?? null);
    if (C === "ZADD") { z(a[0])[a[2]] = +a[1]; return 1; }
    if (C === "ZRANGEBYSCORE") {
      const [k, min, , , , off, cnt] = a; const ex = String(min).startsWith("("); const lo = +String(min).replace("(", "");
      const rows = Object.entries(z(k)).filter(([, s]) => (ex ? s > lo : s >= lo)).sort((x, y) => x[1] - y[1]).slice(+off, +off + +cnt);
      return rows.flatMap(([m, s]) => [m, String(s)]);
    }
    if (C === "SADD") { a.slice(1).forEach((x) => st(a[0]).add(x)); return 1; }
    if (C === "SMEMBERS") return [...st(a[0])];
    if (C === "GET") return live(a[0]) ?? null;
    if (C === "SET") {
      const nx = a.map(String).map((x) => x.toUpperCase()).includes("NX"); const pxI = a.map(String).map((x) => x.toUpperCase()).indexOf("PX");
      if (nx && live(a[0]) !== undefined) return null;
      KV[a[0]] = String(a[1]); if (pxI > 0) EXP[a[0]] = Date.now() + +a[pxI + 1]; else delete EXP[a[0]]; return "OK";
    }
    if (C === "DEL") { let n = 0; a.forEach((k) => { if (live(k) !== undefined) { delete KV[k]; n++; } }); return n; }
    if (C === "INCR") { const v = (+(live(a[0]) || 0)) + 1; KV[a[0]] = String(v); return v; }
    if (C === "EXPIRE") { if (live(a[0]) !== undefined) EXP[a[0]] = Date.now() + +a[1] * 1000; return 1; }
    throw new Error("unknown " + C);
  }
  const srv = http.createServer((req, res) => {
    let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
      state.calls++;
      const body = JSON.parse(b); let out;
      if (state.failNext && state.failNext-- > 0) { res.statusCode = 500; res.end('{"error":"boom"}'); return; }
      if (state.failWhen && state.failWhen(body)) { res.setHeader("content-type", "application/json"); res.end('{"error":"injected failure"}'); return; }
      try { out = req.url.endsWith("/pipeline") ? body.map((c) => ({ result: run(c) })) : { result: run(body) }; } catch (e) { out = { error: e.message }; }
      res.setHeader("content-type", "application/json"); res.end(JSON.stringify(out));
    });
  });
  return new Promise((r) => srv.listen(port, () => r({ srv, ...state, state })));
}
