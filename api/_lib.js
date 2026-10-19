// Shared helpers for Spark's small server: storage (Upstash Redis over REST), auth, item store, AI.
import Anthropic from "@anthropic-ai/sdk";

/* ---------- storage: Upstash Redis REST (env set by the Vercel Marketplace integration) ---------- */
const R_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const R_TOK = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
export const storageReady = () => !!(R_URL && R_TOK);

export async function redis(...cmd) {
  const r = await fetch(R_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${R_TOK}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error("redis: " + j.error);
  return j.result;
}
export async function pipeline(cmds) {
  if (!cmds.length) return [];
  const r = await fetch(R_URL + "/pipeline", {
    method: "POST",
    headers: { Authorization: `Bearer ${R_TOK}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmds),
  });
  const j = await r.json();
  return j.map((x) => { if (x.error) throw new Error("redis: " + x.error); return x.result; });
}

/* ---------- item store ----------
   hash  items  "<coll>:<id>" -> JSON item (every item carries `updated`, client clock ms; deletions are {id,deleted:true})
   zset  upd    "<coll>:<id>" scored by server time of the last write, so pulls work whatever the device clocks say
   hash  msg    "<email Message-ID>" -> spark id (threads replies onto the right spark) */
export const COLLS = ["sparks", "sessions", "dumps", "projects", "prompts", "motivators"];
const key = (coll, id) => `${coll}:${id}`;

export async function getItem(coll, id) {
  const v = await redis("HGET", "items", key(coll, id));
  return v ? JSON.parse(v) : null;
}
// last write wins on `updated`; returns true when written
export async function putItems(list, { force = false } = {}) {
  if (!list.length) return 0;
  const keys = list.map((x) => key(x.coll, x.item.id));
  const cur = await redis("HMGET", "items", ...keys);
  const now = Date.now();
  const cmds = [];
  let n = 0;
  list.forEach((x, i) => {
    const old = cur[i] ? JSON.parse(cur[i]) : null;
    if (!force && old && (old.updated || 0) > (x.item.updated || 0)) return;
    cmds.push(["HSET", "items", keys[i], JSON.stringify(x.item)]);
    cmds.push(["ZADD", "upd", String(now + n / 1000), keys[i]]); // unique score per write keeps paging exact
    n++;
  });
  await pipeline(cmds);
  return n;
}
// everything written after `since` (server ms), oldest first, in pages
export async function changedSince(since, limit = 400) {
  const rows = await redis("ZRANGEBYSCORE", "upd", `(${since}`, "+inf", "WITHSCORES", "LIMIT", "0", String(limit));
  const keys = [], scores = [];
  for (let i = 0; i < rows.length; i += 2) { keys.push(rows[i]); scores.push(+rows[i + 1]); }
  if (!keys.length) return { items: [], next: since, more: false };
  const vals = await redis("HMGET", "items", ...keys);
  const items = [];
  keys.forEach((k, i) => {
    if (!vals[i]) return;
    const c = k.indexOf(":");
    items.push({ coll: k.slice(0, c), item: JSON.parse(vals[i]) });
  });
  return { items, next: scores[scores.length - 1], more: keys.length === limit };
}

/* ---------- auth ---------- */
export function okCode(code) {
  const want = process.env.SPARK_SYNC_CODE;
  return !!want && typeof code === "string" && code.trim() === want;
}
export function send(res, status, body) {
  res.status(status).setHeader("Cache-Control", "no-store");
  res.json(body);
}
export function guard(req, res) {
  if (req.method !== "POST") { send(res, 405, { error: "POST only" }); return false; }
  if (!storageReady()) { send(res, 503, { error: "storage not connected" }); return false; }
  const body = req.body || {};
  if (!okCode(body.code)) { send(res, 401, { error: "wrong sync code" }); return false; }
  return true;
}

/* ---------- ids, text ---------- */
export const nid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const linksIn = (t) => [...new Set((String(t || "").match(/https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?]/g) || []))];
export const KINDS = ["idea", "insight", "name", "brief", "convo", "link"];

/* ---------- AI (Claude) ---------- */
export const aiReady = () => !!process.env.ANTHROPIC_API_KEY;
let _client = null;
const client = () => (_client ||= new Anthropic());
const MODEL = "claude-opus-5-5";

// one call, JSON back (structured output); safety declines fall back server-side
export async function askJSON({ system, user, schema, effort = "low", maxTokens = 4000 }) {
  const r = await client().beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort, format: { type: "json_schema", schema } },
    system, // string, or blocks (the spark library is cached so repeated brief searches are cheap)
    messages: [{ role: "user", content: user }],
  });
  if (r.stop_reason === "refusal") throw new Error("declined");
  const text = r.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text);
}

const CLASSIFY_SYSTEM = `You sort the creative "sparks" of an advertising creative (a copywriter / creative director).
A spark is a note they sent themselves: a thought, a link, a list of possible names, a brief, or a pasted chat with friends that holds an insight.
For each spark return:
- kind: one of idea | insight | name | brief | convo | link
  idea = an execution or concept idea; insight = an observation/truth about people, culture or a brand;
  name = candidate names (agency, product, project) — usually a short list; brief = a client or project brief / problem to solve;
  convo = a pasted conversation (timestamps, several speakers or messages); link = mostly a link to something worth looking at.
- title: 2 to 7 words, in the spark's own language, that would let them recognise it in a list. Keep a good existing subject line.
- tags: 1 to 4 short lowercase tags (topic, brand, audience, medium). Reuse tags from the given vocabulary when they fit.
Write titles and tags in the same language as the spark (they write in English and Portuguese).`;

const CLASSIFY_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: KINDS },
          title: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["id", "kind", "title", "tags"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

export async function classify(items, vocab = []) {
  const user = `Tag vocabulary so far: ${vocab.slice(0, 80).join(", ") || "(none yet)"}

Sparks:
${items.map((x) => `<spark id="${x.id}">\n${x.title ? "Subject: " + x.title + "\n" : ""}${String(x.text || "").slice(0, 3000)}\n</spark>`).join("\n")}`;
  const out = await askJSON({ system: CLASSIFY_SYSTEM, user, schema: CLASSIFY_SCHEMA, effort: "low", maxTokens: 8000 });
  return (out.results || []).map((r) => ({
    id: r.id,
    kind: KINDS.includes(r.kind) ? r.kind : "idea",
    title: String(r.title || "").slice(0, 120),
    tags: (r.tags || []).map((t) => String(t).toLowerCase().replace(/^#/, "").trim()).filter(Boolean).slice(0, 4),
  }));
}

const RELATED_SYSTEM = `You are a creative partner for an advertising creative. They give you a new brief and their library of sparks
(notes, insights, names, links, pasted chats). Pick the sparks that could genuinely feed this brief — including surprising,
lateral connections (an insight about hikers' feet can fuel a shoe brief; a naming list can inspire a campaign line).
Return at most 12, best first. For each, one short line (max 22 words, in the brief's language) saying how it could be used.
Skip anything only superficially related. It is fine to return few or none.`;

const RELATED_SCHEMA = {
  type: "object",
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, why: { type: "string" } },
        required: ["id", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["picks"],
  additionalProperties: false,
};

export async function related(brief, sparks) {
  // stable order + stable text so the cached library prefix is reused between briefs
  const lib = [...sparks]
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((s) => `<spark id="${s.id}" kind="${s.kind || ""}" tags="${(s.tags || []).join(",")}">\n${s.title ? s.title + "\n" : ""}${String(s.text || "").slice(0, 1200)}\n</spark>`)
    .join("\n");
  const system = [
    { type: "text", text: RELATED_SYSTEM },
    { type: "text", text: `<library>\n${lib}\n</library>`, cache_control: { type: "ephemeral", ttl: "1h" } },
  ];
  const user = `<brief>\n${String(brief).slice(0, 6000)}\n</brief>`;
  const out = await askJSON({ system, user, schema: RELATED_SCHEMA, effort: "medium", maxTokens: 6000 });
  const ids = new Set(sparks.map((s) => s.id));
  return (out.picks || []).filter((p) => ids.has(p.id)).slice(0, 12);
}

/* ---------- email parsing ---------- */
// CloudMailin "JSON (normalized)" posts {headers:{...}, envelope:{...}, plain, html, reply_plain, attachments}
export function parseInbound(b) {
  const h = {};
  Object.entries(b.headers || {}).forEach(([k, v]) => { h[k.toLowerCase().replace(/-/g, "_")] = v; });
  const one = (v) => (Array.isArray(v) ? v[0] : v) || "";
  const ids = (v) => String(Array.isArray(v) ? v.join(" ") : v || "").match(/<[^<>\s]+>/g) || [];
  const plain = String(b.plain || b.text || "").replace(/\r\n/g, "\n");
  const html = String(b.html || "");
  const body = plain.trim() ? plain : htmlToText(html);
  return {
    messageId: ids(h.message_id)[0] || (b.messageId ? `<${String(b.messageId).replace(/[<>]/g, "")}>` : ""),
    inReplyTo: ids(h.in_reply_to),
    references: ids(h.references),
    subject: String(one(h.subject) || b.subject || "").trim(),
    date: Date.parse(one(h.date)) || Date.now(),
    body: body.trim(),
    reply: String(b.reply_plain || "").replace(/\r\n/g, "\n").trim() || stripQuoted(body),
  };
}
export function htmlToText(html) {
  return String(html)
    .replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n");
}
// keep only the new part of a reply: cut at the quoted history (Gmail, Apple Mail, Outlook, Portuguese clients)
export function stripQuoted(text) {
  const lines = String(text).split("\n");
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    const next = lines.slice(i + 1, i + 5).join("\n");
    if (/^(On|Em|El|Le) .{4,200}(wrote|escreveu|escribió|a écrit):?$/i.test(l) ||
        /^-{2,}\s*(Original Message|Mensagem original)/i.test(l) ||
        /^_{10,}$/.test(l) ||
        (/^(From|De):\s/i.test(l) && /^(Date|Sent|Enviada|Data|Enviado):/im.test(next))) { cut = i; break; }
  }
  return lines.slice(0, cut).filter((l) => !/^>/.test(l.trim())).join("\n").trim();
}
export const cleanSubject = (s) => String(s || "").replace(/^\s*((re|res|fw|fwd|enc|tr|aw|wg)\s*:\s*)+/i, "").trim();
