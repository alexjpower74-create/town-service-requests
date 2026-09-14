# Town Service Requests: build contract

One plan file. It is the contract, and it lives at the repo root so every agent reads the same copy.
Then read `docs/API.md` (the contract between slices) and `DECISIONS.md`. `BRIEF.md` is the original brief. `AGENTS.md` has ports.

## The brief (Onyx for Alexander, 2026-09-14)
For a small Newfoundland town: residents report a problem (pothole, streetlight out, missed snow clearing, water or sewer, missed
garbage, fallen tree, something else) with a pin on the map and an optional photo. Town office staff work the requests from a board,
assign them to public works crews, and the resident follows a status link. Sellable to the ~270 NL municipalities, most of which take
these by phone today.

- **Resident (phone, no account):** emergency banner ("Water main break or danger right now? Call the town at … or 911.", the town sets
  the number) → pick a category → drop a pin (tap the map, "Use my location", or search a street; must be inside the town boundary) →
  **"Already reported nearby"**: open requests of the same category within 50 m with a **Me too** button that adds a +1 instead of a
  duplicate → photo (optional, compressed on the phone) → short description → name and phone optional ("so we can call you back") →
  **Report sent** with the reference number and the status link.
- **Town staff (PIN):** board New / Assigned / In progress / Done / Won't fix, filters (category, ward, age, overdue), map view with
  clustered pins, request detail (photo, +1 count, history), assign a crew, internal notes (never public), public status message,
  merge duplicates, SLA days per category with overdue highlighting, weekly report (opened/closed by category, average days to close,
  oldest open), CSV export, "copy this update" text.
- **Status link (public):** reference, category, street name (never the exact pin), status, public message, dates. Never the
  reporter's name or phone, the description, notes or the photo. Nothing is emailed or texted.
- **Data:** "SAMPLE Town of Harbour Pond (demo)": a simple SAMPLE boundary and three SAMPLE wards over a real place's map
  (`data/town.json`, streets from the OpenFreeMap tiles), SAMPLE requests, crews and people. Never name a real town as a customer.

## Design
Daylight civic: residents are outdoors on a phone, staff at a front-counter PC. Calm, plain, high contrast, nothing decorative.
- Tokens (`app/public/theme.css`): ground `#f5f7f9`, surface `#ffffff`, line `#d6dde3`, ink `#14212b`, muted `#56636f`, accent harbour
  blue `#0a5c8a` (white text on it), accent-soft `#e6f0f7`. Emergency banner: ground `#fdecea`, text `#8a1c12`, edge `#e3a59d`.
  Status chips (text on white, all ≥ 4.5 : 1): New `#0a5c8a`, Assigned `#5b21b6`, In progress `#92400e`, Done `#166534`, Won't fix
  `#44403c`, Joined `#57534e`. Overdue: `#b91c1c` left edge 4 px + "Overdue by N days" in that red. SAMPLE badge: text `#92400e` on
  `#fff7ed`, edge `#f59e0b`. Radius 12 px. Every text/background pair ≥ 4.5 : 1 (a test checks chips, banner and primary buttons).
- System font stack only (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`), 17 px base on
  the resident side. No web fonts. **No emoji as icons**: simple inline SVG line icons for the seven categories.
- **Resident (`/`, phone-first at 390, centred column ≤ 560 px at 1280):** header with the town name + SAMPLE badge; the emergency banner
  always first; "What's the problem?" with seven big category buttons (icon, label, hint; 2 columns at 390, ≥ 64 px tall); "Your
  reports on this phone" below (from `localStorage`). Steps with a step line ("Step 2 of 4"), an in-page **Back** on every step, primary
  buttons full width ≥ 56 px. **Where:** the map (≥ 55 % of the viewport height at 390) with the boundary drawn as a harbour-blue line
  and the outside dimmed, "Tap the map where the problem is", the pin draggable, **Use my location**, **Search a street** (type-ahead
  over the town's streets; picking one moves the map and the pin there), and the chosen spot's street under the map ("Near Main
  Street"). Outside the boundary: the red message "That spot is outside the town. Move the pin inside the line on the map." and **Next
  stays disabled**. **Already reported nearby** (only when the API returns any): "Is it one of these?" cards (category, street,
  status, "Reported Mon Sep 7", "about 40 m from your pin", "+2 others"), each with **Me too**; then "No, mine is different". Me too →
  "Thanks. We added you to HP-1003." with its status link. **Photo:** "Add a photo" (camera or library), preview, "Take a different
  one", "Skip the photo". **Details:** "What's wrong?" (optional except for Something else, counter to 500), "Your name" and "Phone
  number" under the heading "So we can call you back (optional)", then **Send report**. **Report sent:** big reference number, "Save
  this link to check on it", **Copy link** and **Open the status page**, and a plain note that nothing is texted or emailed.
- **Status (`/s/?k=`):** one card: town + SAMPLE badge, "Report HP-1003", category and street, the status as a big chip and sentence,
  the public message in a quoted box, dates, "+2 others reported this", the public history list, the office phone. Merged: "This
  report was joined with HP-1001" + link. No map, no photo.
- **Staff (`/staff/`, desktop-first at 1280, usable at 390):** PIN sign-in; top bar Board · Map · Weekly report · Settings + Sign out.
  **Board** at 1280: five columns with counts; at 390: a status switcher and one column. Filters row (category, ward, age "Any age /
  Older than 3 days / 7 / 30", "Overdue only"). Cards: ref, category icon + label, street, age ("4 days"), "+2", crew, photo marker,
  overdue edge and text. **Detail** (side panel at 1280, full screen at 390): photo, description, reporter name and a `tel:` phone link,
  a small map, status select, crew select, public message box, **Save** (shows the API's error inline; `stale` → "Someone else changed
  this report. Reload" with a Reload button), **Copy update text** ("Copied"), status link with Copy, internal notes (a yellow
  "Only town staff see notes" label), history, "Join with another report" (likely duplicates from candidates, or type a reference) with
  an inline confirm. **Map:** clustered pins coloured by status, overdue ring, filters shared with the board, a pin opens the detail.
  **Weekly report:** week picker (previous/next), table by category, totals, oldest open, **Download CSV**. **Settings:** emergency
  phone, office phone, office hours, SLA days per category ("blank = no target"), crews (add, rename, deactivate), change PIN.
- Map on every page with a map: OpenFreeMap positron through MapLibre GL inside Leaflet, OpenFreeMap's attribution markup always
  visible, and the style's town-name label layers (`label_*` ids for places) hidden once the style loads, so the SAMPLE town is not read
  as the real place underneath; street names stay.
- Plain English for Newfoundland. Everything quiet under `prefers-reduced-motion`.

## Stack
- `worker/`: Cloudflare Worker, plain JS ESM, no build, **no npm dependencies** (use the `wrangler` on PATH, 4.131+).
  `worker/wrangler.toml`: name `town-service-requests`, `main = "src/index.js"`, `compatibility_date = "2026-09-01"`, D1 binding `DB`
  (`database_name = "town-service-requests"`, `database_id = "00000000-0000-0000-0000-000000000000"` with a comment that deploy
  replaces it, `migrations_dir = "migrations"`), R2 binding `PHOTOS` (`bucket_name = "town-service-requests-photos"`), `[assets]
  directory = "../app/public"`, `run_worker_first = ["/api/*"]`. **No `[vars]` block, no `TEST_MODE` in the file, ever.**
- `app/public/`: plain HTML/JS/CSS served by the same Worker (`/`, `/s/`, `/staff/`). Map libraries are already vendored on main in
  `app/public/vendor/` (Leaflet 1.9.4, MapLibre GL 5.24.0 + @maplibre/maplibre-gl-leaflet 0.1.4, leaflet.markercluster 1.5.3; see
  `VERSIONS.txt`). No CDN.
- `app/tests/`: Playwright 1.63 (`app/node_modules` is installed on main; the lead symlinks it into your worktree).
- `data/town.json`, `data/test-points.json`: lead-owned, read only for slices.
- Local dev: `wrangler dev --local --port <p> --inspector-port <p+10> --persist-to <dir>`; tests add `--var TEST_MODE:1`.
  Migrations: `wrangler d1 migrations apply town-service-requests --local --persist-to <dir>` (run from `worker/`).
- **Reference, read only:** `~/Projects/Snow Route` is a finished sibling build with the same shape (Worker + D1 + R2 + static app +
  OpenFreeMap map + Playwright). Good patterns to copy and adapt: `worker/tests/run.mjs`, `worker/tests/negative-lib.mjs` + one
  `negative-*.mjs` (copy-the-worker-and-break-it controls), `app/tests/start-worker.mjs`, `app/playwright.config.mjs`,
  `app/tests/helpers.mjs` (the network guard that answers the OpenFreeMap style with a local fixture, `tap()` with elementFromPoint,
  generated PNG photos), `app/public/owner/owner.js` map setup. **Never write in that folder, never run anything from it.**
- **Ports (never use another):** ts1 Worker 8502 (inspector 8512), ts1 negative-control Workers 8505 (inspector 8515). ts2 dev Worker
  8501 (inspector 8511), e2e Worker 8503 (inspector 8513), app negative-control Worker 8506 (inspector 8516). QA (lead) 8509
  (inspector 8519). Other crews run wrangler on this machine; the default inspector port 9229 collides.

## Rules
- You own the files listed under your id and **nothing else**. If you need a change in someone else's file, say so in your report; do
  not reach in. `rig guard` enforces this. The lead owns `docs/API.md`: if the contract is wrong or unclear, write the question in your
  report and end your turn; do not invent a different contract.
- Verify, then commit, then report. Never leave a verified step uncommitted: a usage-limit pause lands mid-task with no warning.
- Your report goes in `docs/build-report-<your id>.md`, committed with your work: tests passed/failed/skipped, every negative control
  with the exact break and the red output, known gaps, and anything you want the lead to decide.
- Commit only your own paths: `git commit -- <paths>`. Never grade the shared tree; the lead's numbers come from `rig qa`.
- A check that cannot fail measured nothing. Every task below names its negative controls: make each red once (after the unbroken copy
  passes), record it, restore. Controls break a **copy** (in `.negative/`, git-ignored), never the shipped code, and the shipped code
  has no switch that turns a guard off.
- **Milestones.** Finish the milestone, commit, update your report, and end your turn with a one-paragraph summary. The lead merges,
  sends a cross-review, then prompts you for the next milestone. Do not start the next one before that prompt.
- Local only: no deploy, no `--remote`, no `d1 create`, no `r2 bucket create`, no `secret put`. Nothing is sent anywhere. If auto mode
  denies something, do not work around it; note it in your report and carry on.
- No devils or demons, no emoji icons, SAMPLE on every screen, no real businesses or towns named as customers.
- No request to a real third-party host from any test (a test fails if anything leaves 127.0.0.1; the map style is a local fixture).

## Agents

### ts1 — Worker, D1, R2, geometry, requests, staff API
Owns:
- worker/**

Report: docs/build-report-ts1.md

Task:
Implement `docs/API.md` exactly, in `worker/src/` (suggested split: `index.js` router, `geo.js` pure haversine / point-in-polygon /
nearest street / ward, `time.js` NL labels and week bounds, `sla.js` due/overdue/age, `csv.js`, `auth.js` PIN/tokens/keys, `clock.js`
now/IP with the TEST_MODE rule, `history.js` event texts, `copy.js` copy_update, `seed.js`). `worker/tools/build-town-data.mjs` reads
`../data/town.json` and writes `src/town-data.js` (commit the output; the Worker never reads outside `worker/`). `npm test` =
`node tests/run.mjs`: pure unit tests first, then wipe `worker/.state-<PORT>`, apply migrations there, start `wrangler dev --local` with
`--var TEST_MODE:1` on `PORT` (default 8502) if nothing answers, run `node --test tests/api.test.mjs`, stop what it started. `npm run
negative` runs every negative control; each appends its output to `tests/negative-control.log` and exits 0 only if its check went red.
`npm run dev` = migrate + wrangler dev on 8502.

**M1 (commit as soon as it is green, then stop):** `wrangler.toml`; `migrations/0001_init.sql` (settings single row, staff sessions,
sign-in and rate-limit attempts, crews, requests with `submission_id UNIQUE` and ids starting at 1001, request history, me-too devices
PRIMARY KEY (request_id, device_id), photos, upload tokens); `migrations/0002_sample.sql` (SAMPLE settings, SLA defaults, PIN 3690 as
PBKDF2 hash + salt, the three SAMPLE crews). Routes: `GET /api/town`, `POST /api/requests`, `PUT /api/requests/:id/photo`,
`GET /api/requests/nearby`, `POST /api/requests/:id/me-too`, `GET /api/status/:key`, `GET /api/photos/:key`; staff `signin`, `signout`,
`GET requests` (all filters), `GET requests/:id`, `PUT requests/:id`, `POST requests/:id/notes`, `GET requests/:id/candidates`,
`POST requests/:id/merge`, `GET crews`, `GET settings`; `POST /api/test/reset`.
M1 tests. `tests/geo.test.mjs` (pure): haversine against a pair whose value the test computes independently with the formula written
out; a point moved north by exactly 40 m and 60 m (1 m = 1 / 111195.0797 degrees of latitude) measures 40 ± 0.01 and 60 ± 0.01;
`inside_centre` inside, `outside_south` and `outside_east_of_boundary` outside; a square ring with points inside/outside/concave cases;
`on_street` gets its street name (its nearest other street is 74 m away); `far_from_streets_inside` (330 m from any street) gets "Not
near a named street"; ward lookup for one point per ward. `tests/unit.test.mjs` (pure): SLA — a streetlight request (10 days) created at T is **not overdue at T + 9 d 23 h 59 m**,
**not overdue at exactly T + 10 d**, **overdue at T + 10 d + 1 min with `overdue_days` 1**, and a done request is never overdue; a null SLA
is never overdue; `age_days` floors; `days_to_close` rounds half-up (e.g. 3.25 days → 3.3); labels in NL time across a DST change.
`tests/api.test.mjs` M1: town shape (7 categories in order, streets sorted, `sample` true, no polygons for wards); **create**: a good POST
→ 201 with ref `HP-1001`, `location_label` right for a pin on `on_street`; one test per validation row; **pin outside the boundary →
400 `outside_boundary`, field `location`, and no request created** (read back through the staff list); **same `submission_id` twice →
200 `duplicate: true` and exactly one request**; photo PUT jpeg with the token → stored, `GET photo_url` returns the same bytes and type;
wrong token 401; 413 for 5 000 001 bytes; 415 for `text/plain`; **nearby: a pothole at 40 m is found with `distance_m` 40 and one at
60 m is not; a streetlight at 10 m is not (other category); a closed pothole at 10 m is not**; me-too → 201 count 1, same device → 200
duplicate count 1, reporter's own device → duplicate, on a done request → 409; **public status never contains the reporter's name, the
phone, the description, an internal note's text, the crew name, the photo key or the pin's coordinates** (assert on the raw text of the
response, with distinctive strings for each), and shows a public message and history; unknown key 404; staff: wrong PIN 401 field `pin`,
no token 401; list filters (status open/closed, category, ward, min_age_days, overdue) and counts; **overdue on a fake clock through the
API**: a streetlight created with `X-Test-Now` T, read at T + 9 d 23 h (not overdue) and T + 10 d + 1 h (overdue, `overdue_days` 1), then
marked done at that time → not overdue; PUT: assign crew moves new → assigned, `assigned` without crew 400, `wont_fix` without message
400, stale version 409 with `request`, closed_at set and cleared, history entries and texts exact; note appears in staff history as
internal and not in status; **merge keeps the +1 count**: A with 2 me-toos, B with 3 → merge B into A → A `plus_ones` 6, B `merged` with
`merged_into`, B's status link shows `merged_into.ref` A; merge C (0) into A → 7; merge A into D (1 me-too) → D 9 and B, C now point at
D; merge into self 400; merge into a merged request 409; `copy_update` text exact for assigned with a message.
M1 negative controls (each: unbroken copy passes, then the break, then red): (a) `negative:boundary` — the copy skips the boundary check
→ the outside-pin API test goes red; (b) `negative:radius` — the copy's nearby radius is 70 m → the 60 m test goes red; (c)
`negative:mergecount` — the copy adds only `+ 1` on merge (drops the source's plus_ones) → the merge-count test goes red; (d)
`negative:leak` — the copy adds `reporter_phone` to the status JSON → the public-status privacy test goes red; (e) `negative:overdue`
— the copy compares `now >= created_at` instead of `now > due_at` (ignores the SLA) → the fake-clock overdue tests go red; (f)
`negative:idempotent` — the copy drops the `submission_id` lookup and UNIQUE (migration in the copy) → the same-submission test goes red.

**M2 (after the lead's prompt):** `PUT /api/staff/pin`, crews POST/PUT, settings PUT, weekly report, CSV export, every rate guard
(create, me-too, sign-in, unknown status key, with `X-Test-IP`), `POST /api/test/seed {scenario: "demo"}` with generated SVG placeholder
photos (no real people, SAMPLE on every name). Tests: PIN change (old PIN refused after, new works, other session still works); crews
validation + deactivated crew can't be assigned; settings validation per field and an SLA change flips `overdue` on read; **weekly report on
a fake clock**: requests created and closed at chosen instants → exact opened/closed per category, averages half-up, totals from all
closed (not a mean of means), merged requests left out, `oldest_open` order; **NL week boundary**: a request created at Sunday 11:30 PM
NDT (Monday 02:00 UTC) counts in the earlier week, and a week spanning the November DST change has the right `start_at`/`end_at`; CSV
header exact, CRLF, quoting of a message with a comma and a quote, formula guard on a public message `=SUM(A1)`, **no reporter phone,
name, description or note text anywhere in the CSV**, filename with NL date; each rate guard trips at the stated count and a different
IP is unaffected; the demo seed has every status and category, at least two overdue, one merged pair, and photos that load.
M2 negative controls: (g) `negative:week` — the copy uses UTC week bounds → the NL boundary test goes red; (h) `negative:csvguard` —
the copy drops the formula guard → the CSV test goes red; (i) `negative:csvleak` — the copy adds the phone column → the CSV privacy test
goes red; (j) `negative:mergedreport` — the copy counts merged requests in the weekly report → that test goes red; (k)
`negative:pinguard` — the copy never counts wrong PINs → the sign-in rate-guard test goes red.

### ts2 — Resident report, status page, staff app, Playwright
Owns:
- app/**

Report: docs/build-report-ts2.md

Task:
Build the pages per the brief and Design, talking only to the API in `docs/API.md` through `app/public/api.js` (same-origin
`fetch('/api/…')`; errors surface the API's `error` text as is, next to the field it names). Every screen shows the town name and a
visible **SAMPLE** badge while `sample` is true. Until ts1's M1 is merged into your branch you may develop against
`app/public/api.mock.js` (`?mock=1`, in-memory, same shapes as API.md), but **every Playwright test runs against the real Worker**.
The vendored map libraries are already in `app/public/vendor/` on main; don't replace them. Map setup in one module
(`app/public/map.js`): Leaflet map + `L.maplibreGL({ style: town.map_style_url, attributionControl: { customAttribution: <OpenFreeMap's
quick-start attribution markup> } })`, hide the style's place-name label layers once it loads (a pure function taking a style JSON and
returning the layer ids to hide, unit-tested with Node against the saved `data/sources/openfreemap-positron-style.json`: it hides
`label_town`, `label_village`, `label_city` and the other place `label_*` layers and keeps street and water name layers), and fall back
to a plain background with the attribution when WebGL is missing.
Playwright (`app/playwright.config.mjs`): projects `chromium-390` (390×844, hasTouch, isMobile), `chromium-1280` (1280×800), `webkit-390`
(iPhone 14 device), `webkit-1280`; `workers: 1`; `webServer` = `node tests/start-worker.mjs` (from `../worker`: wipe `app/tests/.state-<port>`,
apply migrations `--local --persist-to` it, `wrangler dev` on `E2E_PORT` default 8503, inspector +10, `--var TEST_MODE:1`; `E2E_WORKER_DIR`
may point it at a copy for negative controls); `baseURL` = that Worker. Every test starts with `POST /api/test/reset`. A shared fixture
answers `https://tiles.openfreemap.org/styles/*` with a tiny local style (a background layer only) and fails the test if any other request
leaves 127.0.0.1. **Real input only:** taps/clicks through a `tap()` helper that hit-tests the target's centre with `elementFromPoint`
first, map taps through `tapAt()` at a point hit-tested to the map, typing via `page.keyboard` (in chromium touch projects, if keys drop
after a tap, use `page.keyboard.insertText` and assert the field's value), photos via the real file chooser with a **generated** image
buffer, location via Playwright's `geolocation` + `permissions` context options; never set app state with `evaluate` (reading is fine).
Native `<select>` values via `selectOption`. Test data may be arranged through the API (with `X-Test-Now` for past dates).

**M1 (commit when green, then stop):** `theme.css`, `style.css`, `map.js` (+ its Node unit test `app/tests/unit/map-labels.test.mjs`),
`api.js`, the **resident page `/`** (every step in the Design, the boundary check on the phone with the same ray-casting rule, the photo
downscaled to max 1600 px JPEG quality 0.7 with a canvas and uploaded with the token after the report is created; a failed upload shows
"Your report was sent, but the photo didn't go through." with **Try the photo again**; the report is never blocked by the photo; the
`submission_id` is made once per report and reused on retry; `device_id` once per phone in `localStorage`), the **status page `/s/`**, and
`app/playwright.config.mjs` + `tests/start-worker.mjs` + `tests/helpers.mjs`. Screenshots (against the mock is fine for M1) of the
resident steps and the status page at 390 and 1280 into `app/tests/shots/`.

**M2 (after the lead's prompt; `git rebase main` first, ts1 M1 is merged by then):** the Playwright suite for the resident and status
pages against the real Worker, plus the staff app on M1 routes: sign-in, board (columns, counts, filters, cards with overdue), detail
(status, crew, public message, Save with inline errors and the stale path, notes, copy update, status link, photo, merged list, join
with another report). Specs: `report.spec.mjs` (tap Pothole → tap the map inside → Next → Add a photo (file chooser) → type a
description, name and phone → Send → "Report sent" with `HP-1001` → Open the status page → it shows the ref, "Pothole" and the street, and
the page text **and every response body the status page loaded** contain neither the phone nor the name nor the description; the staff
API shows the photo stored), `boundary.spec.mjs` (**tap the map outside the boundary → the outside message shows and Next is disabled and
no request exists**; then tap inside → Next works; "Search a street" → pick a street → the pin moves and "Near <street>" shows; "Use my
location" with a geolocation inside → the pin lands there; with one outside → the message), `nearby.spec.mjs` (read the pin the app placed
from a `data-lat`/`data-lng` attribute, arrange through the API a pothole 40 m north and one 60 m north of it and a streetlight at 10 m →
Next → "Already reported nearby" lists exactly the 40 m pothole with "about 40 m"; **Me too** → "Thanks. We added you to HP-…" and the
API count is 1 and no new request exists; a second run from the same phone shows it as already added; "No, mine is different" continues
the report), `status.spec.mjs` (public message and history show; merged link shows; bad key → the plain 404 message), `staff.spec.mjs`
(wrong PIN "That PIN is not right." **and** 401 via `waitForResponse`; board counts match the API; open a card → assign a crew + public
message → Save → card moves to Assigned and the status page shows the message; an internal note shows in staff history and never on the
status page; `wont_fix` without a message shows the API's message inline; stale: change the request through the API, then Save in the UI →
the stale message + Reload), `merge.spec.mjs` (open a duplicate → Join with another report → pick the candidate → confirm → the kept
report shows `+N` equal to the API's `plus_ones`, and the duplicate's status page shows "joined with"), `targets.spec.mjs` (every resident
button and category button ≥ 44 px and hit-tests to itself at 390 in both engines, primary buttons ≥ 56 px tall; SAMPLE badge visible on
`/`, `/s/`, `/staff/`; no horizontal scroll at 390; chip, banner and button colours meet 4.5 : 1; the map attribution with its three links
is visible on the resident map).
M2 negative controls: (a) `negative-boundary.mjs` — copy `app/public` + `worker` into `app/.negative/boundary/`, remove the phone-side
boundary check in the copy's resident page, run `boundary.spec.mjs` on 8506 → red (the outside tap no longer stops at the pin step); (b)
`negative-statusleak.mjs` — the copy's Worker adds `reporter_phone` to the status JSON → the report spec's response-body privacy check
goes red; (c) `negative-overlay.mjs` — a transparent overlay over **Send report** in a copy → `tap()`'s hit-test goes red; (d)
`negative-metoo.mjs` — the copy's Me too creates a new request instead of calling `me-too` → `nearby.spec` goes red; (e)
`negative-attribution.mjs` — the copy drops the custom attribution → the attribution check goes red. Each exits 0 only when red after an
unbroken pass, appends to `app/tests/negative-control.log`.

**M3 (after the lead's prompt; rebase on main, ts1 M2 merged):** staff **Map** (markercluster, status colours, overdue ring, filters shared
with the board, pin → detail), **Weekly report** (week picker, table, totals, oldest open, **Download CSV**: fetch with the token → blob
download), **Settings** (phones, office hours, SLA per category, crews add/rename/deactivate, change PIN), sign out. Specs:
`overdue.spec.mjs` (arrange through the API a streetlight created 11 days ago and a pothole 3 days ago → the streetlight card shows
"Overdue by 1 day" with the red edge and the pothole card doesn't; Settings → streetlight 12 days → Save → back on the board the card is
no longer overdue; "Overdue only" filter shows just the overdue one), `report-week.spec.mjs` (arrange created/closed requests at chosen
past instants in the previous week → the table's numbers, average and oldest open equal the API's; previous/next week buttons; the CSV
download's text equals `GET export.csv` and has no phone), `map.spec.mjs` (20 requests close together → a cluster marker with the count;
clicking it zooms and shows pins; clicking a pin opens that request's detail), `settings.spec.mjs` (validation message inline for a bad
phone; add a crew and it appears in the detail's crew select; deactivate it and it disappears from the select; change PIN → sign out →
old PIN refused, new PIN works), `emergency.spec.mjs` (change the emergency phone in Settings → the resident banner shows the new number as
a `tel:` link). M3 negative control: (f) `negative-overdue.mjs` — the copy's board reads overdue from `age_days > 10` instead of the API's
`overdue` → `overdue.spec` goes red after the SLA change. Final screenshots of every screen in all four projects into `app/tests/shots/`.

## Main (ts-lead, not a slice)
Owns PLAN.md, AGENTS.md, DECISIONS.md, BRIEF.md, docs/API.md, docs/DEPLOY.md, docs/build-report.md, docs/shots/**, data/**, tools/**,
README.md, package.json, demo.mjs, .gitignore. Merges each milestone after reading the diff, sends cross-reviews (ts2 reviews ts1's M1
against API.md before building M2; ts1 reviews ts2's M2 API calls read-only), runs `rig qa --ref <sha>` on 8509 for the Worker suite, every
negative control and the Playwright suite, takes `pwshot` screenshots into `docs/shots/` from `npm run demo`, writes README / DEPLOY / build
report, pushes the private repo, closes the slice tabs by id, removes worktrees, writes the status file.

## Open questions
None blocking. Anything that needs Alexander goes under NEEDS ALEXANDER in the status file.
