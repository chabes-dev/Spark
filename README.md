# Spark

A personal capture-and-reflect app — jot down what's pulling at you, organise sparks into collections, and write about them. Single-file HTML/CSS/JS, no framework, no build step.

Live: https://spark-v2-chabes-devs-projects.vercel.app

## How deploys work

The GitHub repo is connected to the Vercel project `spark-v2` (team `chabes-devs-projects`).
Every push to `main` deploys to production automatically. Pushes to other branches get preview URLs.

## ⚠️ Your data lives in your browser

All data is stored in `localStorage` under the key `spark_v1`, per browser and per domain.
- Never move the app to a new Vercel project or domain. Your data won't come with it.
- Never rename the key or change the data shape without a migration.
- Clearing site data in your browser wipes your data. There is no server backup.
