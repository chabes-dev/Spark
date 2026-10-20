// POST /api/related {code, brief, sparks:[{id,kind,title,text,tags}]} -> {picks:[{id,why}]}
import { guard, send, fail, related, aiReady } from "./_lib.js";

export default async function handler(req, res) {
  if (!(await guard(req, res))) return;
  if (!aiReady()) return send(res, 503, { error: "AI key not set" });
  try {
    const { brief = "", sparks = [] } = req.body;
    if (!String(brief).trim()) return send(res, 400, { error: "empty brief" });
    const picks = await related(brief, sparks.slice(0, 800));
    send(res, 200, { picks });
  } catch (e) {
    fail(res, e);
  }
}
