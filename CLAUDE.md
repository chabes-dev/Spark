# CLAUDE.md

## What this is
Spark is a **single-file app**: everything (HTML, CSS, JS) lives in `index.html` at the repo root.
There is **no framework, no build step, no package.json**. Vercel serves `index.html` as a static file.

## Working rules
- **Always discuss proposed changes with the owner before editing code.** Explain what you'd change and why, and wait for a go-ahead.
- Keep it single-file. Don't add a build step, bundler, or dependencies unless the owner explicitly asks.

## Deploying
- Deploy = commit + push to `main`. The GitHub repo is connected to the Vercel project, and every push to `main` goes to production.
- Other branches get preview deployments only. (Cloud Claude Code sessions push to a feature branch, and the change ships when that branch is merged into `main`.)
- **Never create a new Vercel project** and never run `vercel` in a way that could create one. The project is `spark-v2`
  (ID `prj_htrvy05SfhaRoWfwMB7Lgib7hBwm`, team `chabes-devs-projects` / `team_9EpNt6jfuHaKQ6rhLde8MC8w`).
- Production URL: https://spark-v2-chabes-devs-projects.vercel.app

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
- The Desk streak counts days with at least one dump (morning pages), in local time.
- The app always opens on the Desk (boot sets `ui.view='desk'`). `settings.typingVol` (0–1, default 0.5) scales typing sounds.
  `settings.wsize` (0–5, default 2) picks the writing font size from `WSIZES`.
- Writing screens use typewriter scrolling (`.cbody.tw` + `recenter()`): the caret line is kept at the vertical middle.
- `prompts` (top level, `{id,text,created}`) are the owner's own thought starters, mixed with `BUILTIN_PROMPTS`; shown
  only when the owner clicks ✦ Prompt. A dump written with one shown stores it as `dump.prompt`.
- Flow: morning pages → Ready → "pages done" screen (Back to Desk / Continue to a creative session). Never jump straight
  into the duration picker after Ready.
- `active.paused` (ms left) marks a session paused by swipe-back; Desk/Sparks show a Resume/Finish bar.
  Starting a new session while one is paused asks first (`askPausedThen`, canvas phase `pausedq`).
- Sparks may carry an optional `title` (set in the spark editor), shown as a heading on the spark card.
- Swipe/browser back is handled in-app (`appBack`, `goView`, one trap history entry). All exits go through `leaveCanvas()`
  so written text is always saved.

## History
- The old, Git-less project `spark` (`prj_AOg9SkC0ySUGtLadqnBrXS5LdCsc`, spark-chabes-devs-projects.vercel.app) was
  replaced by `spark-v2` on 2026-09-28. Data was moved over by hand from the old domain's localStorage. Don't deploy to the old project.
