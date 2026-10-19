// POST /api/sync {code, since, push:[{coll,item}]} -> {items:[{coll,item}], next, more, ai}
// The phone/laptop pushes what changed locally and pulls what changed elsewhere (other device, emails).
import { guard, send, putItems, changedSince, COLLS, aiReady, pipeline } from "./_lib.js";

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  try {
    const { since = 0, push = [] } = req.body;
    const clean = (Array.isArray(push) ? push : [])
      .filter((x) => x && COLLS.includes(x.coll) && x.item && typeof x.item.id === "string")
      .slice(0, 1000);
    await putItems(clean);
    // sparks imported from old emails carry their Message-IDs: remember them so future replies thread onto them
    const map = [];
    clean.forEach((x) => { if (x.coll === "sparks" && !x.item.deleted) (x.item.emailIds || []).slice(0, 20).forEach((m) => map.push(["HSETNX", "msg", String(m), x.item.id])); });
    const tags = [...new Set(clean.flatMap((x) => (x.coll === "sparks" && x.item.tags) || []))].slice(0, 200);
    if (tags.length) map.push(["SADD", "tags", ...tags.map(String)]);
    await pipeline(map);
    const out = await changedSince(Number(since) || 0);
    send(res, 200, { ...out, ai: aiReady(), email: process.env.SPARK_EMAIL || null });
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
}
