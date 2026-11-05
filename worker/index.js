/* Cloudflare Worker: serves the app's files, and runs the same api/ handlers as Vercel did.
   Each /api/<name> request is turned into the small req/res shape those handlers expect
   (method, lower-cased headers, parsed JSON body, query; res.status/setHeader/json), so api/
   stays the single copy of the server logic. Secrets come in as Worker env and are copied onto
   process.env, which is where api/_lib.js reads them. */
import sync from "../api/sync.js";
import inbound from "../api/inbound.js";
import classify from "../api/classify.js";
import related from "../api/related.js";

const ROUTES = { sync, inbound, classify, related };

function toProcessEnv(env) {
  for (const [k, v] of Object.entries(env)) if (typeof v === "string") process.env[k] = v;
}

async function runApi(request, env, handler) {
  toProcessEnv(env);
  const url = new URL(request.url);
  const headers = {};
  request.headers.forEach((v, k) => { headers[k] = v; });
  // the rate limit keys on the caller's IP: Cloudflare puts it in cf-connecting-ip
  headers["x-real-ip"] = request.headers.get("cf-connecting-ip") || headers["x-real-ip"] || "";
  let body = {};
  if (request.method === "POST") {
    const text = await request.text();
    if (text) {
      try { body = JSON.parse(text); }
      catch (e) { return Response.json({ error: "bad json" }, { status: 400, headers: { "cache-control": "no-store" } }); }
    }
  }
  const req = { method: request.method, headers, body, query: Object.fromEntries(url.searchParams) };
  let status = 200, out = null;
  const resHeaders = new Headers({ "content-type": "application/json" });
  const res = {
    status(c) { status = c; return res; },
    setHeader(k, v) { resHeaders.set(k, v); return res; },
    json(j) { out = JSON.stringify(j); return res; },
  };
  await handler(req, res);
  return new Response(out ?? "{}", { status, headers: resHeaders });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/")) {
      const handler = ROUTES[pathname.slice(5).replace(/\/$/, "")];
      if (!handler) return Response.json({ error: "not found" }, { status: 404 });
      return runApi(request, env, handler);
    }
    // the Cloudflare copy's home-screen icon is ember, so it's easy to tell apart from the old green Vercel one
    if (pathname === "/apple-touch-icon.png") return env.ASSETS.fetch(new URL("/apple-touch-icon-new.png", request.url));
    return env.ASSETS.fetch(request);
  },
};
