// POST /api/inbound?key=INBOUND_KEY  (CloudMailin, "JSON (normalized)" format)
// An email to the Spark address becomes a spark; a reply on the same thread becomes a follow-up on that spark.
import crypto from "crypto";
import { send, fail, senderCheck, storageReady, redis, getItem, putItems, parseInbound, cleanSubject, linksIn, nid, aiReady, classify } from "./_lib.js";

// "pending:<time>" marks an email being processed; a claim older than 2 minutes (a crashed attempt) can be taken over
async function claim(id) {
  if (await redis("HSETNX", "msg", id, "pending:" + Date.now())) return true;
  const v = await redis("HGET", "msg", id);
  if (v && v.startsWith("pending:") && Date.now() - +v.slice(8) > 120000) { await redis("HSET", "msg", id, "pending:" + Date.now()); return true; }
  return false;
}

export default async function handler(req, res) {
  let dedupe = null;
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  if (!process.env.INBOUND_KEY || req.query.key !== process.env.INBOUND_KEY) return send(res, 403, { error: "bad key" });
  if (!storageReady()) return send(res, 503, { error: "storage not connected" }); // the mail service retries later
  try {
    // 200 (not 4xx) for refused mail, so the mail service doesn't keep retrying it
    const refused = senderCheck(req.body || {});
    if (refused) { console.warn("inbound refused:", refused); return send(res, 200, { ok: true, skipped: refused }); }
    const m = parseInbound(req.body || {});
    if (!m.body && !m.subject) return send(res, 200, { ok: true, skipped: "empty" });
    // claim the email first (atomically), so simultaneous or repeated deliveries make one spark;
    // emails without a Message-ID are recognised by a hash of what they say
    dedupe = m.messageId || "h:" + crypto.createHash("sha256").update([m.from, m.date, m.subject, m.body].join("\n")).digest("hex").slice(0, 32);
    if (!(await claim(dedupe))) return send(res, 200, { ok: true, skipped: "duplicate" });

    // find the spark this is a reply to: In-Reply-To first, then References from newest to oldest
    const cands = [...m.inReplyTo, ...[...m.references].reverse()].filter((x) => x !== m.messageId);
    let parent = null;
    if (cands.length) {
      const hits = await redis("HMGET", "msg", ...cands);
      const sid = hits.find((h) => h && !h.startsWith("pending:"));
      if (sid) { const sp = await getItem("sparks", sid); if (sp && !sp.deleted) parent = sp; }
    }

    let spark, threaded = false;
    if (parent) {
      // only the new follow-up is sent; putItems merges it into the stored spark under the lock,
      // so concurrent replies and edits made meanwhile are all kept
      const text = m.reply || m.body;
      spark = { id: parent.id, thread: [{ id: nid(), text, created: m.date, source: "email" }],
        links: linksIn(text), emailIds: m.messageId ? [m.messageId] : [], updated: Date.now() };
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
    await putItems([{ coll: "sparks", item: spark }], threaded ? { append: true } : { force: true });
    await redis("HSET", "msg", dedupe, spark.id);
    send(res, 200, { ok: true, sparkId: spark.id, threaded });
  } catch (e) {
    if (dedupe) await redis("HDEL", "msg", dedupe).catch(() => {}); // let the mail service's retry try again
    fail(res, e);
  }
}
