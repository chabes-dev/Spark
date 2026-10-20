// POST /api/related {code, brief, sparks:[{id,kind,title,text,tags}]} -> {picks:[{id,why}]}
import { guard, send, fail, BudgetError, related, aiReady } from "./_lib.js";

// Claude calls (brief mode over a big library especially) can take longer than the default timeout
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (!(await guard(req, res))) return;
  if (!aiReady()) return send(res, 503, { error: "AI key not set" });
  try {
    const { brief = "", sparks = [] } = req.body;
    if (!String(brief).trim()) return send(res, 400, { error: "empty brief" });
    const picks = await related(brief, sparks.slice(0, 800));
    send(res, 200, { picks });
  } catch (e) {
    if (e instanceof BudgetError) return send(res, 429, { error: "daily AI limit reached" });
    fail(res, e);
  }
}
