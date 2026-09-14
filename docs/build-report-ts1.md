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
