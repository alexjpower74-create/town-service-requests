# Build report — ts2 (resident report, status page, staff app, Playwright)

## M1 — 2026-09-14

### What I built (DONE)
- `app/public/theme.css`, `style.css`: the Design tokens exactly (ground, surface, line, ink, muted, harbour blue, emergency
  banner, status chips, overdue, SAMPLE badge, radius 12 px), system fonts only, quiet under `prefers-reduced-motion`.
- `app/public/map.js`: the one map module. Leaflet + `L.maplibreGL({ style: town.map_style_url, attributionControl: {
  customAttribution } })` with OpenFreeMap's quick-start attribution markup; `placeLabelLayerIds(style)` (pure) hides the place
  labels once the style loads; no WebGL → plain background with the attribution still shown (`data-base-map="unavailable"`).
  The boundary is a harbour-blue line with the outside dimmed; neither layer takes taps.
- `app/public/api.js`: the only door to the Worker, same-origin `fetch('/api/…')`; errors carry the API's `error` text and
  `field` as is. `?mock=1` swaps in `api.mock.js` (same shapes and texts as API.md for town, create, photo, nearby, me-too,
  status; in memory, mirrored to sessionStorage so the status page in the same tab sees a new report).
- `app/public/geo.js`: haversine, ray casting (lng x, lat y — the Worker's rule), street labels.
- Resident page `/` (`index.html` + `report.js`), every step in the Design: emergency banner first with a `tel:` link; seven
  category buttons with inline SVG line icons (no emoji), two columns; "Your reports on this phone" from localStorage.
  Step 2 of 4 **Where**: map at 58 % of the viewport at 390, tap to pin, draggable pin, **Use my location**, **Search a street**
  (type-ahead over the town's streets), "Near <street>", the outside message and **Next disabled** outside the line, checked on the
  phone before any API call. **Already reported nearby** (only when the API returns any): cards with chip, street, "Reported …",
  "about N m from your pin", "+N others", **Me too** → "Thanks. We added you to HP-…"; a card this phone already joined shows
  "already added" instead of the button; **No, mine is different**. Step 3 **Photo**: file chooser, shrunk on a canvas to at most
  1600 px JPEG 0.7, preview, "Take a different one", "Skip the photo". Step 4 **Details**: "What's wrong?" with a 500 counter
  (needed for Something else), name and phone under "So we can call you back (optional)", **Send report**, API errors next to
  their field. **Report sent**: big ref, the link with **Copy link** and **Open the status page**, the "nothing is texted or
  emailed" note. The report is created first; the photo goes up after with its token. A failed upload shows "Your report was sent,
  but the photo didn't go through." with **Try the photo again**, which re-sends the same `submission_id` (fresh token) and uploads.
  `submission_id` is made once per report; `device_id` once per phone. In-page **Back** on every step.
- Status page `/s/?k=` (`s/index.html` + `s/status.js`): one card — town + SAMPLE, "Report HP-…", category · street, big chip and
  sentence, public message in a quoted box, "+N others reported this", dates, public history, office phone as `tel:`. Merged:
  "This report was joined with HP-…" + link. Bad key: the API's 404 text. `<meta name="referrer" content="no-referrer">`. No map, no
  photo.
- `app/playwright.config.mjs` (four projects as specified, `workers: 1`, webServer = `node tests/start-worker.mjs`, baseURL 8503),
  `app/tests/start-worker.mjs` (wipes `.state-<port>`, migrations `--local --persist-to`, `wrangler dev` with inspector +10 and
  `--var TEST_MODE:1`, `E2E_WORKER_DIR`), `app/tests/helpers.mjs` (reset fixture, network guard with the one-background style
  fixture, `tap()` / `tapAt()` hit-tested with elementFromPoint, `typeText()` with the insertText fallback and a value assertion,
  `choosePhoto()` with a generated 2400×1800 PNG, `readPin()`, `makeRequest()` with `X-Test-Now`, contrast).
- Dev tools: `app/serve.mjs` (static on 8501, `/api/*` proxied to 8502), `app/tools/build-mock-town.mjs` → `app/public/mock-town.js`
  (the mock's copy of `data/town.json`, generated, not hand-edited), `app/tests/png.mjs`, `app/tests/shots-m1.mjs` (M1 smoke +
  screenshots against the mock).
- Screenshots: `app/tests/shots/<screen>-<390|1280>.png` for home, home with reports, where, where outside, nearby, nearby already
  added, Me too, photo, details, sent, sent with the photo failed, and the status page (new, assigned with message, done, joined,
  not found). 32 files.

### What I verified, and how each could have failed
- `node --test app/tests/unit/map-labels.test.mjs` → **4 pass, 0 fail**, against the saved positron style. It checks that every
  `place` layer and every `label_*` id is hidden (label_town, label_village, label_city, label_other, label_state, label_city_capital,
  label_country_1/2/3) and that highway-name-*, water_name_* and waterway_line_label are kept. The checker is shown to fail in the
  same run: hiding only `label_town`, hiding every symbol layer, and hiding only the three named layers are each caught.
- `node app/tests/shots-m1.mjs` (mock, chromium and WebKit, 390 and 1280) → **522 passed, 0 failed**. Real input throughout: taps
  hit-tested first, map taps at a point hit-tested to the map, keyboard typing with the value asserted, the real file chooser,
  geolocation from the context. Every scenario also fails if the page throws or any request leaves 127.0.0.1. Checks include:
  emergency text and `tel:`, banner first, banner colours, seven categories ≥ 64 px that hit-test to themselves with an SVG and no
  emoji, two columns, ≤ 560 px column at 1280, map ≥ 55 % at 390, the three attribution links; outside location → message + Next
  disabled; inside location and a map tap move the pin; search → pin on the street + "Near Main Street"; nearby card HP-1001
  "about 30 m" "+2 others"; photo shrunk to exactly 1600×1200 `image/jpeg`; primary buttons ≥ 56 px; sent HP-1004 with the photo
  stored as JPEG and exactly one new request; the status page shows ref, Pothole and street and **none** of the phone (both forms),
  name or description, no img or map, no-referrer; Me too +1 with no new request and "already added" on a second run; photo fails
  once → the report exists with photo `waiting` → **Try the photo again** stores it on the same report (still one new request);
  Something else without text and a bad phone show the API's messages next to their fields; Back walks every step; status
  assigned/merged/done/not-found content and privacy.
- A real bug these checks caught and I fixed: in WebKit the emergency link was `inline-flex`, which dropped the space before the
  number when the line wrapped ("at709-555-0142"). Now inline with block padding.
- A screenshot artifact I found and did not ship: `fullPage` captures resize the viewport faster than the map's GL canvas follows,
  leaving an empty strip in the picture. I measured the live page (canvas 631×526 over the 528×440 box, covering it) to prove the
  page was fine, then took the map screens as viewport captures instead.
- **Negative control (M1, phone-side boundary):** a copy of `app/public` in `app/.negative/boundary-m1/` on port 8506. The unbroken
  copy passed the `report` scenario (96 passed, 0 failed). The break, in the copy's `report.js`:
  `state.inside = insideRing([lat, lng], state.town.boundary)` → `state.inside = true` (the script confirmed the line changed). Red: the
  outside-location step timed out waiting for "That spot is outside the town…" (13 passed, 2 failed, exit 1). Recorded in
  `app/tests/negative-control.log`.
- `rig guard --agent ts2`: all files inside the slice.

### Not verified / left undone
- **The Playwright suite has not run against the real Worker**: there is no `worker/` on this branch yet (ts1 M1 is not merged).
  `npx playwright test --list` loads the config ("No tests found": the specs are M2). `start-worker.mjs` and `helpers.mjs` are
  untested until M2; they follow Snow Route's working versions with this project's names and ports.
- The M1 screenshots use the mock and a local stand-in base map drawn from `data/town.json` street lines (no internet in tests), so
  there are no street names or water on the map in them. Real OpenFreeMap tiles appear only when a person opens the page online.
- No M2 or M3 work (staff app, specs, M2 negative controls), per the milestone rule.
- I created the `app/node_modules` symlink to main's copy (it was missing; it is git-ignored).

### For the lead
1. **"Near <street>" under the map is approximate.** `GET /api/town` sends one point per street and no lines, so the phone can only
   name the street whose single point is nearest (within 250 m). The label that is stored and shown on the status link is the
   Worker's segment-based one, and they can differ on a long street. A street picked from search always shows its own name. If you
   want the phone to match the Worker, API.md would need street lines in `/api/town` (about 930 points). Your call; I did not
   invent a different contract.
2. I also hide the airport name layer (`aerodrome_label`) with the place labels, because airport names carry the real town's name.
   Street and water names stay. Say if you want it shown.
3. The report file is `docs/build-report-ts2.md`, outside `app/**`, as the brief asks. If `rig guard` refuses it at commit, it can
   move.

Lead's answers (2026-09-14): (1) the hint moves to the new `GET /api/town/locate` (API.md clarification 9); the phone keeps its
ray casting as the gate for Next and drops its own nearest-point guess (M2). (2) hiding `aerodrome_label` stays (DECISIONS 16).

## M2a — 2026-09-14

`git rebase main` onto `13d8a77` (ts1 M1 Worker and my M1 merged, API.md clarifications 1–9): clean, no conflicts.

## Cross-review of ts1 M1

Read-only, from the app's side: `worker/src/index.js` and the helpers it imports (`auth`, `clock`, `copy`, `geo`, `history`,
`lists`, `sla`, `time`, `sample`, `town-data`), `worker/migrations/0001_init.sql`, `0002_sample.sql` and `wrangler.toml`, against
docs/API.md with clarifications 1–9. Every finding below comes from reading the code. Nothing was executed except the harness boot
in the next section, so each finding names the case that would show it. I edited nothing in `worker/**`.

### Findings (none block M2)
1. **A PUT that repeats a `new` request's current crew moves it to Assigned.** `worker/src/index.js:552`:
   `else if (has(body, 'crew_id') && crewId !== null && row.status === 'new') status = 'assigned'` checks that `crew_id` is in the
   body, not that it changed. A request reopened to `new` that keeps its crew, then saved with `{ version, crew_id: <same crew> }`,
   becomes `assigned` with a "Assigned" history entry and a version bump. API.md says "Setting a crew on a `new` request…" and
   clarification 6 says the same crew is "no change". Condition should be `crewId !== row.crew_id`. No test in
   `worker/tests/api.test.mjs` covers a same-crew PUT on a `new` request. **App impact:** none if the staff Save always sends
   `status` (which M2 will). It would bite a client that sends only the changed fields.
2. **A malformed `%` escape in a status link answers 500, not the 404 message.** `worker/src/index.js:699` runs
   `decodeURIComponent(m[1])` outside any guard. `GET /api/status/%E0%A4%A` throws `URIError` and falls through to
   `index.js:711-712` (500 `server_error` "Something went wrong. Try again."). Same for `/api/photos/…`. **App impact:** a resident
   with a truncated or hand-edited link sees "Something went wrong" instead of "We can't find that report. Check the link, or call
   the town office." The status page shows whatever `error` text comes back, so it needs no change once the Worker answers 404.
3. **Validation order in staff PUT differs from API.md's list.** API.md lists: status → crew_id → crew needed → wont_fix needs a
   message → message ≤ 500. `worker/src/index.js:544-554` checks the message length (547) before "Pick a crew first." (553) and
   "Say why…" (554). Only a PUT that fails two rules at once shows it (e.g. `status: 'assigned'`, no crew, a 501-character message →
   field `public_message`, where the list order gives `crew_id`). Each rule alone is tested (`api.test.mjs:659-665`). **App
   impact:** negligible (one inline message at a time either way). Worth one line in a clarification, or a reorder.
4. **Notes: the text is checked before the id.** `worker/src/index.js:583-584`: an empty note to an unknown id answers 400 field
   `text`, not 404. Order isn't in the contract. **App impact:** none.
5. **Merge gives up with a bare 500 after three races.** `worker/src/index.js:630-631`: after two retries on a guard refusal it
   rethrows, so two staff merging the same pair at once could see "Something went wrong. Try again." rather than a 409. Very
   unlikely at a town office. **App impact:** the detail shows the error text inline; Reload recovers.
6. **`GET /api/town/locate` is not in `index.js` yet** (clarification 9). Expected: you said ts1 is adding it before M2.
7. **Rate guards are not implemented** (the `attempts` table in `0001_init.sql:44-51` is unused; no 429 anywhere). Expected: they
   are ts1 M2. **App impact:** M2's resident and staff specs don't need them; the sign-in page will show the 429 text as is
   when they land.

### Checked and clean ("none")
- **`GET /api/town`** (`index.js:190-208`): every field and name as API.md; `sample` from the settings name; `map_style_url` from
  `MAP_STYLE_URL` else positron; wards without polygons; streets without lines. Streets are sorted by name because
  `worker/tools/build-town-data.mjs:21` sorts them when generating `town-data.js` (checked: 67 streets, in name order). None.
- **`POST /api/requests`** (`index.js:219-319`): the table's order and messages, `field` values (`submission_id`, `device_id`,
  `category`, `location`, `description`, `name`, `phone`, `has_photo`), `outside_boundary` with field `location`, empty text → null,
  201 vs 200 `duplicate: true`, fresh upload token only while `waiting`, upload fields null otherwise, the reporter's device
  recorded. `reported_label` is a full label. None.
- **`PUT /api/requests/:id/photo`** (`index.js:321-356`): 404 → 401 → 413 → 415 (clarification 5); 200 `{ photo: 'stored' }` then
  `duplicate: true`; the first photo kept. My M1 retry path (re-POST the same `submission_id`, then PUT with the fresh token) works
  with this. None.
- **`GET /api/requests/nearby`** (`index.js:358-388`): fields `category`/`location`, `outside_boundary`, open only (never merged),
  same category, ≤ 50 m unrounded, closest then id, at most 10, `reported_label` a date label (clarification 8), no private fields.
  None.
- **`POST /api/requests/:id/me-too`** (`index.js:390-407`): device check, 409 `bad_state` "This report is already closed." for
  closed and merged, 201/200 `duplicate`, reporter's own device a duplicate. None.
- **`GET /api/status/:key`** (`index.js:409-440`): the exact public shape; history from `public_text` of non-internal entries only;
  `updated_at` the latest public entry; `merged_into { ref, status_url }` built from the target's key; no name, phone, description,
  notes, crew, photo, lat/lng or ids. 404 text exact. None (apart from finding 2).
- **Headers** (`index.js:35-39`, `446-449`): every API answer `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `nosniff`;
  photos `private, max-age=86400` with no-referrer. Confirmed live on `/api/town` (next section). None.
- **Staff sign-in / sign-out** (`index.js:454-478`): 401 field `pin` "That PIN is not right."; missing or expired token → 401
  "Sign in again." with **no** `field`, which is how the app tells a lost session from a form error; token lasts 12 hours. None.
- **`GET /api/staff/requests`** (`index.js:480-512`): filters and field names, clarification 3–4 messages, empty = absent,
  `counts` for the five board statuses with every filter except `status`, merged left out unless `status=merged`, oldest first,
  `now`/`now_label`. None.
- **StaffRequestSummary and StaffRequest** (`index.js:102-182`): every field in API.md, including `lat`/`lng` for the detail's small
  map, `ward_name`, `crew_name`, `has_photo` (stored only), `has_contact`, `merged_count`, `merged_into_ref`, `due_label` (date),
  `overdue_days`, `version`; detail adds `photo_url` (only when stored), `status_url`, `merged_into { id, ref }`, `merged[]`,
  `history[]` with `kind`, staff `text`, `internal`, and `copy_update` (`copy.js` matches the sentences). None.
- **`PUT /api/staff/requests/:id`** (`index.js:518-578`): clarification 2's order up to the field checks; 409 `stale` carries the
  full current StaffRequest in `request` (the app's Reload path needs exactly that); merged → 409 `bad_state`; no change → 200 same
  version; crew entry before status entry; `closed_at` set, kept and cleared. None (apart from findings 1 and 3).
- **Notes, candidates, merge** (`index.js:580-635`): 201 StaffRequest for notes (no version bump); candidates same category,
  open, ≤ 200 m, with `distance_m`; merge answers `{ request, merged }`, `plus_ones += source + 1`, earlier merges re-pointed, errors
  and fields as API.md. None (apart from findings 4 and 5).
- **Crews, settings** (`index.js:637-652`): crews `{ id, name, active (boolean), open_count }`; settings with `sla_days` for every
  key, null for no target. None.
- **History texts** (`history.js`): every row of the table, public vs staff vs internal. None.
- **Labels** (`time.js`): assembled from `formatToParts` per clarification 1. My M1 mock used `Intl.format(...).replace(',', '')`,
  which on newer ICU gives a narrow no-break space before AM. It only runs in `?mock=1`, and M2's specs never read mock labels.
  None for ts1.
- **Migrations and `wrangler.toml`:** ids from 1001, `submission_id UNIQUE`, `status_key UNIQUE`, one photo per request, history
  keeps both texts; no `[vars]`, no `TEST_MODE`; `[assets] ../app/public` with `run_worker_first = ["/api/*"]`. None.

### What the staff app will need that is missing or awkward
- **"Type a reference" for Join:** there is no lookup by ref. The app can parse `HP-1003` → id 1003 and `GET` the detail before the
  confirm (404 → "We can't find that report."). Workable, no change asked.
- Nothing else. Everything on the board, detail, Save, stale, notes, copy update, status link, photo, merged list and join is in
  the M1 routes above.

## Harness boot against the real Worker (M2a step 3)
- `npx playwright test --list` (from `app/`): loads `playwright.config.mjs`, "Total: 0 tests in 0 files", exit 1 ("No tests found":
  the specs are M2).
- `E2E_PORT=8503 node tests/start-worker.mjs` (started once, pid 4186315): wiped and migrated `app/tests/.state-8503`, then
  `wrangler dev --local` on 8503 with inspector 8513 and `TEST_MODE:1`. `/api/town` answered after about 4 s:
  `HTTP/1.1 200 OK`, `Content-Type: application/json; charset=utf-8`, `Cache-Control: no-store`, `referrer-policy: no-referrer`,
  `x-content-type-options: nosniff`, body starting `{"name":"SAMPLE Town of Harbour Pond (demo)","sample":true,…`.
  `POST /api/test/reset` answered `{"pin":"3690","crews":[…3 SAMPLE crews…]}`, so `TEST_MODE` reached the Worker. The same Worker
  served the app: `GET /` 200 `text/html`, `GET /s/` 200.
- Stopped with `SIGTERM` to that pid only (start-worker forwards it to wrangler): the process exited and ports 8503 and 8513 were
  closed afterwards.

## M2 — 2026-09-14

`git rebase main` onto `0fa23c2` (ts1 M2a with `GET /api/town/locate`, my M2a): clean. **Note for the lead:** the prompt says
clarifications 10–14 are in docs/API.md, but on main the Clarifications list still ends at 9. I followed the prompt as written: the
same-crew and error-order fixes are ts1's, and join by typed reference is approved.

### ts1's cross-review of my M1, fixed (DONE)
- (a) "Near <street>" now comes from `GET /api/town/locate`, debounced 300 ms; only the answer for the latest pin is shown, and a
  failed call leaves the hint out (`report.js` `locateSoon`/`cancelLocate`). The phone's nearest-point guess is removed from
  `report.js` and `geo.js`. The phone's ray casting is still the only gate for **Next**.
- (b) The description counter counts code points (`[...s].length`); so does the mock for description and name.
- (c) Me too answered 409 or 404: the message shows and that card's button is removed, not re-enabled.
- (d) A photo refused with 413 or 415 shows the API's text and **Take a different one**, which opens the file chooser and sends the new
  photo to the same report. Other failures keep **Try the photo again**.
- (e) Mock, cheap ones done: it validates the whole body before the duplicate lookup, accepts `device_id: null`, refuses a
  non-string description, name or phone, checks 413 before 415, builds labels from `formatToParts`, and answers `/api/town/locate`.
  Still no upload-token expiry and no staff routes. No spec uses the mock.

### What I built (DONE)
- **Town office `/staff/`** (`staff/index.html`, `staff.js`, `staff.css`), on the M1 routes:
  - **Sign-in:** shows the API's text as is (401 "That PIN is not right.", and a 429's text once rate guards land). A 401 without a
    `field` on any staff call clears the token and returns to sign-in with "Sign in again."
  - **Top bar:** only Board and Sign out; Map, Weekly report and Settings are M3.
  - **Board:** five columns with counts at 1280; at 390, a column switcher and one column. Filters for category, ward, age (Any age /
    Older than 3, 7, 30 days) and Overdue only. Cards show ref, category icon and label, street, age ("Today" / "4 days"), +N, crew,
    Photo, and the red edge with "Overdue by N days".
  - **Detail** (side panel at 1280, full screen at 390): chip, category, street and ward, dates, +N, photo, description, name and a
    `tel:` phone, a small map with the pin.
  - **Save:** status, crew and public message. Only the fields that changed are sent, so setting a crew on a New report moves it to
    Assigned as API.md says, and repeating a crew is never sent (this also avoids the same-crew bug I reported). Errors show next to
    `status`, `crew_id` or `public_message`. On 409 `stale`, the API's message shows with **Reload**, which loads the `request` the
    409 carried. A merged report shows "This report was joined with HP-…" and no form.
  - **Copying and notes:** Copy update text, the status link with Copy and Open, notes with the yellow "Only town staff see notes"
    label (adding one keeps unsaved form edits), history with "Staff only" on internal entries, and the reports joined into this one.
  - **Join with another report:** likely duplicates from `candidates`, or type a reference (`HP-1003`, `hp1003` or `1003`; the same
    report → "Pick a different report to join it with."; unknown → the API's 404 text), then an inline confirm "Join HP-x into HP-y
    (…)? HP-x closes, and its +1s move to HP-y." → **Join them** opens the kept report.
- **`api.js`:** `locate` and the staff routes with the token in localStorage (`tsr:staff-token`).
- **`map.js`:** writes `data-zoom` / `data-center-lat` / `data-center-lng` on the map element, so a test can tap a known point.
  Nothing reads them back.
- **Specs:** `report`, `boundary`, `nearby`, `status`, `staff`, `merge`, `targets`, plus `shots` (tag `@shots`, chromium only).
  Helpers gained `tapLatLng` (projects a lat/lng to the screen from the map's attributes with Web Mercator, then hit-tests),
  `zoomOutTo`, `recordBodies` (every response body the page receives), the staff sign-in, column and card helpers, API arrangers,
  and a screenshot base map drawn from `data/town.json` street lines.
- **Negative controls:** `negative-lib.mjs` and the five controls in `app/tests/`, with `npm run negative` and one script each.
- **`app/package.json` scripts:** `test`, `test:unit`, `shots`, `shots:m1`, `dev`, `negative`, `negative:<name>`.
- **Old screenshots:** the 32 M1 mock screenshots are removed from `app/tests/shots/` (still in git history); every picture there is now
  from the real Worker.

### Verified, and how each could have failed
- **Final full run on the committed code:** chromium-390 and chromium-1280 on 8503 (including `@shots`) **44 passed, 0 failed, 0
  skipped** (1.1 min); webkit-390 and webkit-1280 on 8501 **40 passed, 0 failed, 0 skipped** (1.1 min). 84 of 84, 4 projects. Every test
  resets the Worker first and fails if any request leaves 127.0.0.1 (the OpenFreeMap style is a local fixture). Real input only:
  taps hit-tested with `elementFromPoint`, map taps at hit-tested points, the keyboard, the real file chooser, context geolocation,
  and `selectOption` for native selects. Earlier per-project runs were also all green: chromium-1280 19/0, chromium-390 21/0, both
  WebKit projects 40/0.
- **Map-label unit test** after the `map.js` change: 4 pass, 0 fail.
- **What the specs check, briefly:**
  - **report:** HP-1001 with the photo stored as `image/jpeg` in the staff API. The phone, the name, the description and pieces of
    each appear neither in the status page's text nor in **any response body the status page loaded**. The test first proves the
    status JSON was recorded, and that the staff API holds those exact strings, so absence means something.
  - **boundary:** zoom out to 12, tap the screen point of `outside_east_of_boundary` → `data-inside="false"`, the outside message, Next
    disabled, 0 requests in the Worker (merged included); tap `inside_centre` → Next → photo step. Search "Main" → the pin equals Main
    Street's point, and "Near Main Street" equals `/api/town/locate` for that point. Use my location on `on_street` → the pin there and
    "Near Airbase Road"; on `outside_south` → the message and Next disabled.
  - **nearby:** pin read from `data-lat`/`data-lng`, requests arranged 40 m and 60 m north and a streetlight 10 m away → exactly one card,
    the 40 m one, "about 40 m from your pin" → Me too → "Thanks. We added you to HP-…", API `plus_ones` 1, still 3 requests; second run →
    "already added", no Me too button; "No, mine is different" → photo step, still 3 requests.
  - **status:** message and three history entries, no crew name; the joined link opens the kept report; a bad key → the plain 404 text.
  - **staff:** wrong PIN → the text and a 401 via `waitForResponse`; board counts and cards equal the API for five statuses, then again
    after the category filter; crew + message → Saved, the card in Assigned (and not New), API fields, and the status page shows the
    message; an internal note in staff history and absent from the status page's text and every response body; Won't fix without a
    message → a 400 and "Say why in the message to the public." next to the box; stale → a 409, the stale message, Reload shows the
    other change at version 2.
  - **merge:** candidate join → the kept report shows "+4 others reported this", equal to the API's `plus_ones` (2 + 1 + its reporter);
    the duplicate is `merged` and its status page says "joined with HP-1001". Typed-reference join for a report 1.2 km away with no
    candidates, including the same-report error, gives +1 and `merged_into` equal to the kept report.
  - **targets:**
    - Every visible resident button and button-link on each step (home, where, street list, nearby, photo, photo chosen, details,
      sent) is at least 44 px, primaries at least 56 px, categories at least 64 px, and each hit-tests to itself, in chromium and
      WebKit at 390.
    - The SAMPLE badge and town name on `/`, `/s/` and `/staff/`, and no horizontal scroll at 390 on six screens.
    - 4.5 : 1 contrast for all six status chips (real status pages, merged included), the banner text and link, the SAMPLE badge,
      Next and Sign in.
    - The attribution's three links are visible, have the right text and are not covered, at both sizes.
- **Negative controls:** each copied `app/public` and `worker` into `app/.negative/<name>/` and ran on 8506. Every unbroken copy
  passed first; every break went red on the check it targets. From `app/tests/negative-control.log`:
  - (a) **boundary**, `report.js` `state.inside = insideRing([lat, lng], state.town.boundary)` → `state.inside = true`: red at
    `expect(#where-label).toHaveAttribute('data-inside', 'false')` (boundary.spec:19).
  - (b) **statusleak**, the copy's Worker adds `reporter_phone: row.reporter_phone` to the status JSON: red at "the response body of
    http://127.0.0.1:8506/api/status/… never contains "709-555-0199"". The page itself never displays it, so only the response-body
    check could catch this.
  - (c) **overlay**, a transparent `position:absolute; inset:0` div over Send report: red at "tap(Send report) hit-test at 195,783:
    something else is on top".
  - (d) **metoo**, Me too calls `createRequest` instead of `meToo`: red at `#metoo-text` "Thanks. We added you to HP-1001." (it named the
    new report).
  - (e) **attribution**, `map.js` `ATTRIBUTION = ''`: red at "attribution link https://openfreemap.org … element(s) not found".
- **A problem the runs showed, fixed:** the controls and a screenshot run shared Playwright's output folder, and Playwright empties it
  when a run starts. One chromium-390 screenshot run died on missing trace files (not an assertion). `negative-lib.mjs` now gives
  each control its own `--output` inside its copy. That screenshot run passed again on its own, and the final full run is above.
- **A bug in my own helper, fixed:** a photo for a request arranged "5 days ago" was refused 401 because upload tokens expire an hour
  after their (backdated) issue. `putPhoto` now sends the same `X-Test-Now`.
- **I looked at the screenshots.** Resident: home, where (the street-line stand-in, pin on Main Street, "Near Main Street"), nearby
  ("about 25 m", +2 others), photo, details, sent (HP-1002, Photo added), status (+2 others, no private details). Town office at 390
  and 1280: sign-in, board with the red overdue edges, detail with photo, contact, map, history with Staff only entries and the note,
  join confirm, after join. Two layout faults they showed, fixed and re-shot: at 1280 with the panel open, references wrapped
  ("HP-" / "1001") on the squeezed cards (now nowrap, with the age wrapping below); at 390 the detail's category icon sat alone on its
  own line (now inline).
- `rig guard --agent ts2` after the commit (below).

### Not done / left
- Rate guards are not tested (ts1 adds them later). Sign-in shows any error's text as is, but no test sends a 429 yet.
- Staff Map, Weekly report, Settings, crews and the M3 specs and control (f): M3.
- The staff app does not refresh itself; the board reloads after each Save, note or join and when a filter changes.
- Screenshots use the street-line stand-in base map (no internet in tests), so there are no street names or water on the maps.

### For the lead
1. **API.md clarifications 10–14 are not on main** (see the M2 note above).
2. **Photo upload tokens and `X-Test-Now`:** a request created with a past `X-Test-Now` needs its photo uploaded with the same header,
   or the token is already expired. That's correct per API.md; worth one line wherever demo seeding does the same.

## M3 — 2026-09-14

### Step 0: rebase and the whole suite on the finished Worker
- `git rebase main` onto `fb199ec` (ts1 M2c: rate guards, PIN change, crews, settings, weekly report, CSV, demo seed; my M2): clean.
  API.md clarifications 10–20 are there now.
- The whole M2 suite on 8503 against that Worker: **84 passed, 0 failed** (2.3 min), before any M3 change. Nothing broke, so there
  was nothing to commit for step 0. The screenshot test that arranges 11 reports stayed under the 10-per-hour create guard only
  because its reports are backdated and fall outside each other's hour. That is fragile, so M3 makes every arranged report use its own
  `X-Test-IP` (below).

### What I built (DONE)
- **Views:** `#board` (default), `#map`, `#report` and `#settings`, in the top bar with Sign out. The board and the map share one
  set of filters. The detail panel opens over the board, the map and the weekly report's oldest-open list.
- **Map:**
  - Leaflet.markercluster (vendored), grouping pins until zoom 17; `maxZoom` 19 on every map, which markercluster needs.
  - Pins in the status colours with a red ring when overdue, a legend, and "N reports on the map".
  - A cluster click zooms in; a pin click opens that report's detail.
- **Weekly report:**
  - Previous / Next week (Next is disabled on the current week).
  - The table by category plus an "All categories" totals row, with "–" where nothing closed.
  - "Open now" and "Overdue now", and the oldest open reports (each opens its detail).
  - **Download CSV:** a `fetch` with the token, then a blob download named from the answer's `Content-Disposition`.
- **Settings:**
  - Emergency phone, office phone and office hours.
  - SLA days per category: a blank box sends `null` (no target), whole numbers go as numbers, and anything else is sent as typed so
    the Worker names the field.
  - Crews: add, rename, deactivate or reactivate.
  - Change PIN.
  - Errors show next to their field, including `sla_days.<key>`.
- **A wrong current PIN** (401 with field `current_pin`) shows inline and never signs out (clarification 17). Only a 401 without a
  `field` ends the session.
- **Sign-in** shows any error's text as is (401, and the 429 from the rate guard) and empties the PIN box for the next try.
- **Emergency banner:** the resident banner already takes `emergency_phone` from `GET /api/town`. `emergency.spec` proves it end to
  end.
- **Specs, new:** `overdue`, `report-week`, `map`, `settings`, `emergency`. `staff.spec` gained the sign-in rate-guard test, and
  `targets.spec`'s no-scroll test gained the map, report and settings views.
- **Screenshot spec:** `shots.spec` now covers every screen in all four projects.
- **Helpers:**
  - `makeRequest` sends a fresh `X-Test-IP` per arranged report, so arranging data never uses up the create allowance of the IP the
    browser sends from.
  - `staffPut` takes an `at` (`X-Test-Now`).
  - New: `goView`, `replaceText` (select all with the keyboard, then type, value asserted), `shiftDate`, and `mapReady` (style
    loaded, or the no-WebGL background).
- **Negative control (f):** `negative-overdue.mjs`. `npm run negative` now runs all six controls; each also has its own
  `negative:<name>` script.

### Bugs the new tests caught, fixed
1. **The staff top bar showed on the sign-in page to anyone signed out** (live since M2). `#nav` has the `hidden` attribute, but
   `.staff-nav { display: flex }` beat the browser's own `[hidden] { display: none }`. The rate-guard test's
   `expect(#nav).toBeHidden()` went red in both chromium sizes. Fix: `[hidden] { display: none !important }` in `theme.css`, so no
   class can override `hidden` anywhere. The re-taken sign-in screenshots show no nav.
2. **The street hint moved Next under the user's thumb.** "Near <street>" arrives from `locate` about 300 ms after a pin. The empty
   line took no space, so the answer pushed Next down. The screenshot test's `tap(Next)` hit-test landed on the section instead of the
   button. Fix: the line keeps its height while empty (`style.css`).
3. **A test race, not an app bug:** the crew test grabbed Deactivate while Rename was re-drawing the crew list, and got a detached
   element. The crew list now carries a `data-rendered` count, and the test waits for it to change after each crew action.
4. **Looked wrong in the screenshots:** on the 390 Map screen the two-row nav and three full-width filter boxes pushed the map below
   the fold. At phone width the filters now sit two to a row, and the Map screenshot scrolls the map into view.

### Verified, and how each could have failed
- **Final run on the committed code, pass / fail / skip per project:**
  - chromium-390: **32 / 0 / 0**
  - chromium-1280: **30 / 0 / 0**
  - webkit-390: **32 / 0 / 0**
  - webkit-1280: **30 / 0 / 0**

  **124 of 124.** Chromium ran on 8503 (1.5 min), WebKit on 8501 (2.2 min). Every test resets the Worker and fails if a request leaves
  127.0.0.1, with real input only (hit-tested taps, keyboard, file chooser, geolocation, `selectOption`).
- **What the M3 specs check:**
  - **overdue:** a streetlight arranged 11 days + 1 hour ago (API: overdue, `overdue_days` 2, `age_days` 11) and a pothole 3 days ago.
    The streetlight card has `data-overdue="true"`, "Overdue by 2 days" (equal to the API) and a 4 px `rgb(185, 28, 28)` left edge; the
    pothole has none of them. "Overdue only" leaves exactly that card. Settings: streetlight 12 days → Saved, the API holds 12, and back
    on the board the card is not overdue, with no text and no red edge (the API agrees).
  - **report-week:** five reports created, and three closed, at chosen instants in the previous NL week through `X-Test-Now`. The API's
    totals are asserted first (5 opened, 3 closed). On the page:
    - The current week's label shows, and Next is disabled.
    - After Previous week: every row's opened, closed and average, the totals, open now, overdue now and the oldest-open refs equal the
      API's answer for that week.
    - Next week goes back.
    - The downloaded CSV equals `GET /api/staff/export.csv` byte for byte, with the same filename, the exact header and 6 lines, and
      contains neither the phone (both forms) nor the name nor the description.
  - **map:** 20 reports on a 30 m grid → one `.marker-cluster` reading "20" and no pins. Tapping it zooms in, the cluster is gone and
    20 pins show. Tapping HP-1008's pin opens its detail. Pin colours: New `rgb(10, 92, 138)`, Assigned `rgb(91, 33, 182)`, and an
    overdue streetlight has the `rgb(185, 28, 28)` ring. A category filter set on the board shows on the map, with 1 pin and "1 report
    on the map."
  - **settings:**
    - A bad emergency phone → "Type a phone number like 709-555-0100." next to it. SLA 400 → "Use 1 to 365 days, or leave it blank for
      no target." next to that box. A blank box → Saved and `null` in the API.
    - Wrong current PIN → 401 with field `current_pin`, the message inline, still signed in (the nav works and 3690 still signs in).
    - A new crew appears in a report's crew select; a rename and a deactivate reach the API; the deactivated crew is gone from the
      select (4 options).
    - PIN change → sign out → 3690 refused with 401 → 2468 signs in.
  - **emergency:** the banner shows 709-555-0142; Settings → 709-555-0177 → Saved → the banner reads "…Call the town at 709-555-0177 or
    911." with `href="tel:7095550177"`.
  - **staff, rate guard:** five wrong PINs, each a 401 with "That PIN is not right." and an emptied box; then 3690 → 429
    `rate_limited`, the page shows the body's `error` exactly ("Too many tries. Wait 15 minutes and try again."), no board, and the nav
    stays hidden.
- **All six negative controls** (from `app/tests/negative-control.log`, run against the M3 code on 8506, each in its own copy): every
  unbroken copy passed first, every break went red.
  - (a) boundary, (b) statusleak, (c) overlay, (d) metoo, (e) attribution: the same breaks as in M2, red again on the same
    assertions.
  - (f) **overdue**, `staff.js` `function card(r) {` + `r = { ...r, overdue: r.age_days > 10 }`: the unbroken copy passed (1 passed).
    The broken copy went red at `overdue.spec:51` "no longer overdue after the SLA change" (`data-overdue` stayed `true`). Every
    assertion before the SLA change passed, so it went red exactly where it should.
  - The log has no machine paths.
- **Map-label unit test:** still 4 pass, 0 fail.
- **Screenshots:** 84 in `app/tests/shots/`, 21 screens × 4 projects, named `<project>-<area>-<step>-<screen>.png`. Resident: 1 home,
  2 where with search, 3 where, 4 nearby, 5 photo, 6 photo chosen, 7 details, 8 sent, 9 Me too. Status: 1 new, 2 assigned with message,
  3 joined, 4 not found. Staff: 1 sign-in, 2 board, 3 detail, 4 notes and history, 5 join confirm, 6 map, 7 weekly report, 8 settings.
  The 28 M2 screenshots with un-numbered names are removed. I looked at the WebKit 1280 map, weekly report and settings, the WebKit 390
  sign-in, map, board and settings, and the chromium 390 map, weekly report and where. Fault 4 above came from that look; the re-shots
  are right.

### For the lead
1. **"A streetlight created 11 days ago shows Overdue by 1 day" can't hold on the real clock.** With a 10-day SLA,
   `overdue_days = ceil(age − 10 days)`, so any age past exactly 11 days reads 2, and control (f)'s `age_days > 10` needs at least 11
   days. I arranged 11 days + 1 hour and assert that the card shows the API's `overdue_days` (2). That way control (f) goes red at the
   SLA change, as the prompt describes. If you want the literal "1 day", the streetlight has to be 10.x days old, and then (f) goes red
   at the first board check instead.
2. **Rate guards in tests:** arranged reports now each come from their own `X-Test-IP`. The app's own requests still come from `local`,
   so the sign-in guard test measures the real IP path.

### Not done / left
- The board, map and report don't refresh by themselves; they reload after a change in the app and when a filter or view changes.
- The mock (`?mock=1`) still has no staff routes; no spec uses it.

## M3b — 2026-09-14 (fix round)

`git rebase main` onto `8350c8d` (my M3 merged, DECISIONS 18–19): clean.

### ts1's cross-review of my M2, fixed (DONE)
1. **Medium, DECISIONS 19: a Save after Add note could silently undo someone else's change.** When a detail is drawn, `renderDetail`
   now records what the form shows (`state.form`: version, status, crew, message). `save()` compares the inputs with that and sends
   that version, never the newer version a note's answer brings. If anything changed meanwhile, the Worker's stale check fires.
   - **Spec** `staff.spec` "a Save after adding a note never undoes a change made meanwhile":
     1. Open a card.
     2. Assign crew 1 through the API.
     3. Add a note in the UI.
     4. Type a message and Save → **409** and the stale box.
     5. The API still holds `assigned`, crew 1, and no message.
   - **Control (g)** `negative-notestale.mjs`: in the copy, `const f = state.form` becomes a snapshot of `state.detail`, which after
     the note is the note's answer (the old behaviour). The unbroken copy passed. The broken copy went red at `staff.spec:178` "the
     Save meets the stale check": the Save answered 200 and undid the crew.
2. **Save, Add note or Join after the session ended no longer throw once the sign-in screen shows.** Each error path first checks
   its target still exists (`#save-form`, `#err-text`, `#join-confirm-error`, `#join-slot`), and `openDetail` stops if the token is
   gone.
   - **Spec:** open a card, end the page's own session through the API (the token is read from localStorage, never set), type, Save
     → 401, the sign-in screen with "Sign in again.", the panel hidden, and no `pageerror` and no console error other than the
     browser's own "Failed to load resource" line for the 401.
3. **Reload after a stale 409 also reloads the board (or map).** `staff.spec`'s stale test now changes crew and message through the
   API. After Reload and Close, the card is in Assigned and not in New.
4. **DECISIONS 18:** the detail shows "Due {due_label}" for open reports with an SLA (`#d-due`). **Spec:** it equals the API's
   `due_label`, and after marking the report Done it is gone.
5. **A typed reference to a report that was itself joined** now says "HP-x was itself joined with HP-y. Join with HP-y instead."
   right away, with no confirm and no Join button. **Spec** in `merge.spec`: exactly that text, no `#join-confirm`, no `#join-yes`,
   and the report is still `new`.
6. **Crews load fresh each time a report opens** (as well as after every Settings crew change, since M3). **Spec:** sign in,
   deactivate crew 3 through the API as another session would, open a card → crew 3 is not offered (3 options).

### A bug the new spec found, fixed
- **"Join with another report" replaced the reference box while the likely duplicates were loading.** `renderJoin` re-drew the
  whole join area when the candidates answer arrived, so a person who had started typing a reference lost the box (and their focus).
  The new typed-reference test failed on a detached element in chromium-390, chromium-1280 and webkit-390. The M2 test only passed
  because it waited for "No open reports…" first.
- **Fix:** the join area is drawn once; after that only `#join-cands`, `#join-error` and `#join-confirm-slot` change.

### Lead polish: cramped board columns with the panel open at 1280 (DONE)
- **Before**, `app/tests/shots/before-after/<chromium|webkit>-1280-staff-3-detail-before.png`: five columns squeezed into about
  728 px. "In progress" wrapped, and cards read "HP- / 1001", "Missed / snow / clearing".
- **After**, `…-after.png`: at 1101 px and wider, with the panel open, each column keeps at least 210 px and the board scrolls
  sideways inside itself. The page itself doesn't scroll sideways, and 390 is unchanged. "In progress", "Streetlight out" and
  "Overdue by 3 days" each fit on one line; Done and Won't fix scroll into view under the panel.
- **Open point:** nothing on screen says the board scrolls sideways; the right-hand columns are simply cut off at the panel's edge. A
  fade or a "More columns" hint would help, if you want it.

### Verified
- **Final full run on the committed code, all four projects on 8503** (4.3 min), pass / fail / skip per project:
  - chromium-390: **37 / 0 / 0**
  - chromium-1280: **35 / 0 / 0**
  - webkit-390: **37 / 0 / 0**
  - webkit-1280: **35 / 0 / 0**

  **144 of 144.** The first full run found the join-panel bug above (141 passed, 3 failed). Every screenshot was re-shot in that final
  run.
- **All seven app negative controls on 8506**, on the final code. Each unbroken copy passed and each broken copy went red. The log
  entries are at `app/tests/negative-control.log` lines 841–1157: boundary, statusleak, overlay, metoo, attribution, overdue,
  notestale. There are no machine paths in the log. `npm run negative` now runs all seven.
- **I looked at:** the 1280 detail before and after (chromium, and the WebKit after), the 390 detail with "Due Wed Sep 23", and the
  1280 join confirm.

## M3c — 2026-09-14 (last round)

`git rebase main` onto `709b215` (my M3b merged; DECISIONS 20–21): clean.

### ts1's cross-review of my M3, fixed (DONE)
1. **Medium, DECISIONS 21: the town-office screenshot test picked "last week" from a UTC date.** `shots.spec.mjs` now reads the
   current week from `GET /api/staff/report/weekly` and uses `shiftDate(week_start, -7)`, like `report-week.spec`. I grepped every
   spec and `helpers.mjs` for NL dates or weeks worked out from UTC or `Date.now()`:
   - That was the only one.
   - The others (`overdue`, `map`, `shots`' `days(n)`) date reports as offsets from now and only depend on how many days have passed.
   - `shiftDate` only ever shifts a `week_start` the API returned.
   - After the fix, no `toISOString().slice(0, 10)` or `Date.now() - 7 days` week is left in any spec.
2. **`report-week.spec` no longer races the real clock.**
   - **This week:** read before arranging and again after the UI loads; the label and `data-week` may equal either.
   - **Previous week:** its numbers come from API answers read just before the tap and just after the UI shows that week.
   - **Fixed and moving numbers:** opened, closed and averages of a past week can't change, so they are compared exactly. Open now,
     overdue now and oldest open may equal either read.
   - **The CSV:** fetched from the API just before and just after the download; the file's text and filename must equal one of them.
3. **Signed-out error paths:** the CSV, Settings save, crew change and Change PIN error paths no longer throw once the sign-in screen
   has replaced the view (the M3b pattern: check the target still exists).
   - **Spec** `staff.spec` "Save settings, Add crew, Change PIN and Download CSV after the session ended go to sign-in without a page
     error". For each action it ends the page's own session through the API, gets the 401 and "Sign in again.", and signs in again.
     At the end there must be no page error and no console error other than the browser's "Failed to load resource".
   - **Proof the spec can fail** (one-off, through the same control library, log line 1475): a copy with the unguarded
     `$('csv-error').textContent` write. The unbroken copy passed; the broken copy went red with `pageerror: Cannot set properties of
     null (setting 'textContent')`.
4. **Deactivate / Reactivate send the name as typed in the box,** so a name typed without pressing Rename is kept. **Spec**
   (`settings.spec`): type a new name for crew 2, press Deactivate → the box keeps it and the API holds that name with `active: false`.
5. **Weekly report "this week" and refresh.**
   - Every Previous / Next asks for this week again (`weekly('')`) alongside the requested week, so Next is never stuck on an old week
     after NL Monday 00:00. **Spec:** the requests made on Previous include the shifted week and one with no `week`; Next is enabled,
     then disabled again back on this week.
   - A save refreshes the weekly report when that's the view. **Spec:** open a report from Oldest open, mark it Done → "Open now" goes
     from 2 to 1 and the report leaves the list.
6. Finding 6: no change (DECISIONS 20).

### Lead polish (DONE)
- **(a) Averages always show one decimal** ("2.0", "2.1"; "–" when nothing closed). `report-week.spec` expects `toFixed(1)`. Seen in
  `chromium-1280-staff-7-weekly-report.png` ("Fallen tree 2.0").
- **(b) The staff top bar at 390 is one row.** The town name and SAMPLE fit on one line (14 px); below them the nav is one row: Board,
  Map, Report (the phone label for Weekly report), Settings and Sign out. The row can scroll sideways if a font runs wide, but at 390 it
  fits.
  - **Spec** (`targets.spec`, @phone, chromium and WebKit):
    - all five items share one top edge, and the brand is under 34 px tall;
    - the nav's `scrollWidth` ≤ `clientWidth`, so nothing is cut off;
    - each item is at least 44 × 44 px and hit-tests to itself;
    - there is no sideways page scroll, and every view opens from the bar.
  - **A fault my own look found:** the first version clipped Sign out a few pixels at the edge (a sideways scroll was needed). The
    tighter padding and the "fits" assertion came from that.
  - Seen in `chromium-390-staff-2-board.png` and `webkit-390-staff-2-board.png`.
- **(c) The board says it scrolls sideways:** with the detail open at 1101 px and wider, the line "Scroll the board sideways for more
  columns." appears above the board, and a 64 px right-edge fade (takes no taps) sits over the hidden columns. Both go away once the
  last column is in view, or when the panel closes.
  - **Spec** (`staff.spec`, @desktop, chromium and WebKit):
    - no hint while all five columns fit;
    - after opening a card: the hint, `data-more="true"`, a gradient `::after`, and Won't fix not fully in view;
    - after a real `mouse.wheel(3000, 0)` over the board: no hint, no fade, and Won't fix fully in view;
    - after Close: no hint.
  - Seen in `chromium-1280-staff-3-detail.png`.

### Verified
- **Final full run on the committed code, all four projects on 8503** (4.7 min), pass / fail / skip per project:
  - chromium-390: **42 / 0 / 0**
  - chromium-1280: **40 / 0 / 0**
  - webkit-390: **42 / 0 / 0**
  - webkit-1280: **40 / 0 / 0**

  **164 of 164.** The run before the nav fix was also 164 of 164; the "fits" assertion was added with the fix. Every screenshot was
  re-shot in the final run (84, 21 per project).
- **All seven app negative controls on 8506, on the final code** (`app/tests/negative-control.log` lines 1520–1836): boundary,
  statusleak, overlay, metoo, attribution, overdue, notestale. Each unbroken copy passed, each broken copy went red. There are no
  machine paths in the log.
- **I looked at:** the 390 board top bar (chromium, and WebKit after the fix), the 1280 detail with the hint and fade, the 1280 weekly
  report with one-decimal averages, and the WebKit 390 map.

### Left
- Nothing asked for in M3c is open. The app mock (`?mock=1`) still has no staff routes; no spec uses it.
