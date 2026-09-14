# Town Service Requests — brief (Onyx, 2026-09-14)

**Prefix** `ts` · **Ports** app 8501, worker 8502, QA 8509 · **Repo** `town-service-requests` (private) · **Lead effort** xhigh

## What
For a small Newfoundland town: residents report a problem — pothole, streetlight out, missed snow clearing,
water/sewer issue, garbage missed, fallen tree, other — with a photo and a pin on the map. Town office staff work
the requests from a board, assign them to public works, and the resident follows a status link. Sellable to the
~270 NL municipalities, most of which take these by phone call today.

## Resident (phone, no account)
Pick a category → drop a pin (Leaflet with OpenFreeMap tiles via MapLibre GL JS + maplibre-gl-leaflet per LEAD-RULES §4, attribution; "use my location" or search a street; must be inside
the town boundary polygon) → photo (optional, compressed on the phone) → short description → name/phone optional
("so we can call you back") → **Report sent** with a reference number and status link. Before sending: **"Already
reported nearby"** — open requests of the same category within 50 m are shown with a "Me too" button that adds a
+1 instead of a duplicate. Emergencies banner: "Water main break or danger right now? Call the town / 911" (the
town sets its number).

## Town staff (PIN)
Board: New / Assigned / In progress / Done / Won't fix, filter by category/ward/age, map view with clustered pins,
request detail (photo, +1 count, history), assign to a crew, internal notes (never public), public status message,
merge duplicates. SLA settings per category (e.g. streetlight 10 days) with overdue highlighting. Weekly report:
opened/closed by category, average days to close, oldest open. CSV export.

## Status link (public)
Reference, category, general location (street name, not the exact pin), status + public message, dates. No
reporter name/phone ever shown. Nothing is emailed or texted; staff get "copy this update" text.

## Data
SAMPLE town "SAMPLE Town of Harbour Pond (demo)" with a simple boundary polygon over real public map tiles,
SAMPLE requests labelled SAMPLE. Never name a real town as a customer.

## Tests that matter
Pin outside the boundary is refused (negative control); "already reported nearby" finds the 40 m request and not
the 60 m one; merging keeps the +1 count; public status page never contains the reporter's phone or internal notes
(negative control: leak it, see the test go red); overdue by SLA on a fake clock; journeys chromium + webkit,
390 + 1280.
