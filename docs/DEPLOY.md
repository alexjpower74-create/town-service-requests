# Deploying Town Service Requests

Nothing has been deployed. Everything so far ran on one computer with `wrangler dev --local`. These are the steps for when Alexander
decides to put it online for a real town. Each step is his call; none of them has been run.

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

## Deploy commands (for later, not tonight)

```sh
cd worker
wrangler d1 create town-service-requests            # copy the id into wrangler.toml
wrangler r2 bucket create town-service-requests-photos
wrangler d1 migrations apply town-service-requests --remote
wrangler deploy
curl -s https://<worker-host>/api/town | head -c 200  # the town answers
curl -s -X POST https://<worker-host>/api/test/reset  # must answer 404 (no TEST_MODE)
```
