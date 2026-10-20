# Headless tests

Server (Node only, a fake in-memory Redis, no network):

    node .test/api.test.mjs

Browser side (needs Playwright + Chromium; starts the app and the API on :8800 with the fake Redis itself):

    NODE_PATH=$(npm root -g) node .test/client.test.cjs

`node .test/server.mjs` serves the app + API on http://localhost:8800 for poking around by hand
(sync code `secret-code`, inbound key `ik`, allowed sender `me@example.com`).
