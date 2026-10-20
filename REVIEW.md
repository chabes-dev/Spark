# Backend review: sync, email-in, AI (2026-10-20)

Scope: `api/*.js` (Vercel functions) and the client code in `index.html` that calls them (sync engine,
classify queue, brief mode, import, the Sync sheet). Reviewed from the repo (`chabes-dev/Spark`, `main` @ 6e268a2).
Fixes are on branch `night/backend-hardening`, one commit per fix, each with a headless test
(`node .test/api.test.mjs` for the server, `node .test/client.test.cjs` for the browser side, see `.test/README.md`).
Nothing was merged, pushed to `main`, deployed, or changed in Vercel.

**Bottom line:** no secret reaches the browser or the repo, and nobody can read your sparks by guessing IDs.
The serious problems are in **sync reliability**: as shipped, sync can silently stop uploading your edits,
and one bad moment on one device can delete your library everywhere. The email address has **no sender check**,
so anyone who learns it can fill your library and spend your AI budget.

## Your actions before merging (things I was told not to do)

1. **Rotate both secrets.** The sync code and the inbound key were pasted into a chat transcript. Set new values in
   Vercel (`SPARK_SYNC_CODE`: use 5+ random words; `INBOUND_KEY`: 40 hex chars) and update the CloudMailin URL.
2. **Add `ALLOWED_SENDERS`** in Vercel: comma-separated addresses allowed to create sparks by email, e.g.
   `marcelo.chabes@mediaartslab.com,marcelogimeneschabes@gmail.com`. After this branch, email-in is **closed by
   default** until this is set (see C4).
3. Optional: `AI_DAILY_LIMIT` (default 300 Claude calls a day).
4. In CloudMailin, prefer Basic Auth over the `?key=` URL: target `https://spark:<INBOUND_KEY>@…/api/inbound`
   (both still work, see M5).

## Severity ranking

| # | Severity | Finding | Fixed in |
|---|---|---|---|
| C1 | Critical | Edits made offline or during a failed sync are never uploaded | client |
| C2 | Critical | A wiped or corrupted device deletes the whole library on every device | client |
| C3 | High | First sync of a big library uploads only the first 1,000 items, silently | client + server |
| C4 | High | Anyone who knows the Spark address can inject sparks and trigger paid AI calls | server |
| C5 | High | Sync code can be brute-forced: no rate limit, ~27-bit code, leaked in chat | server |
| H1 | High | A future `updated` timestamp freezes an item forever; bad clocks win conflicts | server |
| M1 | Medium | Concurrent writes lose data (two replies, or a reply plus an edit) | server + client |
| M2 | Medium | Typing during an in-flight sync is overwritten by the server's echo | client |
| M3 | Medium | Pushes the server rejects as stale are silently dropped; devices diverge | server + client |
| M4 | Medium | AI classify retries every 1.5 s forever on failure: unbounded spend | client |
| M5 | Medium | No daily AI budget on the server | server |
| M6 | Medium | Duplicate sparks when the mail service retries after a partial failure | server |
| M7 | Low-Med | Inbound key travels in the URL (logged) and is compared non-constant-time | server |
| L1 | Low | Prompt injection via emailed text into the Claude prompts | server |
| L2 | Low | Synced `links` are rendered as `href` without a scheme check (`javascript:`) | client |
| L3 | Low | No size caps (bodies, threads, References header); future dates from email headers | server |
| L4 | Low | Corrupt stored JSON breaks every sync; Redis calls have no timeout; raw errors returned | server |
| L5 | Low | Claude calls can exceed the default function timeout (brief mode) | server |

---

### C1. Edits made offline or during a failed sync are never uploaded (Critical, reliability)
**Where:** `index.html` `syncNow()`: it writes each changed item's fingerprint into `SYNC.sigs` and deletes
tombstoned keys **before** the request. On failure (offline, 500, timeout), `saveSync()` still persists those sigs.
**Effect:** the next sync sees the items as clean and never pushes them. Write morning pages on a plane and they stay
on that phone forever, with sync looking fine. Same for deletions. No attacker needed.
**Fix:** compute new fingerprints in a pending map and commit them only after the server accepted the push.

### C2. One wiped device deletes the library everywhere (Critical, data loss)
**Where:** `syncNow()`: every key in `SYNC.sigs` that is missing locally becomes a `{deleted:true}` tombstone.
**Effect:** if `spark_v1` is lost or unreadable while `spark_sync` survives (a corrupt save, a bug, a partial
storage clear), every item becomes a tombstone. It is pushed, wins on the server, and is pulled as a delete by the
other devices.
**Fix:** a mass-delete guard. If one sync would delete more than 10 items and more than 20% of what this device
knew, hold the deletes back, re-download everything instead, and show a warning in the Sync sheet.

### C3. A big library only partly uploads (High, reliability)
**Where:** `api/sync.js` `.slice(0, 1000)`; the client pushes everything in one request and marks it all synced.
**Effect:** connecting a device with more than 1,000 items (sessions + pages + sparks add up) uploads the first 1,000
and drops the rest without saying so. Any body over Vercel's 4.5 MB limit fails outright.
**Fix:** the client pushes in chunks of 200. The server rejects batches over 500 with 413 instead of truncating.

### C4. The email address is an open door (High, abuse and cost)
**Where:** `api/inbound.js` checks only the URL key, which proves the request came through CloudMailin. It does not
check who sent the email.
**Effect:** a mail address gets shared, autocompleted, harvested or forwarded. Anyone who emails it creates sparks
in your library, can thread junk onto existing sparks by quoting their Message-IDs, and costs one Claude call per
email. A spam run means hundreds of fake sparks and a real API bill.
**Fix:** `ALLOWED_SENDERS` allowlist, checked against the envelope sender and the `From:` header. Emails that
CloudMailin marks SPF `fail` or `softfail` are rejected too. Rejected mail gets a 200 with `skipped` so it isn't
retried. It **fails closed** when the variable is unset. Honest limit: `From:` can be forged for domains without
strict DMARC, so the allowlist is a strong filter, not a guarantee. The daily AI cap (M5) bounds the cost either way.

### C5. The sync code can be brute-forced (High, confidentiality and integrity)
**Where:** `okCode()` / `guard()` in `api/_lib.js`; there is no limit on wrong guesses.
**Effect:** the code is the only lock. Whoever has it can read every spark, page and entry, overwrite or delete them,
and spend AI. Three words from a 26-word list plus four digits is about 27 bits, which is reachable by a patient
script with unlimited tries. The current code was also shown in a chat transcript.
**Fix:** at most 8 wrong codes per IP per 15 minutes and 200 a day across everyone (then 429), checked in Redis.
The code is compared in constant time, and 500 responses no longer echo internal errors. **Rotate the code** (see
actions). Note that guessing item IDs gets you nothing: every endpoint requires the code first.

### H1. Future timestamps freeze items (High, integrity)
**Where:** `putItems()` trusts the client's `updated`.
**Effect:** one push with `updated: 9e15`, from a device with a wrong clock or from anyone with the code, makes that
item permanently un-editable, because every later edit is "older". Any device whose clock runs ahead always wins.
**Fix:** the server clamps `updated` to at most 2 minutes ahead of server time. It also validates items: ids are
1–64 safe characters, each item is at most 256 KB, and `updated` must be a finite number.

### M1. Concurrent writes lose data (Medium)
**Where:** `putItems()` reads, then writes, with no atomicity; `inbound.js` builds a reply from a stale read and
writes with `force: true`.
**Effect:** two replies arriving together keep only one follow-up. A reply arriving while you edit the spark's
tags is lost, because the newer edit replaces the whole spark.
**Fix:** writes are serialised with a short Redis lock. Spark threads are merged (union by follow-up id), and
deliberate deletions are remembered in `threadDel`. Inbound updates the spark inside the same lock.

### M2. The echo overwrites fresh typing (Medium)
**Where:** `applyRemote()` replaces the local item with the server's copy of what was just pushed, even if you changed
it while the request was in flight.
**Fix:** a local item with unsynced changes is never replaced by a version that isn't newer. It is pushed on the next
sync instead.

### M3. Rejected pushes are silent (Medium)
**Where:** `putItems()` skips stale items without telling the client, and the client marks them synced.
**Effect:** after a clock skew or an offline edit race, two devices keep different versions forever.
**Fix:** the server returns `conflicts` (its current version of each rejected item) and the client adopts them.

### M4. The classify loop can burn money (Medium, cost)
**Where:** `classifyPending()` reschedules itself every 1.5 s whenever any spark is unclassified, including after
errors.
**Effect:** if `/api/classify` keeps failing after Claude has answered (a parse error, a timeout after generation),
every open tab pays for a Claude call every 1.5 s, all day.
**Fix:** exponential backoff (up to 30 min), and a spark is given up after 3 failed attempts.

### M5. No AI budget (Medium, cost)
**Fix:** a daily counter in Redis (`AI_DAILY_LIMIT`, default 300 calls) shared by classify, related and inbound. Over
the limit, AI features answer 429 and the app falls back to keyword matching.

### M6. Duplicate sparks on retries (Medium)
**Where:** inbound checks `msg[Message-ID]`, then writes the spark, then records the id. A failure between the write
and the record makes the retry create a second spark. Emails without a Message-ID are never deduplicated.
**Fix:** the Message-ID (or a hash of sender, date, subject and body) is claimed first with `HSETNX`, and the claim is
released if processing fails.

### M7. Inbound key in the URL (Low-Medium)
**Effect:** query strings end up in CloudMailin's dashboard, in logs and in screenshots. The comparison isn't
constant-time.
**Fix:** HTTP Basic Auth is accepted (password = `INBOUND_KEY`), compared in constant time. The `?key=` form still
works so nothing breaks before you switch the URL.

### L1. Prompt injection (Low)
**Where:** emailed text goes into the classify and related prompts.
**Effect (bounded):** outputs are structured (fixed kinds, filtered to real spark ids, escaped when shown), so the worst
case is a mislabelled spark or a junk "why" line in brief mode. Text containing `</spark>` could also break out of its
wrapper.
**Fix:** the system prompts state that spark content is data, never instructions, and `<` inside spark text is
neutralised so it cannot close the wrapper. C4 removes most untrusted input anyway.

### L2. `javascript:` links (Low)
**Where:** cards and the spark sheet render `s.links` from synced data as `href`.
**Effect:** anything that writes a spark (anyone with the code, or a future bug) could plant a `javascript:` link
that runs when tapped.
**Fix:** only `http(s)` links are rendered.

### L3. Unbounded sizes and future dates (Low)
**Fix:** email bodies are capped at 50k characters, threads at 300 follow-ups, and References at the last 50 ids.
`created` from an email's `Date:` header is clamped to now.

### L4. Robustness (Low)
**Fix:** one corrupt stored item is skipped instead of failing every sync. Redis calls time out after 8 s with a
clear error. 500 responses say "server error" (details go to the function log).

### L5. Timeouts (Low)
**Fix:** `maxDuration` is 60 s for the classify, related and inbound functions.

## Checked and fine
- **Secrets:** `ANTHROPIC_API_KEY` and the Redis token are only read server-side (`process.env`). None are sent to the
  browser or committed: the git history was searched, and only the fake test token in `.test/` appears.
- **Access by ID:** every data endpoint requires the sync code before touching storage, so guessing IDs gets nothing.
- **Cross-site requests:** JSON POSTs need a CORS preflight, which the functions don't grant, so other websites can't
  read the API's answers from your browser.
- **XSS:** all server text (titles, tags, follow-ups, AI "why" lines) is escaped before rendering; only `href` was open
  (L2).
- **Offline:** the app keeps working; brief mode and sorting fall back to local rules.

## Still open (not fixed here)
- **One shared code**, no per-device revocation. Fine for one person. If a phone is lost, rotate the code.
- **Clocks:** "newest edit wins" still uses device clocks, now clamped (H1). Per-field merging would be the next step
  if conflicts ever bite.
- **Spoofable `From:`:** see C4. A DKIM-verified check would need the raw message (CloudMailin's raw format).
