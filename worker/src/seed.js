// POST /api/test/seed { scenario: "demo" } (TEST_MODE only): 24 SAMPLE requests over the last five weeks, relative to "now" (so
// X-Test-Now moves the whole scenario). Pins sit a few metres off points on the town's real street lines, inside the boundary.
// Every category and status, overdue ones, one merged pair, crews, public messages, internal notes, "Me too" counts, SAMPLE names
// and 709-555-01xx phones on some, and generated SVG placeholder photos that are plainly drawings labelled "SAMPLE photo".

import { TOWN } from './town-data.js'
import { pointInRing, wardOf, locationLabel } from './geo.js'
import { categoryLabel, CLOSED_STATUSES } from './lists.js'
import { randomKey } from './auth.js'
import { DAY_MS } from './sla.js'
import { SAMPLE_CREWS } from './sample.js'
import * as H from './history.js'

const HOUR = 3600000
const METRE_LAT = 1 / 111195.0797

// days: created this many days before now; closed: closed this many days before now; into: the id this one is joined with.
const SPECS = [
  { category: 'pothole', days: 1.2, status: 'new', metoo: 2, photo: true, name: 'Pat (SAMPLE)', phone: '709-555-0101', description: 'Deep hole by the curb, cars are swerving around it (SAMPLE)' },
  { category: 'pothole', days: 6, status: 'assigned', crew: 1, metoo: 1, photo: true, message: 'The roads crew is booked for Thursday.', description: 'Two holes side by side near the bus stop (SAMPLE)' },
  { category: 'pothole', days: 5.5, status: 'merged', into: 1002, mergedDays: 5, metoo: 1, name: 'Morgan (SAMPLE)', phone: '709-555-0102', description: 'Big pothole near the bus stop (SAMPLE)' },
  { category: 'pothole', days: 20, status: 'done', crew: 1, closed: 16.5, message: 'Patched. Thanks for letting us know.', description: 'Pothole at the corner (SAMPLE)' },
  { category: 'pothole', days: 17, status: 'new', note: 'Checked from the truck: needs cold patch once it is dry (SAMPLE).', description: 'The road is breaking up at the edge (SAMPLE)' },
  { category: 'streetlight', days: 3, status: 'in_progress', crew: 1, message: 'A new bulb is on order.' },
  { category: 'streetlight', days: 13, status: 'assigned', crew: 1, photo: true, description: 'The light flickers all night (SAMPLE)' },
  { category: 'streetlight', days: 30, status: 'done', crew: 1, closed: 26 },
  { category: 'streetlight', days: 9, status: 'wont_fix', closed: 8, message: 'That light belongs to the power company. We passed your report on to them.' },
  { category: 'snow', days: 0.3, status: 'new', metoo: 3, name: 'Robin (SAMPLE)', description: 'The plow missed the whole cul-de-sac (SAMPLE)' },
  { category: 'snow', days: 12, status: 'done', crew: 1, closed: 11.2 },
  { category: 'snow', days: 1.5, status: 'in_progress', crew: 1, message: 'The plow is on its way back to your street.' },
  { category: 'water', days: 2, status: 'assigned', crew: 2, photo: true, name: 'Casey (SAMPLE)', phone: '709-555-0103', note: 'Resident is home after 4 PM; call first (SAMPLE).', description: 'Water bubbling up through the road (SAMPLE)' },
  { category: 'water', days: 25, status: 'done', crew: 2, closed: 23, message: 'The drain was cleared.' },
  { category: 'water', days: 0.8, status: 'new', description: 'Low water pressure since this morning (SAMPLE)' },
  { category: 'garbage', days: 4.5, status: 'new', phone: '709-555-0104', description: 'Bins on the whole street were skipped (SAMPLE)' },
  { category: 'garbage', days: 8, status: 'done', closed: 7.5 },
  { category: 'garbage', days: 15, status: 'wont_fix', closed: 14, message: 'Bins need to be at the curb by 7 AM on pickup day.' },
  { category: 'tree', days: 2.5, status: 'in_progress', crew: 3, photo: true, metoo: 1, description: 'A big branch is down across the sidewalk (SAMPLE)' },
  { category: 'tree', days: 18, status: 'done', crew: 3, closed: 16, note: 'Wood left at the side of the road for pickup (SAMPLE).' },
  { category: 'tree', days: 0.1, status: 'new', description: 'A tree is leaning over the walking trail (SAMPLE)' },
  { category: 'other', days: 6, status: 'new', name: 'Pat (SAMPLE)', description: 'Broken bench at the playground (SAMPLE)' },
  { category: 'other', days: 10, status: 'assigned', crew: 3, message: 'The parks crew will put it back up this week.', description: 'A sign is knocked over at the ball field (SAMPLE)' },
  { category: 'other', days: 33, status: 'done', crew: 3, closed: 31, description: 'Graffiti on the town hall wall (SAMPLE)' }
]

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const GROUND = { pothole: '#6b7280', streetlight: '#334155', snow: '#e2e8f0', water: '#0e7490', garbage: '#4d7c0f', tree: '#3f6212', other: '#92400e' }

/** A plain drawing (sky, ground, a shape) with a SAMPLE badge: nobody could take it for a real photo. No script, no external refs. */
export function photoSvg (category, ref) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
<rect width="800" height="600" fill="#e6f0f7"/>
<rect y="360" width="800" height="240" fill="${GROUND[category]}"/>
<circle cx="650" cy="140" r="60" fill="#f59e0b"/>
<ellipse cx="400" cy="450" rx="170" ry="50" fill="#14212b" opacity="0.5"/>
<rect x="40" y="40" width="390" height="116" rx="12" fill="#fff7ed" stroke="#f59e0b" stroke-width="4"/>
<text x="64" y="94" font-family="Arial, sans-serif" font-size="42" font-weight="700" fill="#92400e">SAMPLE photo</text>
<text x="64" y="134" font-family="Arial, sans-serif" font-size="24" fill="#92400e">A drawing, not a real photo</text>
<rect y="520" width="800" height="80" fill="#14212b"/>
<text x="40" y="572" font-family="Arial, sans-serif" font-size="32" fill="#ffffff">${esc(categoryLabel(category))} · ${esc(ref)}</text>
</svg>`
}

/** A point a few metres off a vertex of a real street line, inside the boundary. Deterministic per index. */
function streetPoint (i) {
  const streets = TOWN.streets
  for (let k = 0; k < streets.length; k++) {
    const line = streets[(i * 11 + k) % streets.length].lines[0]
    const [lat, lng] = line[Math.floor(line.length / 2)]
    const p = [lat + 6 * METRE_LAT, lng + 4 * METRE_LAT / Math.cos(lat * Math.PI / 180)]
    if (pointInRing(p, TOWN.boundary)) return p
  }
  throw new Error('no street point inside the boundary')
}

/** Writes the scenario (the tables must already be reset) and returns [{ id, ref, status, status_key }] in id order. */
export async function seedDemo ({ db, env, now }) {
  const iso = ms => new Date(ms).toISOString()
  const crewName = id => SAMPLE_CREWS.find(c => c.id === id).name
  const points = []
  const plusOnes = SPECS.map(s => s.metoo || 0)
  SPECS.forEach((s, i) => { if (s.into) plusOnes[s.into - 1001] += plusOnes[i] + 1 })
  const statements = []
  const out = []

  for (const [i, s] of SPECS.entries()) {
    const id = 1001 + i
    const ref = `HP-${id}`
    const created = now - s.days * DAY_MS
    const latest = now - 60000
    const clamp = t => Math.max(created, Math.min(t, latest))
    const point = s.into ? [points[s.into - 1001][0] + 15 * METRE_LAT, points[s.into - 1001][1]] : streetPoint(i)
    points.push(point)
    const closedAt = s.closed !== undefined ? now - s.closed * DAY_MS : s.status === 'merged' ? now - s.mergedDays * DAY_MS : null
    const events = []
    const add = (t, e) => events.push({ at: iso(clamp(t)), e })
    let version = 1

    add(created, H.created())
    if (s.photo) add(created + 2 * 60000, H.photo())
    for (let j = 0; j < (s.metoo || 0); j++) add(created + (j + 1) * 3 * HOUR, H.meToo())
    if (s.note) add(created + 6 * HOUR, H.note(s.note))
    const end = closedAt ?? latest
    if (s.crew) {
      const t = created + Math.min(0.4 * DAY_MS, (end - created) / 3)
      add(t, H.crew(crewName(s.crew)))
      add(t, H.status('assigned'))
      version++
    }
    let lastStatusAt = created
    if (s.status === 'in_progress' || (s.status === 'done' && s.crew)) {
      lastStatusAt = created + Math.min(0.8 * DAY_MS, (end - created) * 2 / 3)
      add(lastStatusAt, H.status('in_progress'))
      version++
    }
    if (CLOSED_STATUSES.includes(s.status)) {
      lastStatusAt = closedAt
      add(closedAt, H.status(s.status))
      version++
    }
    if (s.message) add(Math.max(lastStatusAt, created + 0.4 * DAY_MS), H.message(s.message))
    if (s.status === 'merged') {
      add(closedAt, H.mergedInto(`HP-${s.into}`))
      version++
    }
    const incoming = SPECS.map((x, k) => ({ x, k })).filter(({ x }) => x.into === id)
    for (const { x, k } of incoming) {
      add(now - x.mergedDays * DAY_MS, H.mergedIn(`HP-${1001 + k}`, (x.metoo || 0) + 1))
      version++
    }

    const statusKey = randomKey()
    statements.push(db.prepare(`INSERT INTO requests (id, submission_id, category, lat, lng, ward, location_label, description, reporter_name,
      reporter_phone, status, crew_id, public_message, plus_ones, photo, status_key, merged_into, created_at, updated_at, closed_at, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, crypto.randomUUID(), s.category, point[0], point[1], wardOf(point, TOWN.wards), locationLabel(point, TOWN.streets),
        s.description ?? null, s.name ?? null, s.phone ?? null, s.status, s.crew ?? null, s.message ?? null, plusOnes[i],
        s.photo ? 'stored' : 'none', statusKey, s.into ?? null, iso(created), events.map(v => v.at).sort().at(-1),
        closedAt === null ? null : iso(closedAt), version))
    for (const { at, e } of events) {
      statements.push(db.prepare('INSERT INTO request_history (request_id, at, kind, public_text, staff_text, internal) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, at, e.kind, e.public_text, e.staff_text, e.internal))
    }
    statements.push(db.prepare('INSERT INTO metoo_devices (request_id, device_id, reporter, at) VALUES (?, ?, 1, ?)').bind(id, crypto.randomUUID(), iso(created)))
    for (let j = 0; j < (s.metoo || 0); j++) {
      statements.push(db.prepare('INSERT INTO metoo_devices (request_id, device_id, reporter, at) VALUES (?, ?, 0, ?)')
        .bind(id, crypto.randomUUID(), iso(clamp(created + (j + 1) * 3 * HOUR))))
    }
    if (s.photo) {
      const key = randomKey()
      const svg = new TextEncoder().encode(photoSvg(s.category, ref))
      await env.PHOTOS.put(key, svg, { httpMetadata: { contentType: 'image/svg+xml' } })
      statements.push(db.prepare('INSERT INTO photos (photo_key, request_id, content_type, size, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(key, id, 'image/svg+xml', svg.byteLength, iso(clamp(created + 2 * 60000))))
    }
    out.push({ id, ref, status: s.status, status_key: statusKey })
  }

  // The merged request points at a row inserted before it, so plain insert order satisfies the foreign key.
  for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50))
  return out
}
