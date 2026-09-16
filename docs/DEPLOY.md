# Deploying Town Service Requests

## Prototype deploy, 2026-09-15 (Alexander's go)

| Created | Value |
|---|---|
| Worker | `town-service-requests` → <https://town-service-requests.alexjpower74.workers.dev> (serves `/api/*` and the pages) |
| D1 | `town-service-requests`, id `a7c3423c-6851-4dae-9fc5-88f193e16a9d`, migrations 0001 + 0002 applied `--remote` |
| R2 | **not created**: `wrangler r2 bucket create` answered "Please enable R2 through the Cloudflare Dashboard [code 10042]". The top-level R2 block stays for local dev and tests; the `[env.prototype]` block leaves it out, and the Worker refuses photo uploads with 503 and keeps the report. Enable R2, create the bucket, add the r2_buckets block to `env.prototype`, redeploy. |
| Secrets / vars | none. `TEST_MODE` is not set: `/api/test/reset` and `/api/test/seed` answer 404 live. |
| SAMPLE data | 24 requests (+ history, me-toos) seeded on a local `wrangler dev` with TEST_MODE, dumped with sqlite3 and imported with `wrangler d1 execute town-service-requests --remote --file seed.sql`. No photos (no R2). |
| Prototype line | every page shows "Prototype: a sample town, not a live service." under the town bar. |

Redeploy: `cd worker && npx wrangler deploy --env prototype` (the `prototype` env in `wrangler.toml` has no R2 binding; plain `wrangler deploy` would fail on the missing bucket). Smoke: `curl -s https://town-service-requests.alexjpower74.workers.dev/api/town` answers the SAMPLE town; `curl -s -o /dev/null -w '%{http_code}' -X POST https://town-service-requests.alexjpower74.workers.dev/api/test/reset` answers 404.

## For a real town

These are the steps for when a real town wants it. Each is Alexander's call.

## What it needs

| Thing | Name | Notes |
|---|---|---|
| Cloudflare Worker | `town-service-requests` | One Worker per town. It serves the API and the pages (Workers static assets from `app/public`). |
| D1 database | `town-service-requests` | `wrangler d1 create town-service-requests`, then put the id it prints into `worker/wrangler.toml` (`database_id`, now all zeros). |
| R2 bucket | `town-service-requests-photos` | `wrangler r2 bucket create town-service-requests-photos`. Residents' photos; staff-only URLs. |
| Migrations | `worker/migrations/` | `cd worker && wrangler d1 migrations apply town-service-requests --remote` (deploy does not migrate). |
| Secrets | none | The staff PIN lives in D1 as a PBKDF2 hash. **Change it from the SAMPLE `3690` on the first sign-in** (Settings → Change PIN). |
| Variables | `MAP_STYLE_URL` (optional) | Defaults to OpenFreeMap positron. Set it only to move to other tiles. **Never set `TEST_MODE`**: it turns on fake clocks, fake IPs and the reset/seed routes. |
| Cron | none | Overdue flags and the weekly report are computed when read. |
| Domain | the town's choice | e.g. `report.<town>.ca` as a Worker custom domain. HTTPS is required for "Use my location" and the camera on phones. |

## Before a real town uses it

1. **Rename the town.** The SAMPLE name, boundary, wards and streets come from `data/town.json` (built by `tools/build-town.mjs` from
   OpenFreeMap tiles). A real town needs its own boundary, its own ward list (or none), and its streets rebuilt for its area; then
   `cd worker && node tools/build-town-data.mjs` and redeploy. The name must lose the word SAMPLE (the SAMPLE badge follows the name).
2. **Wipe the SAMPLE data.** The demo seed exists only in test mode; a fresh D1 with the migrations has the SAMPLE settings row and
   three SAMPLE crews, which the town renames or deactivates in Settings.
3. **Set the emergency and office numbers** in Settings. The SAMPLE ones are 709-555-01xx (fictional).
4. **Privacy notice.** Residents may give a name, phone number and photo. The town is the public body collecting it, so the town's
   ATIPPA privacy notice (purpose, retention, contact) should be linked on the report page before go-live.
5. **Map tiles.** OpenFreeMap's public instance is free for commercial use with no key and no limits, but has no SLA. A town that needs
   guarantees can self-host OpenFreeMap or point `MAP_STYLE_URL` at a paid provider.
6. **Emails and texts.** v1 sends nothing: staff copy the update text. Texting residents would need an SMS account (a v2 decision).

## Deploy commands

```sh
cd worker
wrangler d1 create town-service-requests            # copy the id into wrangler.toml
wrangler r2 bucket create town-service-requests-photos
wrangler d1 migrations apply town-service-requests --remote
wrangler deploy
curl -s https://<worker-host>/api/town | head -c 200  # the town answers
curl -s -X POST https://<worker-host>/api/test/reset  # must answer 404 (no TEST_MODE)
```
