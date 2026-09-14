# Town Service Requests: API contract (v1)

The contract between the Worker slice (ts1) and the app slice (ts2). If the code and this file disagree, this file wins until
the lead changes it. Written by the lead 2026-09-14. Clarifications are appended at the bottom, numbered.

One Worker `town-service-requests` serves the API under `/api/*` (Worker first) and the static app from `app/public/` (same
origin, no CORS). Local only tonight: `wrangler dev --local`. One deployment = one town.

## Conventions

JSON in, JSON out. Errors are always `{ "error": "<plain English>", "code": "<machine code>", "field"?: "<input name>" }`.

| code | HTTP | when |
|---|---|---|
| `bad_request` | 400 | validation; `field` names the input |
| `outside_boundary` | 400 | a pin outside the town boundary; `field` is `location` |
| `unauthorized` | 401 | missing/expired staff token, wrong PIN, bad or expired photo upload token |
| `not_found` | 404 | unknown id, status key, photo, crew |
| `stale` | 409 | staff PUT with an old `version`; body also has `request` (the current StaffRequest) |
| `bad_state` | 409 | acting on a merged request, merging into a merged one, "Me too" on a closed report |
| `too_large` | 413 | photo over 5 000 000 bytes |
| `unsupported_photo` | 415 | photo not `image/jpeg`, `image/png` or `image/webp` |
| `rate_limited` | 429 | too many reports, "Me too" taps, PIN tries or unknown status links from one IP |

- **Coordinates** are `[lat, lng]` arrays in town data and `lat`, `lng` numbers on requests. Distance is haversine on a sphere of
  radius 6 371 008.8 m, rounded to whole metres where shown (`distance_m`).
- **Ids.** Requests have integer `id`s starting at 1001; `ref` is `"HP-" + id` (`"HP-1001"`). The ref is for phone calls and is
  guessable, so it never unlocks anything. `submission_id` and `device_id` are **client-generated UUID v4 strings** (idempotency).
- **Instants** are ISO 8601 UTC (`2026-09-07T13:15:00.000Z`). Every instant a person reads has a `*_label` beside it in NL time
  (`America/St_Johns`): a date label is `Intl.DateTimeFormat('en-US', { timeZone: 'America/St_Johns', weekday: 'short', month:
  'short', day: 'numeric' })` → `"Mon Sep 7"`; a full label adds `hour: 'numeric', minute: '2-digit'` → `"Mon Sep 7, 10:45 AM"`.
- **Days.** `age_days = floor((now − created_at) / 86 400 000)`. `due_at = created_at + sla_days × 86 400 000` using the category's
  **current** SLA setting (`null` when the category has no target). A request is `overdue` when its status is open (`new`,
  `assigned`, `in_progress`) **and** `now > due_at` (strictly). `overdue_days = ceil((now − due_at) / 86 400 000)` when overdue,
  else `0`. `days_to_close = (closed_at − created_at) / 86 400 000` rounded half-up to 1 decimal, `null` while open.
- **Keys.** Staff session tokens are hashed at rest (SHA-256) and last 12 hours. Status keys and photo keys are ≥ 128 random bits,
  base64url, stored as is (staff copy the same status link again). Upload tokens are ≥ 128 bits, hashed at rest, expire 1 hour
  after they are issued. The PIN is PBKDF2-SHA256 (100 000 iterations) with a random salt. SAMPLE PIN `3690`.
- **Absolute links.** `status_url`, `upload_url` and `photo_url` are absolute, built from `new URL(request.url).origin`.
- **Headers.** `/api/status/*` and `/api/photos/*` answer with `Referrer-Policy: no-referrer`; status answers `Cache-Control:
  no-store`, photos `private, max-age=86400`. The `/s/` page sets `<meta name="referrer" content="no-referrer">`.
- **IP** for rate limits is `CF-Connecting-IP`, else `"local"`.
- **Test mode.** Only when the Worker has var `TEST_MODE=1` (never in production): request header `X-Test-Now: <ISO instant>`
  replaces server "now" for that request (created, closed, due, overdue, expiry, report weeks), `X-Test-IP: <string>` replaces the
  IP, and `/api/test/*` exist. Without `TEST_MODE=1` both headers are ignored and `/api/test/*` answers 404.

## Fixed lists

**Categories** (this order everywhere: lists, report rows, CSV):

| key | label | hint | default SLA days |
|---|---|---|---|
| `pothole` | Pothole | A hole or broken pavement in the road | 14 |
| `streetlight` | Streetlight out | A light that's out, flickering or on all day | 10 |
| `snow` | Missed snow clearing | A street or sidewalk the plow missed | 2 |
| `water` | Water or sewer problem | Low pressure, a leak, a bad smell or a blocked drain | 3 |
| `garbage` | Missed garbage pickup | Your bags or bin weren't picked up | 3 |
| `tree` | Fallen tree | A tree or big branch down or blocking the way | 5 |
| `other` | Something else | Anything else the town should look at | 14 |

**Statuses:** `new` "New" · `assigned` "Assigned" · `in_progress` "In progress" · `done` "Done" · `wont_fix` "Won't fix" ·
`merged` "Joined with another report". Open = `new`, `assigned`, `in_progress`. Closed = `done`, `wont_fix`. `merged` is terminal
and is not a board column.

**Wards** come from `data/town.json` (`north`, `centre`, `south`, SAMPLE). A request's ward is the first ward polygon containing
its pin, else `null`.

## Town data

`data/town.json` (lead-owned) is the SAMPLE town: `name`, `center` [lat, lng], `zoom`, `boundary` (ring of [lat, lng]), `wards`
(`id`, `name`, `polygon`), `streets` (`name`, `class`, `point` [lat, lng], `lines`: arrays of [lat, lng] runs). The Worker reads it
through a generated module (`worker/tools/build-town-data.mjs` → `worker/src/town-data.js`, output committed). `data/test-points.json`
has fixed points for tests (`inside_centre`, `outside_south`, `outside_east_of_boundary`, `on_street` {point, street},
`far_from_streets_inside` {point}). Regenerate both with `npm run town` (lead only).

- **Inside the boundary:** ray casting on the ring with lng as x and lat as y. Tests never use a point on an edge.
- **Location label:** the name of the street whose nearest segment is closest to the pin, if that distance is ≤ 150 m (point-to-
  segment distance on an equirectangular projection centred on the pin; ties → alphabetical); otherwise `"Not near a named street"`.
  Computed once when the request is created and stored as `location_label`.

## Resident routes (no account)

### `GET /api/town`
```json
{ "name": "SAMPLE Town of Harbour Pond (demo)", "sample": true, "timezone": "America/St_Johns",
  "emergency_phone": "709-555-0142", "office_phone": "709-555-0100", "office_hours": "Monday to Friday, 9 AM to 4:30 PM",
  "map_style_url": "https://tiles.openfreemap.org/styles/positron",
  "center": [49.1395, -55.352], "zoom": 15, "boundary": [[49.1615, -55.364], "…"],
  "wards": [{ "id": "north", "name": "North Ward (SAMPLE)" }],
  "categories": [{ "key": "pothole", "label": "Pothole", "hint": "A hole or broken pavement in the road" }],
  "streets": [{ "name": "Main Street", "point": [49.119, -55.3656] }],
  "nearby_metres": 50 }
```
`sample` is `true` while the name contains `SAMPLE`. `map_style_url` is the Worker variable `MAP_STYLE_URL` when set, else OpenFreeMap
positron. Streets are sorted by name. No ward polygons, no street lines.

### `POST /api/requests`
Body: `{ "submission_id", "device_id"?, "category", "lat", "lng", "description"?, "name"?, "phone"?, "has_photo" }`

| field | rule | message |
|---|---|---|
| submission_id | UUID v4 | "Something went wrong on this phone. Reload the page and try again." |
| device_id | absent or UUID v4 | same message, field `device_id` |
| category | a category key | "Pick what kind of problem it is." |
| lat, lng (field `location`) | finite numbers | "Put a pin on the map where the problem is." |
| (boundary, code `outside_boundary`, field `location`) | pin inside the boundary | "That spot is outside the town. Move the pin inside the line on the map." |
| description | ≤ 500 characters after trimming; required (≥ 1) when category is `other` | "Keep it under 500 characters." / "Tell us what the problem is." |
| name | absent, empty, or ≤ 80 characters after trimming | "Keep your name under 80 characters." |
| phone | absent, empty, or 7–15 digits once spaces, `( ) - + .` are removed, ≤ 30 characters | "That phone number doesn't look right. Leave it blank if you'd rather not say." |
| has_photo | boolean | "Something went wrong on this phone. Reload the page and try again." |

Empty `name`/`phone`/`description` are stored as `null`. Validation runs in the table's order and reports the first failure.

201:
```json
{ "id": 1024, "ref": "HP-1024", "status_url": "http://127.0.0.1:8502/s/?k=…", "status_key": "…",
  "category_label": "Pothole", "location_label": "Main Street", "reported_label": "Mon Sep 14, 5:40 PM",
  "photo": "waiting", "upload_url": "http://127.0.0.1:8502/api/requests/1024/photo", "upload_token": "…",
  "upload_expires_at": "…", "duplicate": false }
```
`photo` is `"none"` with `upload_url`/`upload_token`/`upload_expires_at` all `null` when `has_photo` is false.
**The same `submission_id` again → 200 with the same request, `duplicate: true`, and no second request.** When that request's photo
is still `waiting`, a fresh upload token is issued (the earlier one stops working); otherwise the upload fields are `null`.
When `device_id` is given it is recorded as having reported this request (a later "Me too" from that device is a duplicate).
Rate guard: 10 new (non-duplicate) requests per IP per rolling hour → 429 "That's a lot of reports from one phone in a short time.
Please call the town office."

### `PUT /api/requests/:id/photo`
Headers `Authorization: Bearer <upload_token>`, `Content-Type: image/jpeg|image/png|image/webp`; body = the bytes.
→ 200 `{ "photo": "stored" }`. Once stored, another PUT with a still-valid token → 200 `{ "photo": "stored", "duplicate": true }`
and the first photo is kept. Wrong/expired token or wrong request → 401 "This photo link has expired. Your report was still sent."
413 over 5 000 000 bytes ("That photo is too big. Try another or skip the photo."), 415 other types ("That kind of file can't be
used. Take a photo or pick a JPEG or PNG."). Unknown id → 404.

### `GET /api/requests/nearby?category=&lat=&lng=`
The "Already reported nearby" check. 400 `bad_request` (field `category` or `location`) or `outside_boundary` like POST.
```json
{ "metres": 50, "requests": [
  { "id": 1003, "ref": "HP-1003", "category": "pothole", "category_label": "Pothole", "location_label": "Main Street",
    "status": "assigned", "status_label": "Assigned", "reported_label": "Mon Sep 7", "distance_m": 40, "plus_ones": 2 } ] }
```
Open requests (never `merged`) of **that category** whose pin is **≤ 50 m** (unrounded haversine) from the given point, closest
first (ties → lower id), at most 10. No description, name, phone, photo or exact pin.

### `POST /api/requests/:id/me-too`
Body `{ "device_id" }` (UUID v4, else 400 field `device_id`). The request must be open → otherwise 409 `bad_state` "This report is
already closed." (also for `merged`). 201 `{ "ref", "plus_ones": 3, "status_url", "duplicate": false }`. The same device again (or
the device that reported it) → 200 with the unchanged count and `duplicate: true`. Rate guard: 30 non-duplicate "Me too" per IP per
rolling hour → 429 "That's a lot of taps from one phone. Please call the town office."

### `GET /api/status/:key` (the public status link)
```json
{ "town": { "name": "SAMPLE Town of Harbour Pond (demo)", "sample": true, "office_phone": "709-555-0100" },
  "ref": "HP-1003", "category": "pothole", "category_label": "Pothole", "location_label": "Main Street",
  "status": "in_progress", "status_label": "In progress", "public_message": "The roads crew is booked for Thursday.",
  "plus_ones": 2, "reported_at": "…", "reported_label": "Mon Sep 7, 10:45 AM", "updated_at": "…", "updated_label": "…",
  "closed_at": null, "closed_label": null, "merged_into": null,
  "history": [ { "at": "…", "at_label": "Mon Sep 7, 10:45 AM", "text": "Reported" } ] }
```
- `merged_into`: `null`, or `{ "ref": "HP-1001", "status_url": "…" }` for a merged request.
- `updated_at` is the latest public history entry. `history` is public entries only, oldest first (texts below).
- **Never contains** the reporter's name or phone, the description, internal notes, crew names, the photo or photo URL, `lat`/`lng`,
  device or submission ids. Tests assert this on the raw response text.
- Unknown key → 404 "We can't find that report. Check the link, or call the town office." Rate guard: 30 unknown keys per IP per
  rolling 10 minutes → 429 (then even good keys, until the window passes).

## History entries

| kind | public text | staff text | internal |
|---|---|---|---|
| `created` | Reported | Reported | no |
| `me_too` | Someone else reported it too | Someone else reported it too (+1) | no |
| `status` → new | Reopened | Reopened | no |
| `status` → assigned | Assigned to a crew | Assigned | no |
| `status` → in_progress | Work started | Work started | no |
| `status` → done | Marked done | Marked done | no |
| `status` → wont_fix | Closed without a fix | Closed without a fix | no |
| `crew` | (not shown) | Crew: {crew name} / Crew removed | yes |
| `message` | Message from the town: {text} | Public message: {text} | no |
| `message` cleared | (not shown) | Public message removed | yes |
| `note` | (not shown) | {text} | yes |
| `photo` | (not shown) | Photo added | yes |
| `merged_in` | Another report of the same problem was joined to this one | Joined in {source ref} (+{n}) | no |
| `merged_into` | Joined with {target ref} | Joined with {target ref} | no |

`{n}` is the plus-ones the merge added (source `plus_ones` + 1). A PUT that sets both status and crew writes the crew entry first.

## Staff routes (PIN)

Every `/api/staff/*` route except `signin` needs `Authorization: Bearer <token>` → else 401 "Sign in again." .

### `POST /api/staff/signin` `{ "pin" }` → 200 `{ "token", "expires_at" }`
Wrong PIN → 401 field `pin` "That PIN is not right." Rate guard: 5 wrong PINs per IP per rolling 15 minutes → 429 "Too many tries.
Wait 15 minutes and try again." (then even the right PIN is refused until the window passes).
### `POST /api/staff/signout` → 200 `{ "ok": true }` (the token stops working).
### `PUT /api/staff/pin` `{ "current_pin", "new_pin" }` → 200 `{ "ok": true }`. `new_pin` 4–8 digits (field `new_pin` "Use 4 to 8
digits."); wrong `current_pin` → 401 field `current_pin` "That PIN is not right." Other sessions keep working.

### StaffRequestSummary
```json
{ "id": 1003, "ref": "HP-1003", "category": "pothole", "category_label": "Pothole", "location_label": "Main Street",
  "lat": 49.1402, "lng": -55.3521, "ward": "centre", "ward_name": "Centre Ward (SAMPLE)",
  "status": "assigned", "status_label": "Assigned", "crew_id": 1, "crew_name": "Roads crew (SAMPLE)",
  "plus_ones": 2, "has_photo": true, "has_contact": true, "merged_count": 1, "merged_into_ref": null,
  "created_at": "…", "created_label": "Mon Sep 7, 10:45 AM", "age_days": 7,
  "due_at": "…", "due_label": "Mon Sep 21", "overdue": false, "overdue_days": 0,
  "closed_at": null, "closed_label": null, "days_to_close": null, "version": 3 }
```
`has_photo` = photo stored. `has_contact` = name or phone given. `merged_count` = requests whose `merged_into` is this one.

### StaffRequest (detail) = StaffRequestSummary plus
```json
{ "description": "Deep one by the fire hydrant (SAMPLE)", "reporter_name": "Pat (SAMPLE)", "reporter_phone": "709-555-0187",
  "photo": "stored", "photo_url": "http://127.0.0.1:8502/api/photos/…", "public_message": null, "status_url": "…",
  "merged_into": null,
  "merged": [ { "id": 1009, "ref": "HP-1009", "created_label": "…", "plus_ones": 0, "description": "…", "reporter_name": null,
                "reporter_phone": null, "photo_url": null } ],
  "history": [ { "at": "…", "at_label": "…", "kind": "created", "text": "Reported", "internal": false } ],
  "copy_update": "SAMPLE Town of Harbour Pond (demo): update on your report HP-1003 (Pothole, Main Street). A crew has been assigned. Follow it here: http://…/s/?k=…" }
```
- `photo`: `none` · `waiting` (said yes, bytes not uploaded) · `stored`. `photo_url` only when stored.
- `merged_into`: `null` or `{ "id", "ref" }`. `history`: every entry, oldest first, with the staff texts.
- **`copy_update`** exactly: `{town name}: update on your report {ref} ({category_label}, {location_label}). {sentence}` then, when
  there is a public message, ` Message from the town: {public_message}`, then ` Follow it here: {status_url}`. Sentences: new "We
  have your report." · assigned "A crew has been assigned." · in_progress "Work has started." · done "The work is done." · wont_fix
  "We won't be fixing this one." · merged "It was joined with report {target ref}." Nothing is ever sent by the app.

### `GET /api/staff/requests?status=&category=&ward=&min_age_days=&overdue=`
All filters optional. `status`: a status key, `open` or `closed`; absent = every status except `merged`. `category`, `ward`: keys.
`min_age_days`: integer ≥ 0 (keeps `age_days ≥ n`). `overdue=1`: overdue only. A bad value → 400 with `field` = the parameter.
```json
{ "now": "…", "now_label": "…",
  "counts": { "new": 4, "assigned": 3, "in_progress": 2, "done": 9, "wont_fix": 1 },
  "requests": [ "StaffRequestSummary…" ] }
```
`counts` apply every filter except `status`. `requests` are ordered by `created_at` then `id`, oldest first.

### `GET /api/staff/requests/:id` → StaffRequest
### `PUT /api/staff/requests/:id` `{ "version", "status"?, "crew_id"?, "public_message"? }` → 200 StaffRequest
- `version` (required integer) must equal the current one → else 409 `stale` "Someone else changed this report. Reload to see their
  change." with `request`. A merged request → 409 `bad_state` "This report was joined with {target ref}. Change that one instead."
- `status` one of `new, assigned, in_progress, done, wont_fix` → field `status` "Pick a status."
- `crew_id` `null` or an **active** crew → field `crew_id` "Pick one of the crews."
- Setting a crew on a `new` request without a `status` in the body moves it to `assigned`.
- The resulting request must have a crew when its status is `assigned` or `in_progress` → field `crew_id` "Pick a crew first."
- `wont_fix` needs a non-empty resulting public message → field `public_message` "Say why in the message to the public."
- `public_message` ≤ 500 after trimming (field `public_message` "Keep the message under 500 characters."); `""` clears it.
- Moving to `done`/`wont_fix` sets `closed_at` = now (unless already closed); moving to an open status clears it.
- Anything changed → `version` + 1, `updated` history entries per the table. Nothing changed → 200, same version, no entries.
### `POST /api/staff/requests/:id/notes` `{ "text" }` → 201 StaffRequest. 1–1000 characters after trimming (field `text` "Write
the note first."). Notes never change `version` and never appear in `/api/status`, CSV or the weekly report.
### `GET /api/staff/requests/:id/candidates` → `{ "requests": [ StaffRequestSummary + "distance_m" ] }`
Likely duplicates: other open, unmerged requests of the same category within 200 m, closest first, at most 10.
### `POST /api/staff/requests/:id/merge` `{ "into_id" }` → 200 `{ "request": StaffRequest (the target), "merged": StaffRequest (the source) }`
`:id` is the duplicate (source); `into_id` the one to keep (target).
- `into_id` equal to `:id` → 400 field `into_id` "Pick a different report to join it with." Unknown → 404.
- Source already merged → 409 `bad_state` "This report was already joined with {ref}."; target merged → 409 `bad_state` "{target ref}
  was itself joined with {its target ref}. Join with {its target ref} instead."
- Effects, all in one D1 batch: source `status = merged`, `merged_into = target`, `closed_at = now` if open; **target `plus_ones +=
  source plus_ones + 1`**; requests previously merged into the source now point at the target; both `version` + 1; history
  `merged_into` on the source and `merged_in` on the target. Closed targets are allowed.

### Crews
`GET /api/staff/crews` → `{ "crews": [ { "id": 1, "name": "Roads crew (SAMPLE)", "active": true, "open_count": 3 } ] }`
`POST /api/staff/crews` `{ "name" }` → 201 crew. `PUT /api/staff/crews/:id` `{ "name", "active" }` → 200 crew. `name` 1–40
characters after trimming (field `name` "Give the crew a name."). A deactivated crew stays on its requests but can't be picked.
SAMPLE crews: Roads crew (SAMPLE), Water and sewer crew (SAMPLE), Parks and trees crew (SAMPLE).

### Settings
`GET /api/staff/settings` → `{ "town_name", "emergency_phone", "office_phone", "office_hours", "sla_days": { "pothole": 14, …, "other": 14 } }`
`PUT /api/staff/settings` with all of `emergency_phone, office_phone, office_hours, sla_days` → 200 the same shape.
- phones: 7–15 digits once spaces, `( ) - + .` are removed, ≤ 30 characters → field `emergency_phone` / `office_phone` "Type a phone
  number like 709-555-0100."
- `office_hours` 1–120 characters → field `office_hours` "Keep the office hours short."
- `sla_days` has every category key, each `null` (no target) or an integer 1–365 → field `sla_days.<key>` "Use 1 to 365 days, or leave
  it blank for no target."
SLA changes apply at once to every request's `due_at` and `overdue` (they are computed when read).

### `GET /api/staff/report/weekly?week=YYYY-MM-DD`
The NL-time week (Monday 00:00 to the next Monday 00:00, `America/St_Johns`, across DST correctly) containing `week` (default: the
week containing now). Bad date → 400 field `week`.
```json
{ "week_start": "2026-09-07", "week_label": "Mon Sep 7 to Sun Sep 13", "start_at": "…", "end_at": "…",
  "rows": [ { "category": "pothole", "label": "Pothole", "opened": 3, "closed": 2, "avg_days_to_close": 4.5 } ],
  "totals": { "opened": 11, "closed": 7, "avg_days_to_close": 3.1 },
  "open_now": 9, "overdue_now": 2,
  "oldest_open": [ "StaffRequestSummary…" ] }
```
- `rows`: all seven categories in the fixed order, zeros included. **Merged requests are left out of every number.**
- `opened`: `created_at` in `[start_at, end_at)`. `closed`: status `done` or `wont_fix` with `closed_at` in the week.
- `avg_days_to_close`: mean of those closed requests' unrounded `(closed_at − created_at)` in days, rounded half-up to 1 decimal; `null`
  when none closed. Totals use every closed request of the week (not a mean of the row means).
- `open_now`, `overdue_now`, `oldest_open` (at most 5, oldest first) are as of now, not the week.

### `GET /api/staff/export.csv` (same query filters as the list)
`text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="harbour-pond-requests-YYYY-MM-DD.csv"` (today in NL time).
CRLF line ends, a header row then one row per request in list order. Header exactly:
`Reference,Category,Location,Ward,Status,Crew,Plus ones,Reported,Due,Overdue,Closed,Days to close,Public message`
Dates as `YYYY-MM-DD HH:MM` in NL time (24 h), empty when null. Overdue `Yes`/`No`. Ward and crew names, empty when null. RFC 4180
quoting (a field with a comma, quote, CR or LF is quoted, quotes doubled). **Formula guard:** a cell starting with `=`, `+`, `-`, `@`,
tab or CR gets a leading `'`. **No reporter name, phone, description or notes.**

### `GET /api/photos/:key` → the bytes with their content type. Unknown → 404. Only staff responses contain `photo_url`.

## Test routes (only with `TEST_MODE=1`)
- `POST /api/test/reset` → wipes every table, restores the SAMPLE settings, crews and PIN, clears rate limits →
  `{ "pin": "3690", "crews": [ crew… ] }`.
- `POST /api/test/seed` `{ "scenario": "demo" }` → reset, then about 24 SAMPLE requests over the last five weeks relative to now
  (every category and status, some overdue, crews, public messages, internal notes, "Me too" counts, one merged pair, SVG placeholder
  photos, SAMPLE names and 709-555-01xx phones on some) → `{ "pin": "3690", "requests": [ { "id", "ref", "status", "status_url" } ] }`.

## Clarifications
(none yet)
