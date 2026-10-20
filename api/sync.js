// POST /api/sync {code, since, push:[{coll,item}]} -> {items:[{coll,item}], next, more, ai}
// The phone/laptop pushes what changed locally and pulls what changed elsewhere (other device, emails).
import { guard, send, fail, putItems, changedSince, validPush, aiReady, pipeline } from "./_lib.js";

const MAX_PUSH = 500;

export default async function handler(req, res) {
  if (!(await guard(req, res))) return;
  try {
    const { since = 0, push = [] } = req.body;
    // never truncate silently: the client pushes in chunks; anything bigger is refused so nothing is lost unnoticed
    if (Array.isArray(push) && push.length > MAX_PUSH) return send(res, 413, { error: `push at most ${MAX_PUSH} items per request` });
    const all = Array.isArray(push) ? push : [];
    const clean = all.filter(validPush);
    const invalid = all.filter((x) => !validPush(x)).map((x) => `${x && x.coll}:${x && x.item && x.item.id}`).slice(0, 50);
    await putItems(clean);
    // sparks imported from old emails carry their Message-IDs: remember them so future replies thread onto them
    const map = [];
    clean.forEach((x) => { if (x.coll === "sparks" && !x.item.deleted) (x.item.emailIds || []).slice(0, 20).forEach((m) => map.push(["HSETNX", "msg", String(m), x.item.id])); });
    const tags = [...new Set(clean.flatMap((x) => (x.coll === "sparks" && x.item.tags) || []))].slice(0, 200);
    if (tags.length) map.push(["SADD", "tags", ...tags.map(String)]);
    await pipeline(map);
    const out = await changedSince(Number(since) || 0);
    send(res, 200, { ...out, invalid, now: Date.now(), ai: aiReady(), email: process.env.SPARK_EMAIL || null });
  } catch (e) {
    fail(res, e);
  }
}
