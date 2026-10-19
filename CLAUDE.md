# CLAUDE.md

## What this is
Spark is a **single-file app**: everything the browser runs (HTML, CSS, JS) lives in `index.html` at the repo root, plus
`apple-touch-icon.png` (180×180, the iPhone home-screen icon). No framework, no bundler, no build step.

Since 2026-10 there is also a **small server** in `api/` (Vercel Node functions, owner-approved) for sync, the Spark
email address and AI sorting. `package.json` exists only for its one dependency (`@anthropic-ai/sdk`); Vercel installs it.
The app still works fully offline/without the server: local data is the master copy.

## Working rules
- **Always discuss proposed changes with the owner before editing code.** Explain what you'd change and why, and wait for a go-ahead.
- Keep the app single-file. Don't add a build step, bundler, or more dependencies unless the owner explicitly asks.

## Deploying
- Deploy = commit + push to `main`. The GitHub repo is connected to the Vercel project, and every push to `main` goes to production.
- Other branches get preview deployments only. (Cloud Claude Code sessions push to a feature branch, and the change ships when that branch is merged into `main`.)
- **Never create a new Vercel project** and never run `vercel` in a way that could create one. The project is `spark-v2`
  (ID `prj_htrvy05SfhaRoWfwMB7Lgib7hBwm`, team `chabes-devs-projects` / `team_9EpNt6jfuHaKQ6rhLde8MC8w`).
- Production URL: https://spark-v2-chabes-devs-projects.vercel.app
- Vercel Authentication is set to **previews only** (`ssoProtection.deploymentType: preview`). Production must stay
  public: the iPhone home-screen app and its icon fetch have no Vercel login. The owner's data is local, nothing leaks.

## Data: handle with care
- All user data is in the browser's `localStorage` under the key **`spark_v1`** (`const KEY` in `index.html`).
- It is tied to the domain. A new project or domain means the owner loses their data.
- **Never change the localStorage key or the shape of the stored data without a migration** that reads the old
  format and upgrades it in place. Loading must never throw on older data.
- Shape (top level): `sparks`, `sessions` (creative writing), `dumps` (= the owner's **morning pages**), `motivators`,
  `projects` (`{id,name,created}`), `active`, `dumpDraft`, `settings`, `ui`. Sparks, sessions and dumps can carry a `projectId`.
  Sessions with `untimed:true` are free entries written from a project page (no timer, no dump). `ui.view` is
  `sparks` | `desk` | `project` (+ `ui.projectId`).
- Existing migrations (keep them): string `collections` + `dump.collection` → `projects` + `projectId`;
  old keyboard typing presets → `classic` typewriter.
- The Desk streak counts days with at least one dump (morning pages), in local time. The heatmap shows as many weeks as fit
  the card (`heatWeeks`, max 26), so it never scrolls; it re-fits on resize/rotation.
- The app always opens on the Desk (boot sets `ui.view='desk'`). `settings.typingVol` (0–1, default 0.5) scales typing sounds.
  `settings.wsize` (0–5, default 2) picks the writing font size from `WSIZES`.
- Writing screens use typewriter scrolling (`.cbody.tw` + `recenter()`): the caret line is kept at the vertical middle.
- `prompts` (top level, `{id,text,created}`) are the owner's own thought starters, mixed with `BUILTIN_PROMPTS`; shown
  only when the owner clicks ✦ Prompt. A dump written with one shown stores it as `dump.prompt`.
- Flow: morning pages → Ready → "pages done" screen (Back to Desk / Continue to a creative session). Never jump straight
  into the duration picker after Ready.
- Entry points: one **Start writing** button (Sparks page and project pages; `startWriting`) — morning pages first,
  or straight to the time/spark picker if today's pages exist (`pagesDoneToday`). No separate "quick start": 10 min is a
  chip on the picker. **Write** on a spark card skips pages and only asks for the time (`writeSpark`, `PICK_SPARK`).
  Desk's "Write today's pages" is pages only.
- `active.paused` (ms left) marks a session paused by swipe-back; Desk/Sparks show a Resume/Finish bar.
  Starting a new session while one is paused asks first (`askPausedThen`, canvas phase `pausedq`).
- Lock switch (`#clock`, `toggleLock`) on morning pages, timed sessions and free entries: locked = append-only
  (no deletes, caret pinned to the end, autocorrect off; `wireAppendOnly`, flag is the textarea's `data-locked`).
  Remembered separately: `settings.lockPages` (default true) and `settings.lockWrite` (default false).
- New writing (wherever the lock switch shows) fades toward the top: `.cwrite.fading` mask, `updateFade` keeps the
  gradient pinned to the visible area. Reading old entries back stays crisp.
- After writing, the app asks for a title (canvas phase `title`, `askTitle`/`finishTitle`): Esc from pages, ending a
  session, leaving a new free entry. Pages-done screen has its own field (`#pdtitle`). Dumps store `title`; sessions use
  `sparkText` as their title. Empty writing is never asked. An empty title placeholder (`.sname.autofade`) fades out
  once writing starts (`.typing`); a typed title stays.
- Themes (canvas only, always light): `THEMES` + `THEME_LABEL` + `THEME_SWATCH`, picked from a popover. A theme can set
  `--ink*` and `--cfont` (Typewriter uses Courier Prime).
- Scenes (`hills`, `dawn`, `snow`) are art themes drawn in code: `sceneHtml`/`applyScene` put a `.scene` layer
  (z-index:-1) in the canvas, with a soft `.veil` behind the text column. Snow is a small canvas loop (`snowfall`).
  `settings.motion` (default on) plus the OS Reduce Motion setting (`motionOn()`) freeze Dawn and Snowfall.
  `clean` is pure white, no paper texture.
- Morning pages are listed in the "Morning pages" sheet (`openDumps`), reachable from the Sparks page footer and the
  Desk card ("See all pages").
- Sparks may carry an optional `title` (set in the spark editor), shown as a heading on the spark card.
- Phones: writing-screen settings hide behind ••• (`CBAR_OPEN`, `.cbar.open`), exit reads "Done" on touch (`TOUCH`),
  the canvas follows `visualViewport` so the centred line stays above the keyboard (`fitCanvas`), spark-card actions are
  always visible on `(hover:none)`, and locked pages block deletes via `beforeinput` and `selectionchange` too.
- Phones: horizontal swipe switches pages (Sparks ⇄ Desk; project → Desk). Ignored at the screen edges (browser
  back), on the heatmap, in fields, sheets and writing screens.
  Only `.pagebody` slides; the header stays put and the tab highlight (`#navind`, `placeNavInd`) follows the finger.
  The incoming page is drawn from `bodyHtml(view)`; `.pagebody` is `flow-root` so both line up exactly.
- Swipe/browser back is handled in-app (`appBack`, `goView`, one trap history entry). All exits go through `leaveCanvas()`
  so written text is always saved.

## Server (`api/`)
- Storage: Upstash Redis via the Vercel Marketplace (env `UPSTASH_REDIS_REST_URL`/`_TOKEN` or `KV_REST_API_URL`/`_TOKEN`),
  called over REST with `fetch` (`api/_lib.js`). Keys: hash `items` (`<coll>:<id>` → JSON), zset `upd` (server write time,
  used for pulls), hash `msg` (email Message-ID → spark id, for threading), set `tags`.
- Env: `SPARK_SYNC_CODE` (the code a device enters to sync), `INBOUND_KEY` (secret in the email webhook URL),
  `SPARK_EMAIL` (address shown in the app), `ANTHROPIC_API_KEY` (AI sorting + brief search; optional).
- `POST /api/sync` push changed items / pull changes since a server timestamp; newest `updated` wins; deletions are
  `{id,deleted:true}` tombstones. Synced collections: sparks, sessions, dumps, projects, prompts, motivators
  (not settings/ui/active/dumpDraft).
- `POST /api/inbound?key=INBOUND_KEY` CloudMailin "JSON (normalized)" webhook: new email → spark (title from subject,
  AI kind/tags); a reply (In-Reply-To/References) → follow-up in `spark.thread`, quoted history stripped.
- `POST /api/classify`, `POST /api/related` (brief mode) call Claude (`claude-opus-5-5`, structured JSON output,
  server-side refusal fallback). The spark library is a cached system block.
- Local tests: `node .test/api.test.mjs`; `node .test/server.mjs` serves the app + api on :8800 with a fake Redis.

## Sparks (creative library)
- A capture is **one** spark (multi-line text stays together). Optional fields, all migration-free: `title`, `aiTitle`,
  `kind` (`idea|insight|name|brief|convo|link`; `kindByUser` when set by hand; otherwise `guessKind` heuristics),
  `tags[]`, `links[]`, `thread[]` (`{id,text,created,source}` follow-ups), `source` (`app|email|import`),
  `emailIds[]`, `classified`, `updated`.
- Sparks page: search across sparks/pages/writing (accent-insensitive), shelves by kind (Names = name wall), tag chips,
  "Find for a brief" (AI via `/api/related`, keyword fallback offline), Import emails (.mbox/.eml/.json, parsed in the
  browser, replies folded into threads, duplicates skipped by Message-ID), Sync & email sheet.
- Tapping a card opens the spark sheet (`openSpark`): kind, title, full text, links, follow-ups, tags, actions.
- Desk shows one older spark a day (`resurfaced`), which can seed today's morning pages prompt.
- Sync client: `spark_sync` localStorage key (separate from `spark_v1`) holds code, `since`, per-item fingerprints.
  `save()` schedules a debounced sync; also on focus and every minute. `saveLocal()` saves without syncing.

## History
- The old, Git-less project `spark` (`prj_AOg9SkC0ySUGtLadqnBrXS5LdCsc`, spark-chabes-devs-projects.vercel.app) was
  replaced by `spark-v2` on 2026-09-28. Data was moved over by hand from the old domain's localStorage. Don't deploy to the old project.
