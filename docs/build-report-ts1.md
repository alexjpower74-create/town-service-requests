# Build report: ts1 (Worker, D1, R2, geometry, requests, staff API)

Slice `worker/**`, branch `rig/ts1`. A record, not a queue: items are marked DONE or REJECTED in place.

## M1 (2026-09-14)

Commits: `d7344ca` (Worker, schema, tests), `707901f` (negative controls + the idempotency fix they found), then this report
and `tests/negative-control.log`.

### What I built: DONE
- `worker/wrangler.toml` exactly as PLAN.md Stack says (no `[vars]`, no TEST_MODE; assets `../app/public`, `run_worker_first`).
- `migrations/0001_init.sql`: settings (single row), staff_sessions (SHA-256 of the token), attempts (rate-guard table, used in M2),
  crews, requests (`submission_id UNIQUE`, `status_key UNIQUE`, `CHECK (id >= 1001)`, ids made as `COALESCE(MAX(id), 1000) + 1`, so
  a reset starts again at 1001 without touching `sqlite_sequence`), request_history (staff text + public text + internal flag, so
  the status route reads `public_text` only), metoo_devices `PRIMARY KEY (request_id, device_id)` (the reporter's phone is a row with
  `reporter = 1`), photos (one per request), upload_tokens (SHA-256, 1 h).
- `migrations/0002_sample.sql`: SAMPLE settings, SLA defaults, PIN 3690 as PBKDF2-SHA256 hash + salt (100 000 iterations, made with
  `tools/hash-pin.mjs`), the three SAMPLE crews. `src/sample.js` holds the same rows for `/api/test/reset`; a unit test proves the
  two agree and that the stored hash verifies 3690 and refuses 3691.
- `tools/build-town-data.mjs` → `src/town-data.js` (streets sorted, lines kept for nearest-street) and `tests/test-points.js`
  (so the tests and every `.negative/` copy never read outside `worker/`). Both outputs committed.
- `src/`: `index.js` router and every M1 route; `geo.js` (haversine R = 6 371 008.8, ray casting lng-as-x, point-to-segment on an
  equirectangular projection centred on the pin, 150 m inclusive, ties alphabetical, ward lookup); `time.js` (NL labels); `sla.js`
  (due, strict overdue, ceil overdue_days, floor age, half-up tenths in integer arithmetic so 1.15 days is 1.2, not 1.1);
  `clock.js` (X-Test-Now / X-Test-IP only with TEST_MODE=1; IP falls back to `"local"`); `auth.js`; `history.js`; `copy.js`;
  `lists.js`; `sample.js`.
- Routes: `GET /api/town`, `POST /api/requests`, `PUT /api/requests/:id/photo`, `GET /api/requests/nearby`,
  `POST /api/requests/:id/me-too`, `GET /api/status/:key`, `GET /api/photos/:key`; staff `signin`, `signout`, `GET requests` (all
  filters + counts), `GET/PUT requests/:id`, `POST requests/:id/notes`, `GET requests/:id/candidates`, `POST requests/:id/merge`,
  `GET crews`, `GET settings`; `POST /api/test/reset` (404 without TEST_MODE).
- Writes that must not half-happen are one D1 batch: create (request + history + reporter device + upload token), me-too (device +
  count + history, chained on `changes() = 1`), photo (row + status + history), staff PUT (versioned UPDATE, an in-batch guard,
  history), merge (both versioned UPDATEs with guards, re-pointing earlier merges, both history entries).
- `npm test` = `node tests/run.mjs` (unit, then fresh `.state-8502` + migrations + `wrangler dev --local --var TEST_MODE:1` on 8502,
  inspector 8512, if nothing answers; stops what it started). `npm run negative` runs all six controls on 8505 / 8515.
  `npm run dev` = migrate + wrangler dev on 8502.

### What I verified, and how it could have failed: DONE
`npm test` at `707901f`: **17 unit tests pass, 33 API tests pass, 0 fail, 0 skipped.**
- `tests/geo.test.mjs` (7): haversine against the formula written out separately in the test; 40 m and 60 m north offsets measure
  40 ± 0.01 and 60 ± 0.01; the three fixed boundary points; a square and a concave U (a point in the notch is outside); `on_street` →
  Airbase Road with the second-nearest street at 74 m (matching the lead's `nearest_other_street_m`, so my projection agrees with the
  tool that made the fixtures); `far_from_streets_inside` → "Not near a named street" with the nearest at 330 m; 149 / 151 m edges and
  the alphabetical tie; one point per ward and one outside all wards.
- `tests/unit.test.mjs` (10): the four SLA instants from the brief (T + 9 d 23 h 59 m no, exactly T + 10 d no, T + 10 d + 1 min yes
  with 1 day), done / won't fix / merged / null SLA never overdue, floors, half-up, labels across both 2026 NL DST changes and across
  NL midnight, history texts, merged copy_update, SAMPLE rows vs migration.
- `tests/api.test.mjs` (33): everything the brief lists for M1, asserting exact texts, fields and codes, plus: expired upload
  token, a token from another report, a resend issuing a fresh token that kills the old one, session expiry at 12 h, notes and me-too
  not bumping `version`, `updated_at` following public entries only, a closed merge target, a closed source keeping its `closed_at`,
  merged requests left out of the default list, and 404 JSON for unknown routes.
- Test mistakes caught on the first run (the Worker was right, the tests were wrong): a "31-character" phone that was 30; a 415
  expected for bytes labelled `image/jpeg` (the contract rejects on content type, not by sniffing); the word "crew" banned from the
  status page although the public text "Assigned to a crew" is required; tokens reused days after their 12-hour session ended. Each
  was fixed in the test, not by loosening the Worker.

### Negative controls: DONE (all six RED at `707901f`)
Each copies `worker/` to `worker/.negative/<name>` (git-ignored), serves the copy on 8505, runs the named test on the **unbroken**
copy (must pass), applies the literal break (must match exactly once), restarts on fresh state, runs again (must show ✖). Records are
in `worker/tests/negative-control.log`.

| control | break in the copy | test that went red |
|---|---|---|
| `negative:boundary` | `src/index.js`: `if (!pointInRing([lat, lng], TOWN.boundary)) {` → `if (false) {` | ✖ create: a pin outside the boundary is refused and no request is created |
| `negative:radius` | `src/index.js`: `const NEARBY_METRES = 50` → `70` | ✖ nearby: a pothole at 40 m is found and one at 60 m is not |
| `negative:mergecount` | `src/index.js`: `const added = source.plus_ones + 1` → `const added = 1` | ✖ merge keeps the +1 count |
| `negative:leak` | `src/index.js`: adds `reporter_phone: row.reporter_phone,` to the status JSON | ✖ public status never contains private fields |
| `negative:overdue` | `src/sla.js`: `now > dueAt` → `now >= createdAt` | ✖ overdue on a fake clock through the API |
| `negative:idempotent` | `migrations/0001_init.sql`: drop `UNIQUE` on `submission_id`; `src/index.js`: `const existing = null` | ✖ create: the same submission_id twice makes exactly one request |

**A control that found a real flaw.** On its first run (logged at `d7344ca +uncommitted`) `negative:idempotent` was **NOT RED**: with
the lookup and UNIQUE removed, the resend still answered 200 `duplicate`. The create batch found the new row by `submission_id`, so
the reporter-device insert also matched the *first* report and collided with its `(request_id, device_id)` key; that UNIQUE error was
caught as "duplicate". Idempotency was leaning on an accident (and a resend without `device_id` would have been let through), and
the extra rows would have been attached to the wrong report. Fixed in `707901f`: the batch finds the new row by its fresh random
`status_key`. The control then went red, and the full six were re-run on the clean commit. The earlier runs stay in the log as a
record.

### Checked by hand, not by a committed test
A race probe on 8502: two staff PUTs with the same version at once, five rounds → one 200 and one 409 `stale` each time, history
never doubled; merging A into B and B into A at once → one 200, one 409 `bad_state`, counts right; three identical "Me too" taps at
once → 201 / 200 / 200, count 1. **Gap:** the probe cannot show *which* layer refused the losing PUT (the version check before the
batch, or the in-batch `changes()` guard that rolls the batch back), so the in-batch guard's refusal path has never been seen to fire.
It is belt-and-braces behind the version check; I did not add a switch to force it, per the rule that shipped code has no break
switches.

### Calls I made where the contract is silent (lead: please confirm or correct)
1. **Label text.** API.md quotes `Intl.DateTimeFormat('en-US', {weekday, month, day})` → `"Mon Sep 7"`, but that call really prints
   `"Mon, Sep 7"` (comma), and newer ICU puts a narrow no-break space before AM. I followed the **example text**: labels are built
   from `formatToParts` as `Mon Sep 7` and `Mon Sep 7, 10:45 AM` with a plain space. ts2 shows the labels as given, so nothing changes
   there, but a test that recomputes a label with `Intl.format` would see a comma.
2. **PUT order:** 404 → `version` not an integer (400 field `version`, "Reload this report and try again.") → merged (409 `bad_state`)
   → stale (409) → field validation → changes. A merged request answers `bad_state` even with an old version, because "Reload" can't
   help there.
3. **Messages API.md doesn't give:** list filters (`status` "Pick a status.", `category` "Pick one of the categories.", `ward` "Pick one
   of the wards.", `min_age_days` "Use a whole number of days.", `overdue` "Use overdue=1 for overdue reports only."); merge `into_id`
   missing or not an integer uses the same text as merging into itself; unreadable JSON 400 "That request could not be read.";
   unexpected errors 500 `server_error` "Something went wrong. Try again."
4. **List query:** an empty parameter (`?status=&category=`) counts as absent (forms send empty values); `overdue=0` is accepted as no
   filter; `status=merged` lists the merged ones.
5. **Photo PUT order:** 404 unknown id → 401 token → 413 size → 415 type. The type is the part before `;`, lower-cased; bytes are not
   sniffed.
6. **Crews on PUT:** sending the crew a request already has is "no change", even if that crew was deactivated since (the contract
   says deactivated crews stay on their requests). Setting a crew on a `new` request without `status` moves it to `assigned`.
7. **Notes** are allowed on merged and closed requests (they never change anything public).

### Left undone
- Rate guards (create, me-too, sign-in, unknown status key): M2 per the brief. The `attempts` table exists; no route counts yet.
  REJECTED for M1 on scope, not on merit.
- Everything else listed under M2 (PIN change, crews POST/PUT, settings PUT, weekly report, CSV, demo seed). Not started, per the
  milestone rule.

### Needs from other slices
Nothing. For ts2: absolute URLs use the request's origin (`http://127.0.0.1:<port>`), and `reported_label` in `nearby` is the
date-only label (`"Mon Sep 7"`) as API.md shows; everywhere else `reported_label`/`created_label`/`closed_label` are full labels.

## M2a (2026-09-14)

Rebased on main (`13d8a77`, ts2 M1 + API.md clarifications 1–9) with no conflicts.

### `GET /api/town/locate` (clarification 9): DONE
`src/index.js` `locate`: `{ inside, location_label, ward }` from the same `pointInRing`, `locationLabel` and `wardOf` the create
route uses; outside the boundary still 200 with `inside: false` and the label and ward it would have had; `lat`/`lng` missing, empty
or not a number → 400 `bad_request` field `location` "Put a pin on the map where the problem is."; no rate guard;
`Cache-Control: no-store` (every API JSON answer has it). `nearby` now shares the same `queryNumber` parser.
API test `town locate: the Worker's own inside, street label and ward for a pin`: inside_centre → inside, ward centre; on_street →
exactly `{ inside: true, location_label: "Airbase Road", ward: "north" }` and a report made at that pin stores the same label;
far_from_streets_inside → `"Not near a named street"`, ward south; outside_south and outside_east_of_boundary → `inside: false` with a
non-empty label; `lat=abc`, missing `lng`, empty `lat` → 400 field `location` with the exact message; the header is `no-store`.
`npm test`: **unit 17 pass, API 34 pass, 0 fail.** No negative control for this route (none asked); the assertions are exact values
from the lead's fixtures, so a different geometry rule would have to reproduce Airbase Road and the 150 m miss to stay green.

## Cross-review of ts2 M1
Read-only, against docs/API.md with clarifications 1–9: `app/public/api.js`, `api.mock.js`, `report.js`, `s/status.js`, plus the
three helpers they lean on (`ui.js` uuid/deviceId, `geo.js` nearestStreetByPoint, `s/index.html` referrer meta). Severity is mine.

**Request bodies, query params and headers against the real Worker: none wrong.**
- `POST /api/requests` body `report.js:370-380` has every field with the right types; `submission_id` made once per report
  (`report.js:82`) and reused on every resend and photo retry; `device_id` from `ui.js:55-62` (UUID v4, including the
  `getRandomValues` fallback, which sets the version and variant bits correctly). Untrimmed strings are fine, the Worker trims.
- `GET nearby` `api.js:64` category/lat/lng encoded; `POST me-too` `api.js:65` `{ device_id }`; `GET status` `api.js:66`.
- `PUT photo` `api.js:63`: `Authorization: Bearer`, `Content-Type` from the blob (always `image/jpeg` from `report.js:301`), the absolute
  `upload_url` reduced to a same-origin path. `fetch(..., { cache: 'no-store' })` `api.js:38`.
- `/s/` sets `<meta name="referrer" content="no-referrer">` (`s/index.html:6`).

**Response fields read: none wrong.** Create: `ref`, `status_url`, `category_label`, `location_label`, `reported_label` (full label),
`photo`, `upload_url`, `upload_token` (`report.js:384,399,413-415`). Nearby: `requests[].id, ref, category, category_label,
location_label, status, status_label, reported_label` (date label, clarification 8), `distance_m`, `plus_ones` (`report.js:218-231`).
Me-too: `ref`, `status_url`, `duplicate` (`report.js:248-251`). Status: every field `s/status.js:14-45` reads exists with that name and
type; `updated_at !== reported_at` compares two ISO strings from the same source, which is right. Errors: `error`, `code`, `field`
(`api.js:17-24`); labels are shown as given, never recomputed.

**Status codes: 401 / 404 / 409 / 413 / 415 fine; 429 fine for when M2 adds it.**
- 400 on send: `report.js:352-361` puts `description`/`name`/`phone` errors next to their inputs and everything else (`location`,
  `outside_boundary`, `category`, `submission_id`, `device_id`, `has_photo`) under Send. Fine.
- Photo `report.js:408-422`: 401 (expired token) hides the reason and "Try the photo again" re-sends the same `submission_id`, which
  gets a fresh token from the duplicate path. That is exactly the contract. 413/415 show the API text.
- 404 on status `s/status.js:74-77` shows the API's message and stops re-checking, so an unknown link does not keep spending the
  unknown-key rate guard on every `visibilitychange`. Good.
- 429 (M2): every path shows `e.message`; on the status page an existing card is kept (`s/status.js:78`). Fine.

**Findings**
1. **Low, known and covered by clarification 9:** `report.js:135-136` shows "Near {street}" from `nearestStreetByPoint` (`geo.js:51`),
   which measures to **one point per street** with a **250 m** limit. The Worker measures to street **segments** with a **150 m**
   limit, so the phone can say "Near Main Street" while the stored `location_label` (and the status link) say another street or "Not
   near a named street". A picked search result (`report.js:190`) is shown as that street, and the Worker will agree unless another
   street's segment is closer at that point. `GET /api/town/locate` is live on this branch for ts2 M2.
2. **Low:** `report.js:338` counts description length with `.trim().length` (UTF-16 units) and `api.mock.js:129,132` does the same for
   description and name; the Worker counts code points (`[...s].length`). With emoji the counter says "over 500" and the mock refuses
   while the real Worker accepts. It never lets through something the Worker refuses.
3. **Low:** `report.js:253-256` re-enables **Me too** after a 409 `bad_state` ("This report is already closed.") or a 404, so tapping it
   again only repeats the same error. Hiding the button on 409/404 would read better.
4. **Low:** `report.js:419-421` offers "Try the photo again" after 413/415, which re-sends the same blob and must fail the same way;
   "Take a different one" fits those two codes. Unlikely in practice after the 1600 px / 0.7 shrink.
5. **Mock only, low** (no Playwright spec uses the mock): `api.mock.js:122-124` looks up the duplicate **before** validating, so an
   invalid resend answers `duplicate: true` where the Worker answers 400 (the Worker validates the whole body, boundary included,
   then looks up); `api.mock.js:124` refuses `device_id: null`, which the Worker accepts; `api.mock.js:128` turns a non-string
   description into `''` where the Worker gives 400; `api.mock.js:162-163` checks 415 before 413 (clarification 5 says 413 first);
   `api.mock.js:32` builds the time part with `Intl.format`, which gives a narrow no-break space before AM on newer ICU (clarification
   1 says a plain space); no upload-token expiry; no `/api/town/locate` yet.

Nothing in ts2 M1 needs a Worker change.

## M2b (2026-09-14)

Rebased on main at `643942e` (API.md clarifications 10–14). Work in `c556585`; this report and the control log follow it.

### What I built: DONE
- `PUT /api/staff/pin`: `new_pin` 4–8 digits as a string (field `new_pin`), then `current_pin` checked (401 field `current_pin`),
  then a fresh PBKDF2 hash + salt. Sessions are untouched, so every other signed-in session keeps working.
- Crews: `POST /api/staff/crews` → 201 crew; `PUT /api/staff/crews/:id` `{ name, active }` → 200 crew. Name 1–40 after trimming;
  `active` must be a boolean. A deactivated crew stays on its requests; the existing PUT rule refuses it for any other request.
- `PUT /api/staff/settings`: every field required and checked in order (`emergency_phone`, `office_phone`, `office_hours`,
  `sla_days.<key>` in category order). Phones and hours stored trimmed. `due_at` and `overdue` read the new SLA at once.
- `GET /api/staff/report/weekly?week=`: `time.js` works out NL midnight with a two-pass offset lookup (`nlMidnightUtc`); `weekOf`
  gives `week_start`, `week_label`, `start_at`, `end_at`. Merged requests are filtered out before every count. Averages are integer
  half-up (`meanDaysHalfUp`); totals are taken over all closed requests. `open_now`, `overdue_now` and `oldest_open` (5, oldest
  first) are as of now.
- `GET /api/staff/export.csv`: same filters and order as the board list, sharing `filteredRequests`. `csv.js` has the exact
  header, CRLF on every line (the last included), RFC 4180 quoting, a formula guard applied before quoting, NL `YYYY-MM-DD HH:MM`
  dates, and the NL-date filename. Rows are StaffRequestSummary plus `public_message` only.
- Rate guards (table `attempts`, window `(now − window, now]`, IP from `clock.js`, `X-Test-IP` only with TEST_MODE, cleared by reset):
  - **create:** 10 new reports per hour; a resend of an existing `submission_id` is answered before the guard, never refused.
  - **me-too:** 30 counted taps per hour; a phone already counted on that report is answered as a duplicate, never refused, and
    only a tap that added +1 is counted (chained on `changes() = 1` in the same batch).
  - **wrong PIN:** 5 per 15 min; the right PIN isn't counted; once tripped, even the right PIN waits.
  - **unknown status key:** 30 per 10 min; once tripped, even good links wait.
  Attempts older than a day are pruned on each new report.
- `POST /api/test/seed { scenario: "demo" }` (`seed.js`): reset, then 24 SAMPLE requests (ids 1001–1024) relative to now.
  - **Where:** pins sit a few metres off a vertex of a real street line, chosen deterministically and inside the boundary.
  - **What:** all 7 categories and all 6 statuses, 3 overdue, one merged pair (HP-1003 into HP-1002, with the +1s carried),
    crews, public messages, 3 internal notes, "Me too" counts, and SAMPLE first names and 709-555-01xx phones on some.
    Descriptions end "(SAMPLE)".
  - **History:** consistent with the status path, with every entry between creation and now.
  - **Photos:** 6 SVG drawings in R2, labelled "SAMPLE photo · A drawing, not a real photo", with no script, links or images.
  - **Returns:** `{ pin, requests: [{ id, ref, status, status_url }] }`, the shape `demo.mjs` reads.
- Clarifications from main:
  - **10:** a crew moves a `new` request to `assigned` only when it changes.
  - **11:** a malformed `%` escape in a status or photo key reaches the handler as "no key" and answers its 404. On the status
    route it also counts as an unknown key.
  - **13:** a merge that still loses after its retries answers 409 `bad_state` "Someone else changed one of these reports.
    Reload and try again."
- Photo answers now also send `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`, since demo photos
  are SVG served from our own origin.

### What I verified: DONE
`npm test` at `c556585`: **unit 21 pass, API 49 pass, 0 fail**.

New unit tests:
- NL midnight on both 2026 DST days, the week spanning the November change, and a week crossing the year end.
- Date parsing refuses Feb 29 2026, month 13, `2026-9-7` and year 0001.
- Every formula-guard trigger, quoting, and CSV dates across DST.
- `X-Test-IP` and `X-Test-Now` are ignored without TEST_MODE.
- The SVG has no script or links and escapes the text it prints.

New API tests:
- **PIN change:** old PIN refused after, new one works, the other session keeps working, reset restores 3690.
- **Crews:** validation, deactivation, and the refused pick.
- **Settings:** 12 validation cases, then an SLA change that clears overdue, then no target, then overdue again.
- **Weekly report on a fake clock, exact numbers:**
  - pothole row: opened 2, closed 3, average 4.9;
  - streetlight row: 0.25 days → 0.3;
  - totals: opened 6, closed 4, average 3.8 (a mean of the row means would be 2.6);
  - a merged duplicate left out; `open_now` 6, `overdue_now` 3, and the `oldest_open` order.
- **NL week boundaries:**
  - the Sunday 11:30 PM NDT report counts in the earlier week; the next week starts at midnight Monday NL time;
  - the default week follows NL time, not UTC;
  - November week: 7 days + 1 hour (`2026-10-26T02:30Z` to `2026-11-02T03:30Z`); March week: 7 days − 1 hour.
- **CSV:**
  - three exact lines covering a quoted message with comma and quotes, `'=SUM(A1)`, `'@crew`, a closed row with its days, and
    the ward and crew names;
  - a filename with the NL date when UTC is already the next day; filters, 400 and 401;
  - privacy: no name, phone, description, note or device id.
- **Each rate guard** trips at its count, lets another IP through, reopens at the window's edge (checked 1 ms either side), and
  never refuses a duplicate.
- **Seed:** the exact return shape; every status, category and board column; overdue ones; the merged pair on the staff and public
  sides; pins inside the boundary and on real streets; SAMPLE names and phones; history in order; every photo loads as
  `image/svg+xml` with the CSP; seeding twice doesn't double up.

Also caught before the first run: two of my rate-guard edge checks were off by one window. Each asserted a 429 at exactly
`T0 + window`, but by then the attempt made at T0 has already left the window. They now check 1 ms before.

### Negative controls: DONE (all eleven RED at `c556585`)
The six M1 controls were re-run on this commit and are still red. The five new ones:

| control | break in the copy | test that went red |
|---|---|---|
| `negative:week` | `src/time.js`: `const bound = date => nlMidnightUtc(…)` → `date.getTime()` (UTC midnight) | ✖ weekly report: NL week boundaries, the Sunday 11:30 PM request and the DST weeks |
| `negative:csvguard` | `src/csv.js`: the formula-guard line removed | ✖ CSV export: header, CRLF, quoting, formula guard and NL-date filename |
| `negative:csvleak` | `src/csv.js`: a `Phone` header and `r.reporter_phone` cell; `src/index.js`: the row carries `reporter_phone` | ✖ CSV export never contains the reporter's name, phone, description or note text |
| `negative:mergedreport` | `src/index.js`: `const counted = results.filter(r => r.status !== 'merged')` → `const counted = results` | ✖ weekly report on a fake clock |
| `negative:pinguard` | `src/index.js`: `await attemptStmt(ctx, 'pin').run()` removed | ✖ rate guard: 5 wrong PINs per IP per 15 minutes |

### Calls I made where the contract is silent (lead: please confirm or correct)
1. **Messages API.md doesn't give:**
   - unknown-status-key 429: "Too many report links that don't work. Wait 10 minutes and try again.";
   - bad `week`: 400 field `week` "Pick a week.";
   - crew `active` not a boolean: 400 field `active` "Say whether the crew is working.";
   - seed with another scenario: 400 field `scenario` "Use the scenario "demo".";
   - unknown crew: 404 "We can't find that crew.".
2. **Crew PUT** needs both `name` and `active`, and checks fields before the id (400 before 404, like notes in clarification 12).
3. **A wrong `current_pin` on PIN change** is not counted toward the sign-in guard: that route needs a signed-in session already.
4. **Rate guards:**
   - they run after validation and after the duplicate lookup, so a malformed report never uses up the allowance and a resend is
     never refused;
   - `week=` empty means the current week, like the list filters (clarification 4).
5. **CSV columns:**
   - `Status` is the status label ("Won't fix") and `Due` is a date-time like the other dates;
   - `Days to close` is the number (`3.2`), empty while open; `Plus ones` is the number.
6. **The seed** is deterministic in its pins and texts; its keys, tokens and device ids are random. Its first request is HP-1001.

### Gaps and notes
- `PUT /api/staff/pin` answers a wrong `current_pin` with 401 `unauthorized` (as API.md says). **For ts2:** the staff client must
  not treat that 401 as "signed out"; `field: "current_pin"` tells them apart from "Sign in again." (which has no field).
- Clarification 13's give-up path (409 after the retries) is code only: no test can force three lost races through the API. It
  sits behind the same in-batch guard noted as unproven in M1.
- No screenshot: M2b has no screen. The seed test is the proof that the demo data exists and its photos load.

## M2c (2026-09-14)

Rebased on main at `b85b4da` (clarifications 15–20). Work in `980cb78`. The two refusal paths I called unproven in M1 and M2b
have now been seen to fire, in copies only, with no switch in shipped code.

### `negative:batchguard`: DONE, and it found a real gap first
New API test: `PUT: two saves with the same version: one wins, the other is 409 stale and writes nothing`. The second save, with
the old version, must get 409 `stale`, and the version, status, public message, `closed_at`, history and status page must all be
unchanged. `negative-lib.mjs` gained a `setup` step that patches the copy for both phases.
- **First run (logged at `b85b4da +uncommitted`): phase A did NOT pass.**
  - With the early `if (body.version !== row.version) throw await stale()` removed, the stale second save got **200** and wrote
    "Marked done" and its message.
  - Cause: the PUT's `UPDATE … WHERE version = ?` was bound to `row.version`, the version this request had just read, not
    `body.version`, the client's. So the in-batch guard only covered the milliseconds between one request's read and its write;
    a client's stale version was caught by the early check alone.
  - The M1 race probe (one 200, one 409) could not tell which layer answered. Now we know the guard never did it on its own.
- **Fix:** the UPDATE binds `body.version`. Behind the early check the two are always equal, so shipped behaviour is identical
  (`npm test` unchanged, now 50 API). The guard now defends the client's version even if the early check is ever lost.
- **Phase A (setup: early check removed): PASS.** The in-batch guard alone answers 409 `stale`, and the batch rolls back, so there
  is no history, no version bump and no status change.
- **Phase B (break: `guardOneChange` → `SELECT 1`): RED.** The loser gets 200. Its UPDATE matched nothing (version still 2,
  status still assigned), but its "Marked done" and "Public message: Second save (SAMPLE)." history rows were written onto the
  report. That is exactly the damage the guard exists to stop.

### `negative:mergegiveup`: DONE
Test file `tests/merge-giveup.test.mjs`, which `npm test` does not run: it only passes on a copy whose merge always loses.
- **Phase A (setup: the merge batch binds `source.version - 1`): PASS.** After its retries, the merge answers exactly
  `{ "error": "Someone else changed one of these reports. Reload and try again.", "code": "bad_state" }` (409). Both reports'
  staff details are deep-equal to before: status, `merged_into`, `plus_ones`, `merged_count`, versions and history. The source's
  status page still has `merged_into: null`.
- **Phase B (break: the final `throw badState(…)` → `throw e`): RED.** The merge answers 500 `server_error`.

### Verified
`npm test` at `980cb78`: **unit 21 pass, API 50 pass, 0 fail.** `npm run negative` at `980cb78`: **all 13 controls RED as
required, exit 0** (the eleven earlier ones plus batchguard and mergegiveup), run on 8502 and 8505 only.
`tests/negative-control.log` keeps batchguard's first NOT RED run beside the passing ones as the record of the gap it found.

### Still not proven
Nothing I know of. The me-too and photo batches chain on `changes() = 1` rather than a refusing guard. Their duplicate paths are
covered by API tests: a same-device tap, a second photo PUT, and M1's three simultaneous same-device taps.

## Cross-review of ts2 M2
Read-only, from `rig/ts2` at `ea82e84`, against docs/API.md with clarifications 1–20: `app/public/staff/staff.js`, `app/public/api.js`,
the M2 diff of `app/public/report.js` (`1757f0c..ea82e84`), `app/tests/helpers.mjs`, and the specs' arrangements. No server started,
nothing in `app/**` edited. Severity is mine.

### Findings
1. **Medium: saving after adding a note can silently undo someone else's change.** `staff.js:332` sets `state.detail` to the note
   answer, which carries the report's *current* version and fields. `staff.js:334-336` then refreshes only the history and the copy
   text; the status, crew and message inputs keep what was rendered earlier. `save()` (`staff.js:298-304`) builds the body from that
   newer `state.detail`: `version` is the new one, and every input that differs from the *new* values counts as a change.
   - **How it happens:**
     1. Staff A opens HP-1001 (v1, New, no crew).
     2. Staff B assigns crew 1 (v2).
     3. A adds a note: `state.detail` becomes v2, but A's form still shows New and No crew.
     4. A types a public message and presses Save.
     5. The body is `{ version: 2, status: "new", crew_id: null, public_message: "…" }`. The Worker accepts it (200), and B's
        assignment is undone with no "Someone else changed this report" warning.
   - **Nothing in the Worker can catch it:** the client sends the version it has just been given.
   - **Suggested fix:** keep the version the form was rendered with (the panel already has `data-version`, `staff.js:238`), or
     re-render the form (or show the stale box) when the note answer's version differs from it.
   - **Suggested spec:** open a card, change the report through the API, add a note in the UI, save → expect 409 and the stale box.
2. **Low:** a Save, Add note or Join that meets an ended session throws a TypeError after the sign-in screen is already showing.
   - **Why:** `api.js:69-72` fires `SIGNED_OUT` synchronously before throwing. `showSignin` then `closeDetail()` empties the panel,
     so the catch blocks write to elements that no longer exist: `$('save-error')` (`staff.js:319`, a 401 has no `field`),
     `$('err-text')` (`staff.js:338`) and `$('join-confirm-error')` (`staff.js:429`) are null.
   - **What people see:** the right screen. Only the console shows an uncaught rejection.
3. **Low:** Reload after a stale 409 (`staff.js:445`) shows the report from the 409 body but doesn't call `loadBoard()`. That
   report's card stays in its old column, with its old overdue text, until the next board load. A successful save does reload
   (`staff.js:311`).
4. **Low, observation:** `due_at` and `due_label` are read nowhere, neither on the cards (`staff.js:143-153`) nor in the detail
   (`staff.js:245-248`). PLAN.md doesn't ask for a due date, but staff can't see when a report falls due until it is already
   overdue. Worth deciding for M3.
5. **Low:** the typed-reference join can show its confirm for a report that is itself joined (`staff.js:404-414`). The merge then
   answers 409 with "HP-x was itself joined with HP-y. Join with HP-y instead.", shown in `#join-confirm-error` (`staff.js:429`),
   so the outcome is correct. The detail answer already has `status: "merged"` and `merged_into`, so the confirm could say it first.
6. **Low:** crews load once per board visit (`staff.js:125`). A crew deactivated from another session still shows in the select;
   picking it gets 400 "Pick one of the crews.", shown next to the crew (`staff.js:316-317`). Handled; for M3's Settings screen,
   reload crews after changes.

### Checks that are clean (none)
- **Method, path, body, headers, query** (`api.js:96-107`):
  - signin `POST {pin}` without a token; signout `POST`;
  - requests `GET` with only the set filters (`api.js:80-85`: `''`, `null` and `false` dropped; `overdue` `'1'`; `min_age_days`
    `3`/`7`/`30`, `staff.js:10`);
  - detail `GET`; save `PUT {version, …changed}`; notes `POST {text}`; candidates `GET`; merge `POST {into_id: Number}`;
  - crews and settings `GET`;
  - every staff route sends `Authorization: Bearer`, ids are encoded, and there are no `X-Test-*` headers in app code.
- **Response fields read** all exist with those names and types:
  - board: `counts`, `id`, `ref`, `status`, `age_days`, `category`, `category_label`, `location_label`, `plus_ones`, `crew_name`,
    `has_photo`, `overdue`, `overdue_days` (`staff.js:143-166`);
  - detail: `version`, `status_label`, `ward_name`, `created_label`, `closed_label`, `merged_into.{id,ref}`,
    `merged[].{ref,created_label,plus_ones,description,reporter_name,reporter_phone,photo_url}`, `photo`, `photo_url`,
    `public_message`, `copy_update`, `status_url`, `history[].{at_label,text,internal}`, `lat`, `lng`, `crew_id`
    (`staff.js:198-289`);
  - candidates: `requests[].{id,ref,category_label,location_label,distance_m,status_label,plus_ones}` (`staff.js:356`);
  - crews: `crews[].{id,name,active}` (`staff.js:202-203`); merge: `request` (`staff.js:424`).
- **401 handling** (`api.js:65-73`): only a 401 without `field` clears the token and signs out. Sign-in uses `call()`
  (`api.js:97`), so a wrong PIN (401, field `pin`) and a 429 stay on the sign-in form with the API's text (`staff.js:78-81`). A
  future `current_pin` 401 (field `current_pin`) won't sign anyone out, as long as M3's PIN change goes through `staff()`.
- **Stale 409** (`staff.js:313-315`, `445`): recognised by `code === 'stale'` and `body.request`; Reload renders that StaffRequest,
  version included. Only finding 1 gets around it.
- **Save sends only changed fields, against clarifications 10 and 12** (`staff.js:297-304`):
  - the crew is sent only when it changes, so "a crew auto-assigns only when it changes" (10) holds, and a deactivated current crew
    (shown "(not active)", `staff.js:203`) is never re-sent;
  - the message is compared trimmed, so whitespace-only edits aren't sent, and an untrimmed change is trimmed by the Worker;
  - field errors land on the three inputs (`staff.js:316-317`) in the Worker's order (12): "Pick a crew first." next to the crew,
    "Say why…" next to the message (a `wont_fix` with an existing message is accepted because the Worker checks the resulting
    message);
  - the only bad interaction is finding 1.
- **Merge and join by typed reference** (`staff.js:383-432`): the candidate list comes from `candidates`. A typed `HP-1003`,
  `hp-1003` or `1003` loads `GET /api/staff/requests/1003` before the confirm (clarification 14); its 404 text shows. Joining
  with itself is stopped with the API's wording; the clarification 13 409 and the "itself joined" 409 show in the confirm.
- **Board** shows the API's own `counts` (`staff.js:159`, `164`), which match the cards because no status filter is sent, and
  `overdue` / `overdue_days` as given, never worked out on the phone (`staff.js:146`, `151`, `247`).
- **report.js M2** (`1757f0c..ea82e84`): all four M1 findings are fixed.
  - "Near …" now comes from `GET /api/town/locate`, debounced 300 ms; only the latest pin's answer shows, and a failure hides the
    hint (`report.js:118-137`, `162`).
  - The description counter counts code points like the Worker (`report.js:22`, `370`).
  - "Me too" is removed after a 409/404 (`report.js:281`).
  - 413/415 offer "Take a different one", which re-sends the same `submission_id` and gets a fresh token (`report.js:452-462`,
    `354`). This fits the M2b rule that a resend is never refused by the create guard.
- **Rate guards against the specs: nothing trips.** The auto `seed` fixture resets before every test (`helpers.mjs:60-64`), which
  clears the attempts table, so only counts within one test matter.
  - **Busiest test:** `shots.spec.mjs:55` makes 9 reports, but each is dated to a different past day with `at:`
    (`shots.spec.mjs:58-80`). No hour holds more than 2 (both `days(2)`, `:72` and `:80`), and a dated attempt never counts
    against a real-time one.
  - **Next highest:** `targets.spec.mjs:96` makes 6 at real time and `staff.spec.mjs:22` makes 5.
  - **Other guards:** "Me too" at most 4 (`shots.spec.mjs:17-18,66-67`), wrong PINs 1 (`staff.spec.mjs:11`), unknown status links
    1 (`status.spec.mjs:36`). Status-page re-checks use good keys, which aren't counted.
  - **Watch for later:** a test that makes 11 or more reports at real time, or 6 wrong PINs, will now get 429. Spread them with
    `at:` or give `makeRequest` an `X-Test-IP`.
