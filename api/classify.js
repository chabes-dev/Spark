// POST /api/classify {code, items:[{id,title,text}], vocab:[tag]} -> {results:[{id,kind,title,tags}]}
import { guard, send, classify, aiReady } from "./_lib.js";

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  if (!aiReady()) return send(res, 503, { error: "AI key not set" });
  try {
    const items = (req.body.items || []).filter((x) => x && x.id).slice(0, 25);
    const results = items.length ? await classify(items, req.body.vocab || []) : [];
    send(res, 200, { results });
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
}
