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

## Lead checks by eye
- ts2 M1 screenshots (resident home 390, nearby 390, status 1280): SAMPLE on every screen, banner first, no private fields on status.
- ts2 M2 real-Worker screenshots (staff board 1280, detail 390, join confirm 1280): overdue edges and counts right, `tel:` contact,
  inline join confirm. **Polish for ts2 after M3:** at 1280 with the detail panel open the five board columns get cramped
  ("In progress" wraps, cards three words wide).
- `npm run demo` from main at `fb199ec` on a spare port (8507): migrations, wrangler, seed of 24 SAMPLE requests, links printed;
  `/`, `/s/`, `/staff/`, `/api/town` all 200; a printed status link returns HP-1001 with no private fields. Stopped after.
