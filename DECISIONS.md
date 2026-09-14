# Town Service Requests: decisions

Every real call made without Alexander (he is asleep during the overnight sprint). Newest sections at the bottom. Numbered so
PLAN.md, API.md and reports can point at them.

## 2026-09-14, lead (setup)

1. **Street data comes from OpenFreeMap's own vector tiles, not Overpass or Geofabrik.** The town's street list (for "search a
   street" and the street name on the status link) needs real street geometry under the map. Checked robots.txt first:
   - `https://overpass-api.de/robots.txt` says `Disallow: /api/`. One query went out before the robots check was read (it came back as an
     HTML error page); the response was deleted and nothing from it is used.
   - `https://download.geofabrik.de/robots.txt` disallows `*.osm.pbf` and `*.shp.zip`, so no extract download.
   - `https://openfreemap.org/robots.txt` is `Allow: /`; `tiles.openfreemap.org/robots.txt` answers 403 (no rules published). OpenFreeMap's
     home page says commercial use is allowed and its public instance has no limits.
   So `tools/fetch-tiles.mjs` fetched the 16 z14 vector tiles over the town area (one request every 1.2 s, the research User-Agent),
   saved raw in `data/sources/openfreemap-tiles/` with a manifest of URL + fetched time, and `tools/build-town.mjs` decodes the
   `transportation_name` layer into `data/town.json`. These are the same tiles the resident's map draws, so the street names match
   what people see. Data © OpenMapTiles, from OpenStreetMap (ODbL); the attribution is on every map.
2. **Map libraries are vendored and pinned** in `app/public/vendor/` (Leaflet 1.9.4, MapLibre GL 5.24.0, @maplibre/maplibre-gl-leaflet
   0.1.4, leaflet.markercluster 1.5.3), same versions as Snow Route's OpenFreeMap round (its DECISIONS 63: the binding needs the classic
   `maplibregl` global, which 6.x no longer ships). No CDN.
3. **The SAMPLE town sits on Botwood's streets, under a SAMPLE name.** The brief wants "a simple boundary polygon over real public map
   tiles". The tiles fetched above cover Botwood, so the street names under the pins are real, but the town is always "SAMPLE Town of
   Harbour Pond (demo)", the boundary is a hand-drawn nine-point shape (not the real municipal line), the three wards are SAMPLE bands
   (North / Centre / South), and the maps hide the tiles' place-name labels so the demo does not read as Botwood being a customer. No
   council, staff member or resident is real. 67 named streets fall inside the SAMPLE boundary (`data/town.json`).
4. **No geocoding service.** "Search a street" searches the town's own street list (name + a point on the street) instead of Nominatim
   or a paid geocoder, so there is no third-party usage policy to respect and it works on bad signal. The status link's "general
   location" is the nearest named street within 150 m of the pin, computed once when the report is made.
5. **The public status link shows less than staff see.** Per the brief it has reference, category, street, status, public message and
   dates. It also leaves out the description and the photo (residents write addresses, names and faces into both) and crew names.
   History on the status page is public entries only. Photos are staff-only, served from unguessable URLs in staff answers.
6. **Two-step report: create, then photo.** The report is created first with a phone-made `submission_id` (resending never makes a
   second report), then the photo goes up with a one-hour upload token. A photo that fails never loses the report.
7. **"Me too" counts once per phone per report** (a `device_id` kept on the phone; the reporter's own phone counts as already added).
   Merging adds the duplicate's own +1s plus one for its reporter. Devices are not de-duplicated across merged reports: a person who
   tapped Me too on both halves of a duplicate pair counts twice. That is rare and staff can see it in the history.
8. **Merged is its own terminal status**, not a board column, and merged reports are left out of the weekly report's numbers (they are
   the same problem counted once). Their status links point at the report that was kept.
9. **Overdue is computed when read**, from the category's current SLA: changing an SLA in Settings re-flags every open report at once.
   Overdue means strictly past the due time; done and won't-fix reports are never overdue.
10. **Staff edits carry a version.** Two people at the counter changing the same report get "Someone else changed this report" instead
    of silently overwriting each other. Internal notes, "Me too" taps and photos don't bump the version, so they never block a save.
11. **Won't fix needs a public message.** A resident told only "Won't fix" will phone the office anyway; the message field says why.
12. **The CSV export has no reporter names, phones, descriptions or notes.** CSVs get emailed around; the detail screen has the contact.
13. **SAMPLE phone numbers use 709-555-01xx**, the range reserved for fiction, so nobody real gets called from the demo.
14. **Two slices, Opus 5 medium** (tonight's rule): ts1 owns `worker/**`, ts2 owns `app/**`; the lead owns data, tools and docs.
    `app/node_modules` and the vendored map libraries are installed on main before `rig up`.
