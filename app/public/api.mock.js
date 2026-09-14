// In-browser stand-in for the Worker, for development only (open a page with ?mock=1). Same shapes, codes and error texts as
// docs/API.md for the routes the resident and status pages use. State is in memory, mirrored to sessionStorage so the status
// page in the same tab sees the report just made; ?reset=1 starts over. The clock is the browser's.
// Playwright specs never use this: they run against the real Worker.
//
// Demo status links: /s/?mock=1&k=demo-status-sample-1001 (assigned, message, +2)   -1002 (done)   -1003 (joined with 1001)
// Photo failure for the "didn't go through" screen: ?photo=fail (every upload fails) or ?photo=fail-once (the first one fails).

import { TOWN } from '/mock-town.js'
import { insideRing, haversine, nearestStreetByLines, north } from '/geo.js'

const STORE_KEY = 'tsr:mock-store'
const PHOTO_KEY = 'tsr:mock-photo'
const DAY = 86_400_000
const ZONE = 'America/St_Johns'
const ORIGIN = location.origin
const OPEN = new Set(['new', 'assigned', 'in_progress'])
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STATUS_LABEL = { new: 'New', assigned: 'Assigned', in_progress: 'In progress', done: 'Done', wont_fix: "Won't fix", merged: 'Joined with another report' }
const CATEGORIES = [
  { key: 'pothole', label: 'Pothole', hint: 'A hole or broken pavement in the road' },
  { key: 'streetlight', label: 'Streetlight out', hint: "A light that's out, flickering or on all day" },
  { key: 'snow', label: 'Missed snow clearing', hint: 'A street or sidewalk the plow missed' },
  { key: 'water', label: 'Water or sewer problem', hint: 'Low pressure, a leak, a bad smell or a blocked drain' },
  { key: 'garbage', label: 'Missed garbage pickup', hint: "Your bags or bin weren't picked up" },
  { key: 'tree', label: 'Fallen tree', hint: 'A tree or big branch down or blocking the way' },
  { key: 'other', label: 'Something else', hint: 'Anything else the town should look at' },
]
const catLabel = (k) => CATEGORIES.find((c) => c.key === k)?.label
const iso = (ms) => new Date(ms).toISOString()
const LABEL_FORMAT = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
const labelParts = (at) => Object.fromEntries(LABEL_FORMAT.formatToParts(new Date(at)).map((p) => [p.type, p.value]))
const dateLabel = (at) => { const p = labelParts(at); return `${p.weekday} ${p.month} ${p.day}` }
const fullLabel = (at) => { const p = labelParts(at); return `${p.weekday} ${p.month} ${p.day}, ${p.hour}:${p.minute} ${p.dayPeriod.toUpperCase()}` }
const codePoints = (s) => [...s].length
const randomKey = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const label = (lat, lng) => nearestStreetByLines([lat, lng], TOWN.streets) || 'Not near a named street'

const params = new URLSearchParams(location.search)
try {
  if (params.get('reset') === '1') sessionStorage.removeItem(STORE_KEY)
  if (params.has('photo')) sessionStorage.setItem(PHOTO_KEY, params.get('photo'))
} catch {}

/* ---- seed ------------------------------------------------------------------ */
function seed() {
  const now = Date.now()
  const street = TOWN.streets.find((s) => s.name === 'Main Street') || TOWN.streets[0]
  const [plat, plng] = north(street.point, 30)
  const base = (id, over) => ({
    id, submission_id: null, category: 'pothole', lat: plat, lng: plng, description: null, name: null, phone: null,
    status: 'new', public_message: null, plus_ones: 0, created_at: iso(now - 7 * DAY), closed_at: null, merged_into: null,
    status_key: `demo-status-sample-${id}`, photo: 'none', upload_token: null, devices: [], history: [], ...over,
  })
  const h = (ms, text) => ({ at: iso(ms), text })
  const r1001 = base(1001, {
    description: 'Deep one by the hydrant (SAMPLE)', name: 'Pat (SAMPLE)', phone: '709-555-0187', status: 'assigned', plus_ones: 2,
    public_message: 'The roads crew is booked for Thursday.',
    history: [h(now - 7 * DAY, 'Reported'), h(now - 6 * DAY, 'Someone else reported it too'), h(now - 5 * DAY, 'Someone else reported it too'),
      h(now - 4 * DAY, 'Assigned to a crew'), h(now - 4 * DAY + 60_000, 'Message from the town: The roads crew is booked for Thursday.')],
  })
  const [llat, llng] = TOWN.center
  const r1002 = base(1002, {
    category: 'streetlight', lat: llat, lng: llng, status: 'done', created_at: iso(now - 9 * DAY), closed_at: iso(now - 2 * DAY),
    public_message: 'New bulb in. Thanks for letting us know.',
    history: [h(now - 9 * DAY, 'Reported'), h(now - 8 * DAY, 'Assigned to a crew'), h(now - 2 * DAY, 'Marked done'),
      h(now - 2 * DAY + 60_000, 'Message from the town: New bulb in. Thanks for letting us know.')],
  })
  const r1003 = base(1003, {
    lat: plat + 0.00005, created_at: iso(now - 6 * DAY), status: 'merged', merged_into: 1001, closed_at: iso(now - 5 * DAY),
    history: [h(now - 6 * DAY, 'Reported'), h(now - 5 * DAY, 'Joined with HP-1001')],
  })
  return { nextId: 1004, requests: [r1001, r1002, r1003] }
}

let store = null
function load() {
  if (store) return store
  try { store = JSON.parse(sessionStorage.getItem(STORE_KEY)) } catch {}
  if (!store?.requests) store = seed()
  save()
  return store
}
function save() {
  try { sessionStorage.setItem(STORE_KEY, JSON.stringify(store)) } catch {}
}

/* ---- answers --------------------------------------------------------------- */
const ok = (status, data) => ({ status, data })
const fail = (status, code, error, field) => ({ status, data: field ? { error, code, field } : { error, code } })
const bad = (error, field) => fail(400, 'bad_request', error, field)
const statusUrl = (r) => `${ORIGIN}/s/?k=${encodeURIComponent(r.status_key)}`
const PHONE_BAD = "That phone number doesn't look right. Leave it blank if you'd rather not say."
const PHONE_MSG = 'Something went wrong on this phone. Reload the page and try again.'
const OUTSIDE = 'That spot is outside the town. Move the pin inside the line on the map.'

function town() {
  return ok(200, {
    name: TOWN.name, sample: TOWN.name.includes('SAMPLE'), timezone: ZONE,
    emergency_phone: TOWN.emergency_phone, office_phone: TOWN.office_phone, office_hours: TOWN.office_hours,
    map_style_url: 'https://tiles.openfreemap.org/styles/positron',
    center: TOWN.center, zoom: TOWN.zoom, boundary: TOWN.boundary,
    wards: TOWN.wards.map((w) => ({ id: w.id, name: w.name })),
    categories: CATEGORIES,
    streets: TOWN.streets.map((s) => ({ name: s.name, point: s.point })).sort((a, b) => (a.name < b.name ? -1 : 1)),
    nearby_metres: 50,
  })
}

function locate(query) {
  const num = (v) => (v === null || v.trim() === '' ? NaN : Number(v))
  const lat = num(query.get('lat'))
  const lng = num(query.get('lng'))
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return bad('Put a pin on the map where the problem is.', 'location')
  const ward = TOWN.wards.find((w) => insideRing([lat, lng], w.polygon))?.id ?? null
  return ok(200, { inside: insideRing([lat, lng], TOWN.boundary), location_label: label(lat, lng), ward })
}

function createAnswer(r, status, duplicate) {
  const waiting = r.photo === 'waiting'
  if (waiting) r.upload_token = randomKey()
  save()
  return ok(status, {
    id: r.id, ref: `HP-${r.id}`, status_url: statusUrl(r), status_key: r.status_key, category_label: catLabel(r.category),
    location_label: r.location_label, reported_label: fullLabel(r.created_at), photo: r.photo,
    upload_url: waiting ? `${ORIGIN}/api/requests/${r.id}/photo` : null, upload_token: waiting ? r.upload_token : null,
    upload_expires_at: waiting ? iso(Date.now() + 3_600_000) : null, duplicate,
  })
}

function create(b = {}) {
  const s = load()
  if (typeof b.submission_id !== 'string' || !UUID4.test(b.submission_id)) return bad(PHONE_MSG, 'submission_id')
  if (b.device_id !== undefined && b.device_id !== null && (typeof b.device_id !== 'string' || !UUID4.test(b.device_id))) return bad(PHONE_MSG, 'device_id')
  if (!catLabel(b.category)) return bad('Pick what kind of problem it is.', 'category')
  if (!Number.isFinite(b.lat) || !Number.isFinite(b.lng)) return bad('Put a pin on the map where the problem is.', 'location')
  if (!insideRing([b.lat, b.lng], TOWN.boundary)) return fail(400, 'outside_boundary', OUTSIDE, 'location')
  const text = (v) => (v === undefined || v === null ? '' : typeof v === 'string' ? v.trim() : null)
  const description = text(b.description)
  if (description === null || codePoints(description) > 500) return bad('Keep it under 500 characters.', 'description')
  if (b.category === 'other' && !description) return bad('Tell us what the problem is.', 'description')
  const name = text(b.name)
  if (name === null || codePoints(name) > 80) return bad('Keep your name under 80 characters.', 'name')
  const phone = text(b.phone)
  if (phone === null) return bad(PHONE_BAD, 'phone')
  if (phone) {
    const digits = phone.replace(/[\s().+-]/g, '')
    if (phone.length > 30 || !/^\d{7,15}$/.test(digits)) return bad(PHONE_BAD, 'phone')
  }
  if (typeof b.has_photo !== 'boolean') return bad(PHONE_MSG, 'has_photo')
  const dup = s.requests.find((r) => r.submission_id === b.submission_id)
  if (dup) return createAnswer(dup, 200, true)
  const now = Date.now()
  const r = {
    id: s.nextId++, submission_id: b.submission_id, category: b.category, lat: b.lat, lng: b.lng,
    location_label: label(b.lat, b.lng), description: description || null, name: name || null, phone: phone || null,
    status: 'new', public_message: null, plus_ones: 0, created_at: iso(now), closed_at: null, merged_into: null,
    status_key: randomKey(), photo: b.has_photo ? 'waiting' : 'none', upload_token: null,
    devices: b.device_id ? [b.device_id] : [], history: [{ at: iso(now), text: 'Reported' }],
  }
  s.requests.push(r)
  return createAnswer(r, 201, false)
}

function photo(id, headers, bytes, type) {
  const r = load().requests.find((x) => x.id === id)
  if (!r) return fail(404, 'not_found', 'We can\'t find that report.')
  const token = /^Bearer (.+)$/.exec(headers.Authorization || '')?.[1]
  if (!token || token !== r.upload_token) return fail(401, 'unauthorized', 'This photo link has expired. Your report was still sent.')
  let mode = null
  try { mode = sessionStorage.getItem(PHOTO_KEY) } catch {}
  if (mode === 'fail' || mode === 'fail-once') {
    if (mode === 'fail-once') try { sessionStorage.removeItem(PHOTO_KEY) } catch {}
    return fail(503, 'mock', 'The mock failed this upload on purpose.')
  }
  if ((bytes?.size ?? 0) > 5_000_000) return fail(413, 'too_large', 'That photo is too big. Try another or skip the photo.')
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) return fail(415, 'unsupported_photo', "That kind of file can't be used. Take a photo or pick a JPEG or PNG.")
  if (r.photo === 'stored') return ok(200, { photo: 'stored', duplicate: true })
  r.photo = 'stored'
  r.photo_bytes = bytes.size
  r.photo_type = type
  save()
  return ok(200, { photo: 'stored' })
}

function nearby(query) {
  const category = query.get('category')
  if (!catLabel(category)) return bad('Pick what kind of problem it is.', 'category')
  const lat = Number(query.get('lat'))
  const lng = Number(query.get('lng'))
  if (!query.get('lat') || !query.get('lng') || !Number.isFinite(lat) || !Number.isFinite(lng)) return bad('Put a pin on the map where the problem is.', 'location')
  if (!insideRing([lat, lng], TOWN.boundary)) return fail(400, 'outside_boundary', OUTSIDE, 'location')
  const found = load().requests
    .filter((r) => OPEN.has(r.status) && r.category === category)
    .map((r) => ({ r, d: haversine([lat, lng], [r.lat, r.lng]) }))
    .filter((x) => x.d <= 50)
    .sort((a, b) => a.d - b.d || a.r.id - b.r.id)
    .slice(0, 10)
  return ok(200, {
    metres: 50,
    requests: found.map(({ r, d }) => ({
      id: r.id, ref: `HP-${r.id}`, category: r.category, category_label: catLabel(r.category), location_label: r.location_label || label(r.lat, r.lng),
      status: r.status, status_label: STATUS_LABEL[r.status], reported_label: dateLabel(r.created_at), distance_m: Math.round(d), plus_ones: r.plus_ones,
    })),
  })
}

function meToo(id, b = {}) {
  if (typeof b.device_id !== 'string' || !UUID4.test(b.device_id)) return bad(PHONE_MSG, 'device_id')
  const r = load().requests.find((x) => x.id === id)
  if (!r) return fail(404, 'not_found', "We can't find that report.")
  if (!OPEN.has(r.status)) return fail(409, 'bad_state', 'This report is already closed.')
  const answer = (status, duplicate) => ok(status, { ref: `HP-${r.id}`, plus_ones: r.plus_ones, status_url: statusUrl(r), duplicate })
  if (r.devices.includes(b.device_id)) return answer(200, true)
  r.devices.push(b.device_id)
  r.plus_ones += 1
  r.history.push({ at: iso(Date.now()), text: 'Someone else reported it too' })
  save()
  return answer(201, false)
}

function status(key) {
  const s = load()
  const r = s.requests.find((x) => x.status_key === key)
  if (!r) return fail(404, 'not_found', "We can't find that report. Check the link, or call the town office.")
  const last = r.history[r.history.length - 1]
  const into = r.merged_into ? s.requests.find((x) => x.id === r.merged_into) : null
  return ok(200, {
    town: { name: TOWN.name, sample: TOWN.name.includes('SAMPLE'), office_phone: TOWN.office_phone },
    ref: `HP-${r.id}`, category: r.category, category_label: catLabel(r.category), location_label: r.location_label || label(r.lat, r.lng),
    status: r.status, status_label: STATUS_LABEL[r.status], public_message: r.public_message, plus_ones: r.plus_ones,
    reported_at: r.created_at, reported_label: fullLabel(r.created_at), updated_at: last.at, updated_label: fullLabel(last.at),
    closed_at: r.closed_at, closed_label: r.closed_at ? fullLabel(r.closed_at) : null,
    merged_into: into ? { ref: `HP-${into.id}`, status_url: statusUrl(into) } : null,
    history: r.history.map((x) => ({ at: x.at, at_label: fullLabel(x.at), text: x.text })),
  })
}

/* ---- router ------------------------------------------------------------------ */
export async function handle(method, path, { json, bytes, type, headers = {} } = {}) {
  await new Promise((r) => setTimeout(r, 60)) // a little latency, so busy states are visible
  const url = new URL(path, ORIGIN)
  const p = url.pathname
  let m
  if (method === 'GET' && p === '/api/town') return town()
  if (method === 'GET' && p === '/api/town/locate') return locate(url.searchParams)
  if (method === 'POST' && p === '/api/requests') return create(json)
  if (method === 'GET' && p === '/api/requests/nearby') return nearby(url.searchParams)
  if (method === 'PUT' && (m = /^\/api\/requests\/(\d+)\/photo$/.exec(p))) return photo(Number(m[1]), headers, bytes, type)
  if (method === 'POST' && (m = /^\/api\/requests\/(\d+)\/me-too$/.exec(p))) return meToo(Number(m[1]), json)
  if (method === 'GET' && (m = /^\/api\/status\/([^/]+)$/.exec(p))) return status(decodeURIComponent(m[1]))
  return fail(404, 'not_found', 'The mock does not have that route.')
}

// For the M1 smoke script only (reading, never setting state).
export const peek = () => load()
