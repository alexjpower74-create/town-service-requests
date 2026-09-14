# Town Service Requests

Residents of a small Newfoundland town report a problem (pothole, streetlight out, missed snow clearing, water or sewer, missed
garbage, fallen tree, something else) with a pin on the map and an optional photo, and follow it on a status link. The town office
works the requests from a board: assign a crew, message the public, keep internal notes, join duplicates, and see what is overdue.

Built overnight 2026-09-14 as a local demo. **Nothing is deployed, nothing is sent (no email, no texts), and every town, person and
request in it is SAMPLE.**

## Open it

```sh
cd ~/"Projects/Town Service Requests" && npm run demo
```

Then open:

- Resident report page: <http://127.0.0.1:8501/>
- Town office: <http://127.0.0.1:8501/staff/> (PIN **3690**)
- Status links for a few SAMPLE reports are printed by the command and saved in `.logs/demo-links.txt`.

`npm run demo` wipes its local database, starts the Worker with `wrangler dev --local` on port 8501 and seeds 24 SAMPLE requests. It
needs `wrangler` (4.131+) on the PATH and nothing else installed. If port 8501 already answers, the demo is probably already running:
just open the links.

## What's real and what's SAMPLE

| Real | SAMPLE |
|---|---|
| The map (OpenFreeMap tiles, data from OpenStreetMap) and the street names under the pins: they are Botwood's streets, decoded from the same tiles the map draws (`data/town.json`, sources in `data/sources/`) | The town: "SAMPLE Town of Harbour Pond (demo)". Its boundary is a hand-drawn nine-point shape and its three wards are bands, not real municipal lines. The map hides the tiles' town-name labels so it isn't read as Botwood |
| The rules the app enforces: pins must be inside the boundary, "already reported nearby" within 50 m, SLA days per category, NL time (America/St_Johns) for every date, week and overdue | Every request, crew, name and photo. Names end "(SAMPLE)", phones use the fictional 709-555-01xx range, photos are drawings labelled "SAMPLE photo" |

## What it does

- **Resident (phone, no account):** emergency banner with the town's number; pick a category; drop a pin (tap, "Use my location", or
  search the town's streets); "Already reported nearby" offers **Me too** instead of a duplicate; optional photo (shrunk on the phone);
  description; optional name and phone "so we can call you back"; **Report sent** with the reference and a status link. Resending never
  makes a second report; a failed photo never loses the report.
- **Status link (public):** reference, category, street, status, public message, dates and public history. Never the reporter's name or
  phone, the description, internal notes, crew names, the photo or the exact pin.
- **Town office (PIN):** board by status with filters and overdue highlighting; detail with photo, contact, map, status, crew, public
  message, "copy this update" text, internal notes, history, and joining duplicates (the +1s carry over); map with clustered pins;
  weekly report (opened and closed by category, average days to close, oldest open) with CSV export (no names, phones, descriptions or
  notes); settings for phones, office hours, days to fix each category, crews and the PIN.

## Tests

| Suite | Command | Result at final QA (pinned QA worktree, port 8509) |
|---|---|---|
| Worker unit + API | `npm run test:worker` | unit 21 passed, API 50 passed, 0 failed, 0 skipped |
| Worker negative controls | `npm run test:negative` | 13 of 13 went red after an unbroken pass |
| App end to end, chromium + webkit at 390 and 1280, real Worker | `cd app && npx playwright test` | 164 passed, 0 failed, 0 skipped |
| App negative controls | `cd app && npm run negative` | 7 of 7 went red after an unbroken pass |
| Map label unit test | `cd app && node --test tests/unit/map-labels.test.mjs` | 4 passed |

Every important check has a negative control: a copy of the code is broken on purpose (the boundary check skipped, the nearby radius
widened, a phone number leaked into the status page or the CSV, UTC weeks instead of NL weeks, an overlay over a button, and more) and
the control only passes when its test goes red. The QA history and every defect the cross-reviews and controls found are in
`docs/build-report.md`.

## What deploying needs

Nothing has been deployed; each step is Alexander's call. Details and commands: `docs/DEPLOY.md`.

- **Worker** `town-service-requests` (serves the API and the pages), **D1** `town-service-requests`, **R2** `town-service-requests-photos`.
- **Migrations** applied with `--remote` (deploy does not migrate).
- **Secrets:** none. **Variables:** optional `MAP_STYLE_URL`; never `TEST_MODE`.
- **Cron:** none (overdue and reports are computed when read). **Domain:** the town's choice; HTTPS for location and camera.
- Before a real town: its own name, boundary, wards and streets; a changed PIN; its phone numbers; a privacy notice (ATIPPA).

## Where to pick this up

- `PLAN.md` is the build contract, `docs/API.md` the API contract (with numbered clarifications), `DECISIONS.md` every call made
  overnight and why, `AGENTS.md` the rules and ports.
- `worker/` Cloudflare Worker (plain JS, D1, R2), `app/public/` the pages (plain HTML/JS/CSS, vendored Leaflet + MapLibre), `app/tests/`
  Playwright, `tools/` + `data/` the SAMPLE town builder.
- Known gaps and v2 ideas are at the end of `docs/build-report.md`.
