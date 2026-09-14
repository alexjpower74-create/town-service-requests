# Town Service Requests: build report (lead)

Overnight build 2026-09-14. Lead `ts-lead` (Opus 5 xhigh), slices `ts1` Worker and `ts2` app (Opus 5 medium). Every number below comes
from a QA worktree pinned to the named sha on port 8509 (`rig qa --ref`), never from a slice's own tree. Slice reports:
`docs/build-report-ts1.md`, `docs/build-report-ts2.md`. Final numbers are at the bottom once final QA has run.

## QA history

| When | Ref | What ran | Result |
|---|---|---|---|
| ts1 M1 | `d507245` | Worker unit + API, 6 negative controls | unit 17/0/0, API 33/0/0, 6/6 red |
| ts1 M2a | `373563e` | Worker unit + API (locate route) | unit 17/0/0, API 34/0/0 |
| ts1 M2b | `d136ee2` | Worker unit + API, 11 negative controls | unit 21/0/0, API 49/0/0, 11/11 red |
| ts1 M2c | `bc5e388` | Worker unit + API, 13 negative controls | unit 21/0/0, API 50/0/0, 13/13 red |
| ts2 M1 | `1757f0c` | (slice's own run, mock only) map-label unit, M1 smoke | 4/0, 522/0; merged on review, real-Worker grading was M2 |
| main after ts2 M2 | `fb199ec` | Playwright, 4 projects (chromium + webkit, 390 + 1280), real Worker with ts1's M2b/M2c guards | 84 passed / 0 failed / 0 skipped (2.2 min), `PW_EXIT=0` |
| main after ts2 M3 | `8350c8d` | Playwright, 4 projects, real Worker (adds map, weekly report, settings, overdue, emergency, sign-in rate guard) | 124 passed / 0 failed / 0 skipped (3.6 min), `PW_EXIT=0` |

**A QA run that didn't run.** The first QA attempt for ts1 M2b exited 1 without testing anything: the previous run's negative
controls had rewritten `worker/tests/negative-control.log` inside the QA worktree, so `rig qa` could not check out the new sha, and
the `$?` read behind a pipe showed 0. Since then every QA command writes its logs outside the worktree, restores tracked files it
touched, and is gated on printed `*_EXIT=` lines.

## Defects found by the process (not by the author's own tests)

1. **Idempotency leaned on an accident** (ts1's own negative control, M1): with the duplicate lookup and UNIQUE removed, a resend was
   still refused, because the create batch found the new row by `submission_id` and collided on the reporter-device key. A resend
   without a device id would have made a second report. Fixed: the batch finds the new row by its random status key.
2. **A same-crew save on a New report moved it to Assigned** (ts2's cross-review of ts1 M1): the auto-assign checked that `crew_id`
   was in the body, not that it changed. Fixed in ts1 M2b; clarification 10.
3. **A malformed `%` escape in a status link answered 500** instead of the plain 404 (ts2's cross-review). Fixed; clarification 11.
4. **A merge that kept losing races answered 500** (ts2's cross-review). Now 409; the give-up path proven in a copy (`negative:mergegiveup`).
5. **The PUT's in-batch version guard was bound to the version the Worker had just read, not the client's** (ts1's two-phase
   `negative:batchguard`, M2c): with the early check removed, a stale save got 200. Fixed by binding the client's version; the guard is
   now a real second defence, shown firing alone and going red when neutralised.
6. **ts2's M1 "Near <street>" hint could disagree with the stored label** (ts1's cross-review of ts2 M1): the phone had one point per
   street and a 250 m limit, the Worker segments and 150 m. Fixed by `GET /api/town/locate` (clarification 9).
7. **WebKit dropped the space before the emergency number** when the banner wrapped (ts2's M1 smoke). Fixed.

8. **Saving after adding a note could silently undo another person's change** (ts1's read-only cross-review of ts2 M2, medium): the
   note's answer replaced the page's copy of the report (with the newer version) but not the form, so Save sent the old form values with
   the new version and the Worker accepted it. No Worker check can catch a client that sends the version it was just given. Sent to ts2
   as a fix with a spec that proves the stale 409 appears (DECISIONS 19).

9. **A screenshot test would fail on Sunday evenings** (ts1's read-only cross-review of ts2 M3, medium): it picked "last week" from the UTC
   date, which from 21:30 NDT to midnight on a Sunday is already the Monday of the current NL week, so the test's arranged reports were in
   the future and Previous week didn't match, in all four projects. Plus three narrow real-clock windows in `report-week.spec` (a week
   change, an NL midnight between download and API fetch, a report falling due mid-run). Sent to ts2 (DECISIONS 21). Tonight's runs were
   outside every window, which is exactly why no run caught it.

10. **A rare race in the attribution test** (final QA at `691a331`, 1 failure in 164): on webkit-1280 the OpenFreeMap link passed
    `toBeVisible` and `toHaveText`, then `scrollIntoViewIfNeeded` failed with "Element is not attached to the DOM". Cause: when the map
    style loads, the maplibre-gl-leaflet binding removes and re-adds its attribution (`vendor/maplibre/leaflet-maplibre-gl.js:136-138`),
    so Leaflet re-renders the control and replaces the three links mid-loop. People see nothing (same text, still visible). A targeted
    repeat at the same pin passed 20/20 (10 each on webkit-1280 and chromium-1280), which is what a rare race looks like. Sent to ts2 as a
    test fix: wait for the base map to settle (`data-style-loaded` or the no-WebGL fallback) before the per-link checks, prove it with
    `--repeat-each 20`, and show `negative-attribution` still goes red.

## Lead checks by eye
- ts2 M1 screenshots (resident home 390, nearby 390, status 1280): SAMPLE on every screen, banner first, no private fields on status.
- ts2 M2 real-Worker screenshots (staff board 1280, detail 390, join confirm 1280): overdue edges and counts right, `tel:` contact,
  inline join confirm. **Polish for ts2 after M3:** at 1280 with the detail panel open the five board columns get cramped
  ("In progress" wraps, cards three words wide).
- ts2 M3 screenshots from main at `8350c8d` (staff map 1280, weekly report 1280, settings WebKit 390): clusters, status legend,
  overdue ring, boundary and attribution on the map; report table, "joined reports are left out", oldest open with overdue lines;
  settings with blank-for-no-target SLA boxes, crews, PIN change. **Polish for the final round:** (a) averages print as "2" where the
  others print "2.1": show one decimal always ("2.0"); (b) at 390 the staff top bar wraps onto two lines (Board / Map / Weekly report,
  then Settings / Sign out).
- **Street labels on the demo seed, checked with the Worker's own code** (main at `709b215`, no server): recomputed all 24 seed pins with
  `worker/src/geo.js`. None reads "Not near a named street". Five carry a different street than the one the seed placed them on (Abbott
  Street → Keats Lane, Scout Road → Deans Avenue, Frazer Road → Airbase Road, Junction Road → Water Street, Hollett Place →
  Commonwealth Drive); in every case the labelled street is measurably nearer the pin (e.g. 2.20 m vs 6.93 m) because the pin sits at
  a junction, so the label is right. The "Not near a named street" cards in the e2e screenshots come from test arrangements, not the seed.
- `npm run demo` from main at `fb199ec` on a spare port (8507): migrations, wrangler, seed of 24 SAMPLE requests, links printed;
  `/`, `/s/`, `/staff/`, `/api/town` all 200; a printed status link returns HP-1001 with no private fields. Stopped after.

## Demo left running for Alexander

Started detached from main at `3d5a997` with exactly the README's command (`setsid nohup npm run demo > .logs/demo.log`), from a clean
state: migrations applied, 24 SAMPLE requests seeded, links written to `.logs/demo-links.txt`. Checked with curl: `/`, `/s/`,
`/staff/` and `/api/town` answer 200; a printed status link answers 200 and its JSON carries only public fields; staff sign-in with
PIN 3690 returns a token. The listener on 8501 is a process whose working directory is this project's `worker/`, so no other crew's
demo was touched.

## Known gaps and v2 ideas

- **One shared staff PIN.** Everyone at the town office signs in with the same PIN, so history says "Town office", not who made a change.
  Per-person staff accounts (and who changed what) are the first v2 item for a real council.
- **Nothing is sent.** Staff copy the update text; residents keep their status link. Texting or emailing residents needs an SMS or
  email account and consent wording (v2, Alexander's call).
- **Street search is the town's own street list,** not a geocoder: no house numbers, no landmarks. The SAMPLE boundary is a hand-drawn
  shape, the wards are bands, and the streets come from z14 vector tiles (about a metre of precision). A real town needs its own
  boundary, wards (or none) and streets rebuilt with `tools/`.
- **The staff board doesn't refresh on its own;** it reloads after each save, note, join or filter change. Two people at the counter see
  each other's changes on their next action (a stale save is refused, never silently applied).
- **Rate limits are per IP,** which is blunt behind a carrier's shared address (10 reports an hour from one IP, then "call the town office").
- **"Me too" is counted once per phone per report,** not across a merged pair (DECISIONS 7).
- **Residents need signal to send.** There is no offline queue on the report page; the photo retry and resend are safe, but nothing is
  stored for later.
- **Tests use a stand-in base map** (a local style fixture, no internet), so real OpenFreeMap tiles are only seen when a person opens the
  demo online. Tested in Playwright's chromium and webkit at phone and desktop sizes, not on a physical phone.
- **Accessibility** is checked for contrast (4.5 : 1 on chips, banner and primary buttons), tap-target size and hit-testing; there has been
  no screen-reader pass.
- **OpenFreeMap's public instance** is free for commercial use with no key and no limits, but has no SLA; `MAP_STYLE_URL` moves the map to
  self-hosted or paid tiles.
- **Before any real town uses it:** its own name (the SAMPLE badge follows the name), boundary and streets, a changed PIN, its real phone
  numbers, and an ATIPPA privacy notice for the name, phone and photo residents may give (`docs/DEPLOY.md`).
