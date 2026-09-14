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
