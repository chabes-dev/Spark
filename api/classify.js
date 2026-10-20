// POST /api/classify {code, items:[{id,title,text}], vocab:[tag]} -> {results:[{id,kind,title,tags}]}
import { guard, send, fail, BudgetError, classify, aiReady } from "./_lib.js";

// Claude calls (brief mode over a big library especially) can take longer than the default timeout
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (!(await guard(req, res))) return;
  if (!aiReady()) return send(res, 503, { error: "AI key not set" });
  try {
    const items = (req.body.items || []).filter((x) => x && x.id).slice(0, 25);
    const results = items.length ? await classify(items, req.body.vocab || []) : [];
    send(res, 200, { results });
  } catch (e) {
    if (e instanceof BudgetError) return send(res, 429, { error: "daily AI limit reached" });
    fail(res, e);
  }
}
