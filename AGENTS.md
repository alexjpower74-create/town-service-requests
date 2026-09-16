# Town Service Requests

For a small Newfoundland town: residents report a problem (pothole, streetlight out, missed snow clearing, water or sewer,
missed garbage, fallen tree, something else) with a pin on the map and an optional photo, and follow it on a status link.
Town office staff work the requests from a board, assign crews, and see what is overdue. Overnight build 2026-09-14,
lead `ts-lead`, slices `ts1` (Worker) and `ts2` (app).

Read PLAN.md first (the Rig contract), then docs/API.md (the contract between slices), then DECISIONS.md.

## Stack and ports

- `worker/`: Cloudflare Worker, plain JS ESM, no build, no npm deps (`wrangler` on PATH, 4.131+). D1 binding `DB`
  (`town-service-requests`), R2 binding `PHOTOS` (`town-service-requests-photos`; local only until R2 is enabled: the `prototype` deploy env
  has no R2 and the code tolerates a missing binding). Serves `/api/*` and the static app in `app/public/`.
- `app/public/`: plain HTML/JS/CSS, no build. `/` resident report · `/s/?k=` public status · `/staff/` town office (PIN).
- `app/tests/`: Playwright 1.63, chromium + webkit, 390 and 1280, against the real Worker.
- `data/town.json`: the SAMPLE town (boundary, wards, streets from OpenFreeMap tiles). `tools/`: the lead's data tools.
- Ports: ts1 Worker 8502 (inspector 8512), ts1 negative controls 8505 (inspector 8515) · ts2 dev Worker 8501 (inspector 8511),
  e2e Worker 8503 (inspector 8513), app negative controls 8506 (inspector 8516) · QA 8509 (inspector 8519) · demo 8501.
  Always pass `--inspector-port`: other crews run wrangler too and the default 9229 collides.
- SAMPLE staff PIN `3690`.

## Rules that bite here

- **Deploys only when Alexander says so** (he did on 2026-09-15: the prototype is live, see docs/DEPLOY.md). Day to day: `wrangler dev --local`;
  live redeploy is `npx wrangler deploy --env prototype`. No `secret put`, Pages or DNS. Never deploy with `TEST_MODE`; the SAMPLE rows were imported with `d1 execute --remote --file`.
- **Public repo.** Run `check-no-personal-data .` before every push; no secrets, machine names or home-folder paths.
- **Nothing is sent.** No SMS or email. Staff get "copy this update" text; residents get a status link on screen.
- **SAMPLE on every screen.** The town is "SAMPLE Town of Harbour Pond (demo)". Requests, crews and people are SAMPLE. Never name a
  real town as a customer. The map underneath is a real place; the app hides the tiles' town-name labels.
- **The public status link never shows** the reporter's name or phone, internal notes, the description, the photo or the exact pin.
  A test reads the raw JSON and the rendered page for each.
- **Map tiles:** OpenFreeMap via MapLibre GL inside Leaflet, attribution always visible. Tests never touch the internet: the style
  request is answered by a local fixture and any other outside request fails the test.
- **Times are NL time** (`America/St_Johns`). Overdue and the weekly report use the server clock, which tests fake with `X-Test-Now`.
- Own only your slice's paths; `rig guard` enforces it. Verify → commit (own paths) → report.
- Every important check has a negative control: break a copy, watch it go red, restore, record it.
- Plain English for Newfoundland users. No emoji as icons. No devils or demons.

## Standing rules (every project, read by Claude Code and Codex alike)

CLAUDE.md is a symlink to this file, so Onyx (Claude Code) and Cobalt (Codex) read the same text. Edit AGENTS.md only.

- **Read PLAN.md first where it exists; it is the contract.** Own only your slice's files.
- **What "done" means:** verified, committed (only your own paths, with a message that says what and why), pushed, and shown: a screenshot via `pwshot` for anything visible. Never hand back an empty screen; seed demo data if the UI needs it. Never leave a green step uncommitted.
- **Nothing leaves without Alexander.** Emails, forms, applications, posts, marketplace submissions and pull requests to other people's repos are staged to one click; he presses send.
- **Tests that cannot lie.** A bug that reached a person gets a test that fails without the fix, proved by reverting the fix. Every guard (grep, lint, check) is shown to fail on a known-bad input in the same run: a check that cannot fail measured nothing. Real dependencies over mocks where practical. Hit-test with elementFromPoint, never rects.
- **Public-repo hygiene.** No secrets, no machine names, no home-folder paths, no invented businesses. Real businesses appear only where Alexander chose to show them. Run `check-no-personal-data` before pushing a public repo.
- **Browser work.** Playwright is the default; WebKit check before calling a WKWebView page done; the Chrome extension only for pages that need his real login.
- **Keep this file short:** commands, gotchas with a why, hard rules. Architecture belongs in the code and README.
