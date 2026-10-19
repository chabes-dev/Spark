// POST /api/inbound?key=INBOUND_KEY  (CloudMailin, "JSON (normalized)" format)
// An email to the Spark address becomes a spark; a reply on the same thread becomes a follow-up on that spark.
import { send, storageReady, redis, getItem, putItems, parseInbound, cleanSubject, linksIn, nid, aiReady, classify } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  if (!process.env.INBOUND_KEY || req.query.key !== process.env.INBOUND_KEY) return send(res, 403, { error: "bad key" });
  if (!storageReady()) return send(res, 503, { error: "storage not connected" }); // the mail service retries later
  try {
    const m = parseInbound(req.body || {});
    if (!m.body && !m.subject) return send(res, 200, { ok: true, skipped: "empty" });
    if (m.messageId && (await redis("HGET", "msg", m.messageId))) return send(res, 200, { ok: true, skipped: "duplicate" });

    // find the spark this is a reply to: In-Reply-To first, then References from newest to oldest
    const cands = [...m.inReplyTo, ...[...m.references].reverse()].filter((x) => x !== m.messageId);
    let parent = null;
    if (cands.length) {
      const hits = await redis("HMGET", "msg", ...cands);
      const sid = hits.find(Boolean);
      if (sid) { const sp = await getItem("sparks", sid); if (sp && !sp.deleted) parent = sp; }
    }

    let spark, threaded = false;
    if (parent) {
      const text = m.reply || m.body;
      spark = { ...parent };
      spark.thread = [...(parent.thread || []), { id: nid(), text, created: m.date, source: "email" }];
      spark.links = [...new Set([...(parent.links || []), ...linksIn(text)])];
      spark.emailIds = [...new Set([...(parent.emailIds || []), m.messageId].filter(Boolean))];
      spark.updated = Date.now();
      threaded = true;
    } else {
      spark = {
        id: nid(), text: m.body || m.subject, title: cleanSubject(m.subject) || null, created: m.date,
        projectId: null, source: "email", links: linksIn(m.body), emailIds: m.messageId ? [m.messageId] : [],
        thread: [], tags: [], updated: Date.now(),
      };
      if (aiReady()) {
        try {
          const vocab = await redis("SMEMBERS", "tags");
          const [c] = await classify([{ id: spark.id, title: spark.title, text: spark.text }], vocab || []);
          if (c) { spark.kind = c.kind; spark.tags = c.tags; if (!spark.title) spark.title = c.title; spark.aiTitle = c.title; spark.classified = true; }
          if (c && c.tags.length) await redis("SADD", "tags", ...c.tags);
        } catch (e) { /* sorting can happen later from the app */ }
      }
    }
    await putItems([{ coll: "sparks", item: spark }], { force: true });
    if (m.messageId) await redis("HSET", "msg", m.messageId, spark.id);
    send(res, 200, { ok: true, sparkId: spark.id, threaded });
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
}
