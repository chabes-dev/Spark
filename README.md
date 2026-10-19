# Spark

A personal capture-and-reflect app — jot down what's pulling at you, organise sparks into collections, and write about them. Single-file HTML/CSS/JS, no framework, no build step.

Live: https://spark-v2-chabes-devs-projects.vercel.app

## How deploys work

The GitHub repo is connected to the Vercel project `spark-v2` (team `chabes-devs-projects`).
Every push to `main` deploys to production automatically. Pushes to other branches get preview URLs.

## Server
`api/` holds a few Vercel functions (sync between devices, the Spark email address, AI sorting). Setup: Upstash Redis
from the Vercel Marketplace, a CloudMailin address posting "JSON (normalized)" to `/api/inbound?key=…`, and the env
vars listed in `CLAUDE.md`. Without them the app still works on its own.

## ⚠️ Your data lives in your browser

All data is stored in `localStorage` under the key `spark_v1`, per browser and per domain.
- Never move the app to a new Vercel project or domain. Your data won't come with it.
- Never rename the key or change the data shape without a migration.
- Clearing site data in your browser wipes your data, unless the device is connected to sync (then it comes back from the server).

## Sounds
The "Real" typing sound uses recorded typewriter samples from
[BigSoundBank](https://bigsoundbank.com), released under CC0 (free for any use, no attribution required), embedded
in `index.html` as base64 MP3: 18 keystrokes cut from a 42s typing take ("Typewriter 8": 4 space-bar thuds,
14 letter strikes, picked at random per key) plus a margin bell for Enter. The other typing sounds and all soundscapes are synthesized in the browser.
