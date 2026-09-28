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

## History
- The old, Git-less project `spark` (`prj_AOg9SkC0ySUGtLadqnBrXS5LdCsc`, spark-chabes-devs-projects.vercel.app) was
  replaced by `spark-v2` on 2026-09-28. Data was moved over by hand from the old domain's localStorage. Don't deploy to the old project.
