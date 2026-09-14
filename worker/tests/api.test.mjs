// API tests (M1) against a running Worker started with --var TEST_MODE:1 (tests/run.mjs does that).
// BASE defaults to http://127.0.0.1:8502. Every test resets first. The clock is pinned with X-Test-Now.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { POINTS } from './test-points.js'
import { pointInRing } from '../src/geo.js'
import { TOWN } from '../src/town-data.js'

const BASE = process.env.BASE || `http://127.0.0.1:${process.env.PORT || 8502}`
const T0 = '2026-09-07T13:15:00.000Z' // Mon Sep 7, 10:45 AM NDT
const DAY = 86400000
const HOUR = 3600000
const at = (base, ms) => new Date(Date.parse(base) + ms).toISOString()
const METRE_LAT = 1 / 111195.0797
const north = ([lat, lng], m) => [lat + m * METRE_LAT, lng]
const TOWN_NAME = 'SAMPLE Town of Harbour Pond (demo)'
const ROADS = 'Roads crew (SAMPLE)'

async function api (method, path, { body, token, now = T0, ip = '10.0.0.1', headers = {}, raw } = {}) {
  const res = await fetch(path.startsWith('http') ? path : BASE + path, {
    method,
    headers: {
      'X-Test-Now': now,
      'X-Test-IP': ip,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined
  })
  const buf = Buffer.from(await res.arrayBuffer())
  const text = buf.toString('utf8')
  let json
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, body: json, text, buf, headers: res.headers }
}

function expectError (r, status, code, field, error) {
  assert.equal(r.status, status, r.text)
  assert.equal(r.body.code, code, r.text)
  assert.equal(typeof r.body.error, 'string')
  if (field !== undefined) assert.equal(r.body.field, field, r.text)
  if (error !== undefined) assert.equal(r.body.error, error)
}

async function reset () {
  const r = await api('POST', '/api/test/reset')
  assert.equal(r.status, 200, r.text)
  return r.body
}

async function signin (now = T0) {
  const r = await api('POST', '/api/staff/signin', { body: { pin: '3690' }, now })
  assert.equal(r.status, 200, r.text)
  return r.body.token
}

const report = (over = {}) => ({
  submission_id: randomUUID(),
  device_id: randomUUID(),
  category: 'pothole',
  lat: POINTS.inside_centre[0],
  lng: POINTS.inside_centre[1],
  description: '',
  name: '',
  phone: '',
  has_photo: false,
  ...over
})
const at2 = ([lat, lng]) => ({ lat, lng })

async function create (over = {}, now = T0) {
  const body = report(over)
  const r = await api('POST', '/api/requests', { body, now })
  assert.equal(r.status, 201, r.text)
  return { ...r.body, submission: body }
}

async function list (token, query = '', now = T0) {
  const r = await api('GET', `/api/staff/requests${query}`, { token, now })
  assert.equal(r.status, 200, r.text)
  return r.body
}

async function detail (token, id, now = T0) {
  const r = await api('GET', `/api/staff/requests/${id}`, { token, now })
  assert.equal(r.status, 200, r.text)
  return r.body
}

async function put (token, id, body, now = T0) {
  return api('PUT', `/api/staff/requests/${id}`, { token, body, now })
}

async function putOk (token, id, changes, now = T0) {
  const current = await detail(token, id, now)
  const r = await put(token, id, { version: current.version, ...changes }, now)
  assert.equal(r.status, 200, r.text)
  return r.body
}

async function meToo (id, deviceId = randomUUID(), now = T0) {
  return api('POST', `/api/requests/${id}/me-too`, { body: { device_id: deviceId }, now })
}

async function status (url, now = T0) {
  return api('GET', url, { now })
}

const jpeg = size => {
  const b = randomBytes(size)
  b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff
  return b
}

async function upload (created, bytes, { type = 'image/jpeg', token = created.upload_token, now = T0 } = {}) {
  return api('PUT', created.upload_url, { raw: bytes, now, headers: { 'content-type': type, Authorization: `Bearer ${token}` } })
}

// ---- town ----

test('town shape', async () => {
  await reset()
  const r = await api('GET', '/api/town')
  assert.equal(r.status, 200)
  const t = r.body
  assert.equal(t.name, TOWN_NAME)
  assert.equal(t.sample, true)
  assert.equal(t.timezone, 'America/St_Johns')
  assert.equal(t.emergency_phone, '709-555-0142')
  assert.equal(t.office_phone, '709-555-0100')
  assert.equal(t.office_hours, 'Monday to Friday, 9 AM to 4:30 PM')
  assert.equal(t.map_style_url, 'https://tiles.openfreemap.org/styles/positron')
  assert.deepEqual(t.center, [49.1395, -55.352])
  assert.equal(t.zoom, 15)
  assert.ok(t.boundary.length >= 3 && t.boundary.every(p => p.length === 2))
  assert.deepEqual(t.categories.map(c => c.key), ['pothole', 'streetlight', 'snow', 'water', 'garbage', 'tree', 'other'])
  assert.deepEqual(t.categories[1], { key: 'streetlight', label: 'Streetlight out', hint: "A light that's out, flickering or on all day" })
  assert.deepEqual(t.wards, [
    { id: 'north', name: 'North Ward (SAMPLE)' }, { id: 'centre', name: 'Centre Ward (SAMPLE)' }, { id: 'south', name: 'South Ward (SAMPLE)' }
  ])
  assert.equal(t.streets.length, 67)
  const names = t.streets.map(s => s.name)
  assert.deepEqual(names, [...names].sort())
  assert.deepEqual(Object.keys(t.streets[0]).sort(), ['name', 'point'])
  assert.equal(t.nearby_metres, 50)
  assert.ok(!r.text.includes('polygon') && !r.text.includes('lines'))
})

test('town locate: the Worker\'s own inside, street label and ward for a pin', async () => {
  const locate = ([lat, lng]) => api('GET', `/api/town/locate?lat=${lat}&lng=${lng}`)
  let r = await locate(POINTS.inside_centre)
  assert.equal(r.status, 200, r.text)
  assert.equal(r.headers.get('cache-control'), 'no-store')
  assert.deepEqual(Object.keys(r.body).sort(), ['inside', 'location_label', 'ward'])
  assert.equal(r.body.inside, true)
  assert.equal(r.body.ward, 'centre')
  assert.equal(typeof r.body.location_label, 'string')

  r = await locate(POINTS.on_street.point)
  assert.deepEqual(r.body, { inside: true, location_label: 'Airbase Road', ward: 'north' })
  assert.equal(r.body.location_label, POINTS.on_street.street)

  r = await locate(POINTS.far_from_streets_inside.point)
  assert.deepEqual(r.body, { inside: true, location_label: 'Not near a named street', ward: 'south' })

  r = await locate(POINTS.outside_south)
  assert.equal(r.status, 200, r.text)
  assert.equal(r.body.inside, false)
  assert.equal(typeof r.body.location_label, 'string')
  assert.ok(r.body.location_label.length > 0)
  assert.equal((await locate(POINTS.outside_east_of_boundary)).body.inside, false)

  // the label is the one a report at that pin stores
  await reset()
  const c = await create({ ...at2(POINTS.on_street.point) })
  assert.equal(c.location_label, 'Airbase Road')

  const msg = 'Put a pin on the map where the problem is.'
  expectError(await api('GET', '/api/town/locate?lat=abc&lng=-55.352'), 400, 'bad_request', 'location', msg)
  expectError(await api('GET', '/api/town/locate?lat=49.14'), 400, 'bad_request', 'location', msg)
  expectError(await api('GET', '/api/town/locate?lat=&lng=-55.352'), 400, 'bad_request', 'location', msg)
})

// ---- create ----

test('create: a good report', async () => {
  await reset()
  const body = report({ ...at2(POINTS.on_street.point), description: 'Deep one', name: 'Pat (SAMPLE)', phone: '709-555-0187' })
  const r = await api('POST', '/api/requests', { body })
  assert.equal(r.status, 201, r.text)
  const c = r.body
  assert.equal(c.id, 1001)
  assert.equal(c.ref, 'HP-1001')
  assert.equal(c.location_label, POINTS.on_street.street)
  assert.equal(c.category_label, 'Pothole')
  assert.equal(c.reported_label, 'Mon Sep 7, 10:45 AM')
  assert.equal(c.duplicate, false)
  assert.equal(c.photo, 'none')
  assert.equal(c.upload_url, null)
  assert.equal(c.upload_token, null)
  assert.equal(c.upload_expires_at, null)
  const url = new URL(c.status_url)
  assert.equal(url.origin, new URL(BASE).origin)
  assert.equal(url.pathname, '/s/')
  assert.equal(url.searchParams.get('k'), c.status_key)
  assert.ok(c.status_key.length >= 22 && /^[A-Za-z0-9_-]+$/.test(c.status_key))

  const withPhoto = await create({ has_photo: true, ...at2(POINTS.far_from_streets_inside.point) })
  assert.equal(withPhoto.ref, 'HP-1002')
  assert.equal(withPhoto.location_label, 'Not near a named street')
  assert.equal(withPhoto.photo, 'waiting')
  assert.equal(withPhoto.upload_url, `${new URL(BASE).origin}/api/requests/1002/photo`)
  assert.ok(withPhoto.upload_token.length >= 22)
  assert.equal(withPhoto.upload_expires_at, at(T0, HOUR))

  const token = await signin()
  const d = await detail(token, 1001)
  assert.equal(d.status, 'new')
  assert.equal(d.ward, 'north')
  assert.equal(d.ward_name, 'North Ward (SAMPLE)')
  assert.equal(d.description, 'Deep one')
  assert.equal(d.reporter_name, 'Pat (SAMPLE)')
  assert.equal(d.reporter_phone, '709-555-0187')
  assert.equal(d.has_contact, true)
  assert.equal(d.lat, POINTS.on_street.point[0])
  assert.equal(d.created_at, T0)
  assert.equal(d.version, 1)
  assert.deepEqual(d.history.map(h => [h.kind, h.text, h.internal]), [['created', 'Reported', false]])
  const d2 = await detail(token, 1002)
  assert.equal(d2.description, null)
  assert.equal(d2.reporter_name, null)
  assert.equal(d2.reporter_phone, null)
  assert.equal(d2.has_contact, false)
  assert.equal(d2.photo, 'waiting')
  assert.equal(d2.photo_url, null)
})

async function expectCreateRefused (over, field, error) {
  await reset()
  const r = await api('POST', '/api/requests', { body: report(over) })
  expectError(r, 400, 'bad_request', field, error)
  const token = await signin()
  assert.equal((await list(token)).requests.length, 0)
}

const PHONE = 'Something went wrong on this phone. Reload the page and try again.'

test('create validation: submission_id', async () => {
  await expectCreateRefused({ submission_id: 'not-a-uuid' }, 'submission_id', PHONE)
  await expectCreateRefused({ submission_id: '9b2f6c1e-3c1a-1d2e-8f00-123456789abc' }, 'submission_id', PHONE) // v1, not v4
})

test('create validation: device_id', async () => {
  await expectCreateRefused({ device_id: 'phone-1' }, 'device_id', PHONE)
  const r = await api('POST', '/api/requests', { body: report({ device_id: undefined }) })
  assert.equal(r.status, 201, r.text)
})

test('create validation: category', async () => {
  await expectCreateRefused({ category: 'volcano' }, 'category', 'Pick what kind of problem it is.')
})

test('create validation: location', async () => {
  await expectCreateRefused({ lat: '49.14' }, 'location', 'Put a pin on the map where the problem is.')
  await expectCreateRefused({ lng: null }, 'location', 'Put a pin on the map where the problem is.')
})

test('create validation: description', async () => {
  await expectCreateRefused({ description: 'x'.repeat(501) }, 'description', 'Keep it under 500 characters.')
  await expectCreateRefused({ category: 'other', description: '   ' }, 'description', 'Tell us what the problem is.')
  const ok = await api('POST', '/api/requests', { body: report({ category: 'other', description: `  ${'y'.repeat(500)}  ` }) })
  assert.equal(ok.status, 201, ok.text)
})

test('create validation: name', async () => {
  await expectCreateRefused({ name: 'n'.repeat(81) }, 'name', 'Keep your name under 80 characters.')
  const ok = await api('POST', '/api/requests', { body: report({ name: ` ${'n'.repeat(80)} ` }) })
  assert.equal(ok.status, 201, ok.text)
})

test('create validation: phone', async () => {
  const msg = "That phone number doesn't look right. Leave it blank if you'd rather not say."
  await expectCreateRefused({ phone: '555-01' }, 'phone', msg) // 5 digits
  await expectCreateRefused({ phone: '1234567890123456' }, 'phone', msg) // 16 digits
  await expectCreateRefused({ phone: '709-555-01AB' }, 'phone', msg)
  const long = `709.555.0187${'.'.repeat(19)}` // 10 digits but 31 characters
  assert.equal(long.length, 31)
  await expectCreateRefused({ phone: long }, 'phone', msg)
  const ok = await api('POST', '/api/requests', { body: report({ phone: '+1 (709) 555-0187' }) })
  assert.equal(ok.status, 201, ok.text)
})

test('create validation: has_photo', async () => {
  await expectCreateRefused({ has_photo: 'yes' }, 'has_photo', PHONE)
})

test('create: a pin outside the boundary is refused and no request is created', async () => {
  for (const point of [POINTS.outside_south, POINTS.outside_east_of_boundary]) {
    await reset()
    const r = await api('POST', '/api/requests', { body: report(at2(point)) })
    expectError(r, 400, 'outside_boundary', 'location', 'That spot is outside the town. Move the pin inside the line on the map.')
    const token = await signin()
    const l = await list(token)
    assert.equal(l.requests.length, 0)
    assert.deepEqual(l.counts, { new: 0, assigned: 0, in_progress: 0, done: 0, wont_fix: 0 })
  }
})

test('create: the same submission_id twice makes exactly one request', async () => {
  await reset()
  const body = report({ has_photo: true })
  const first = await api('POST', '/api/requests', { body })
  assert.equal(first.status, 201, first.text)
  const second = await api('POST', '/api/requests', { body })
  assert.equal(second.status, 200, second.text)
  assert.equal(second.body.duplicate, true)
  assert.equal(second.body.id, first.body.id)
  assert.equal(second.body.ref, first.body.ref)
  assert.equal(second.body.status_key, first.body.status_key)
  assert.equal(second.body.photo, 'waiting')
  assert.notEqual(second.body.upload_token, first.body.upload_token)
  const token = await signin()
  const l = await list(token)
  assert.equal(l.requests.length, 1)
  assert.equal(l.counts.new, 1)

  // A fresh upload token replaces the first one.
  expectError(await upload(first.body, jpeg(100)), 401, 'unauthorized')
  assert.equal((await upload(second.body, jpeg(100))).status, 200)
  const third = await api('POST', '/api/requests', { body })
  assert.equal(third.status, 200)
  assert.equal(third.body.photo, 'stored')
  assert.equal(third.body.upload_token, null)
  assert.equal(third.body.upload_url, null)
})

// ---- photo ----

test('photo: a jpeg with the token is stored and served back', async () => {
  await reset()
  const c = await create({ has_photo: true })
  const bytes = jpeg(4096)
  const r = await upload(c, bytes)
  assert.equal(r.status, 200, r.text)
  assert.deepEqual(r.body, { photo: 'stored' })
  const again = await upload(c, jpeg(10))
  assert.equal(again.status, 200)
  assert.deepEqual(again.body, { photo: 'stored', duplicate: true })

  const token = await signin()
  const d = await detail(token, c.id)
  assert.equal(d.photo, 'stored')
  assert.equal(d.has_photo, true)
  assert.match(d.photo_url, new RegExp(`^${new URL(BASE).origin}/api/photos/[A-Za-z0-9_-]{22,}$`))
  assert.deepEqual(d.history.map(h => [h.text, h.internal]), [['Reported', false], ['Photo added', true]])
  const p = await api('GET', d.photo_url)
  assert.equal(p.status, 200)
  assert.equal(p.headers.get('content-type'), 'image/jpeg')
  assert.equal(p.headers.get('cache-control'), 'private, max-age=86400')
  assert.equal(p.headers.get('referrer-policy'), 'no-referrer')
  assert.ok(p.buf.equals(bytes), 'the first photo is kept byte for byte')
  expectError(await api('GET', '/api/photos/nope'), 404, 'not_found')
})

test('photo: wrong token 401, too large 413, wrong type 415, expired 401, unknown id 404', async () => {
  await reset()
  const c = await create({ has_photo: true })
  expectError(await upload(c, jpeg(10), { token: 'wrong' }), 401, 'unauthorized', undefined, 'This photo link has expired. Your report was still sent.')
  const other = await create({ has_photo: true })
  expectError(await upload(c, jpeg(10), { token: other.upload_token }), 401, 'unauthorized') // another report's token
  expectError(await upload(c, jpeg(5000001)), 413, 'too_large', undefined, 'That photo is too big. Try another or skip the photo.')
  expectError(await upload(c, Buffer.from('hello'), { type: 'text/plain' }), 415, 'unsupported_photo', undefined, "That kind of file can't be used. Take a photo or pick a JPEG or PNG.")
  expectError(await upload(c, jpeg(10), { type: 'image/gif' }), 415, 'unsupported_photo')
  expectError(await upload(c, jpeg(10), { now: at(T0, HOUR) }), 401, 'unauthorized') // expires 1 hour after issue
  assert.equal((await upload(c, Buffer.alloc(5000000, 1), { type: 'image/png', now: at(T0, HOUR - 1) })).status, 200)
  expectError(await api('PUT', '/api/requests/9999/photo', { raw: jpeg(10), headers: { 'content-type': 'image/jpeg' } }), 404, 'not_found')
  const token = await signin()
  assert.equal((await detail(token, c.id)).photo, 'stored')
})

// ---- nearby ----

test('nearby: a pothole at 40 m is found and one at 60 m is not', async () => {
  await reset()
  const p = POINTS.inside_centre
  const at40 = await create({ ...at2(north(p, 40)) })
  await create({ ...at2(north(p, 60)) })
  await create({ category: 'streetlight', ...at2(north(p, 10)) })
  const closed = await create({ ...at2(north(p, 10)) })
  const token = await signin()
  await putOk(token, closed.id, { status: 'done' })
  await meToo(at40.id)

  const r = await api('GET', `/api/requests/nearby?category=pothole&lat=${p[0]}&lng=${p[1]}`, { now: at(T0, 2 * DAY) })
  assert.equal(r.status, 200, r.text)
  assert.equal(r.body.metres, 50)
  assert.deepEqual(r.body.requests, [{
    id: at40.id, ref: at40.ref, category: 'pothole', category_label: 'Pothole', location_label: at40.location_label,
    status: 'new', status_label: 'New', reported_label: 'Mon Sep 7', distance_m: 40, plus_ones: 1
  }])

  const lights = await api('GET', `/api/requests/nearby?category=streetlight&lat=${p[0]}&lng=${p[1]}`)
  assert.deepEqual(lights.body.requests.map(x => x.distance_m), [10])
})

test('nearby: bad input', async () => {
  await reset()
  const p = POINTS.inside_centre
  expectError(await api('GET', `/api/requests/nearby?category=volcano&lat=${p[0]}&lng=${p[1]}`), 400, 'bad_request', 'category')
  expectError(await api('GET', `/api/requests/nearby?category=pothole&lat=&lng=${p[1]}`), 400, 'bad_request', 'location')
  expectError(await api('GET', '/api/requests/nearby?category=pothole&lat=49.1&lng=-55.352'), 400, 'outside_boundary', 'location')
})

// ---- me too ----

test('me-too: once per device, the reporter counts as added, closed reports refuse', async () => {
  await reset()
  const c = await create()
  const phone = randomUUID()
  const r1 = await meToo(c.id, phone)
  assert.equal(r1.status, 201, r1.text)
  assert.deepEqual(r1.body, { ref: c.ref, plus_ones: 1, status_url: c.status_url, duplicate: false })
  const r2 = await meToo(c.id, phone)
  assert.equal(r2.status, 200)
  assert.deepEqual(r2.body, { ref: c.ref, plus_ones: 1, status_url: c.status_url, duplicate: true })
  const own = await meToo(c.id, c.submission.device_id)
  assert.equal(own.status, 200)
  assert.equal(own.body.duplicate, true)
  assert.equal(own.body.plus_ones, 1)
  expectError(await api('POST', `/api/requests/${c.id}/me-too`, { body: { device_id: 'x' } }), 400, 'bad_request', 'device_id')
  expectError(await meToo(9999), 404, 'not_found')

  const token = await signin()
  const d = await putOk(token, c.id, { status: 'done' })
  assert.equal(d.version, 2, 'me-too does not bump the version')
  expectError(await meToo(c.id), 409, 'bad_state', undefined, 'This report is already closed.')
  const after = await detail(token, c.id)
  assert.equal(after.plus_ones, 1)
  assert.deepEqual(after.history.map(h => h.text), ['Reported', 'Someone else reported it too (+1)', 'Marked done'])
})

// ---- public status ----

test('public status never contains private fields', async () => {
  await reset()
  const secret = {
    name: 'Zebediah Quillfeather (SAMPLE)',
    phone: '709-555-0199',
    description: 'MARMOSET by the hydrant',
    note: 'PANGOLIN internal note',
    lat: 49.13957713,
    lng: -55.35193317
  }
  const c = await create({ has_photo: true, description: secret.description, name: secret.name, phone: secret.phone, lat: secret.lat, lng: secret.lng })
  assert.equal((await upload(c, jpeg(64))).status, 200)
  const token = await signin()
  await putOk(token, c.id, { crew_id: 1, public_message: 'The roads crew is booked for Thursday.' })
  const noted = await api('POST', `/api/staff/requests/${c.id}/notes`, { token, body: { text: secret.note } })
  assert.equal(noted.status, 201)
  await meToo(c.id)
  const d = await detail(token, c.id)
  const photoKey = d.photo_url.split('/').pop()

  const r = await status(`/api/status/${c.status_key}`)
  assert.equal(r.status, 200, r.text)
  assert.equal(r.headers.get('cache-control'), 'no-store')
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer')
  const forbidden = [secret.name, 'Zebediah', secret.phone, '7095550199', '555-0199', secret.description, 'MARMOSET', secret.note, 'PANGOLIN',
    ROADS, 'Roads crew', photoKey, '/api/photos', '49.13957', '55.35193', c.submission.submission_id, c.submission.device_id,
    '"lat"', '"lng"', 'reporter', 'description', 'crew_', 'photo', 'device', 'submission', 'note']
  for (const s of forbidden) assert.ok(!r.text.includes(s), `status must not contain ${JSON.stringify(s)}`)

  const s = r.body
  assert.deepEqual(s.town, { name: TOWN_NAME, sample: true, office_phone: '709-555-0100' })
  assert.equal(s.ref, c.ref)
  assert.equal(s.category, 'pothole')
  assert.equal(s.category_label, 'Pothole')
  assert.equal(s.location_label, c.location_label)
  assert.equal(s.status, 'assigned')
  assert.equal(s.status_label, 'Assigned')
  assert.equal(s.public_message, 'The roads crew is booked for Thursday.')
  assert.equal(s.plus_ones, 1)
  assert.equal(s.reported_at, T0)
  assert.equal(s.reported_label, 'Mon Sep 7, 10:45 AM')
  assert.equal(s.closed_at, null)
  assert.equal(s.merged_into, null)
  assert.deepEqual(s.history.map(h => h.text), [
    'Reported', 'Assigned to a crew', 'Message from the town: The roads crew is booked for Thursday.', 'Someone else reported it too'
  ])
  assert.equal(s.history[0].at_label, 'Mon Sep 7, 10:45 AM')
  assert.equal(s.updated_at, T0)
  assert.deepEqual(Object.keys(s).sort(), ['category', 'category_label', 'closed_at', 'closed_label', 'history', 'location_label', 'merged_into',
    'plus_ones', 'public_message', 'ref', 'reported_at', 'reported_label', 'status', 'status_label', 'town', 'updated_at', 'updated_label'])
})

test('public status: unknown key 404 and updated_at follows public entries only', async () => {
  await reset()
  const r = await status('/api/status/not-a-real-key')
  expectError(r, 404, 'not_found', undefined, "We can't find that report. Check the link, or call the town office.")
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer')

  const c = await create()
  const token = await signin()
  await api('POST', `/api/staff/requests/${c.id}/notes`, { token, body: { text: 'later note' }, now: at(T0, DAY) })
  const s1 = await status(`/api/status/${c.status_key}`)
  assert.equal(s1.body.updated_at, T0)
  await putOk(await signin(at(T0, 2 * DAY)), c.id, { status: 'done' }, at(T0, 2 * DAY))
  const s2 = await status(`/api/status/${c.status_key}`)
  assert.equal(s2.body.updated_at, at(T0, 2 * DAY))
  assert.equal(s2.body.closed_at, at(T0, 2 * DAY))
  assert.equal(s2.body.closed_label, 'Wed Sep 9, 10:45 AM')
})

// ---- staff ----

test('staff: wrong PIN 401 field pin, no token 401, sign out ends the session', async () => {
  await reset()
  expectError(await api('POST', '/api/staff/signin', { body: { pin: '1234' } }), 401, 'unauthorized', 'pin', 'That PIN is not right.')
  expectError(await api('POST', '/api/staff/signin', { body: {} }), 401, 'unauthorized', 'pin')
  expectError(await api('GET', '/api/staff/requests'), 401, 'unauthorized', undefined, 'Sign in again.')
  expectError(await api('GET', '/api/staff/requests', { token: 'made-up' }), 401, 'unauthorized')
  const r = await api('POST', '/api/staff/signin', { body: { pin: '3690' } })
  assert.equal(r.status, 200)
  assert.equal(r.body.expires_at, at(T0, 12 * HOUR))
  const token = r.body.token
  assert.equal((await api('GET', '/api/staff/crews', { token, now: at(T0, 12 * HOUR - 1) })).status, 200)
  expectError(await api('GET', '/api/staff/crews', { token, now: at(T0, 12 * HOUR) }), 401, 'unauthorized')
  const out = await api('POST', '/api/staff/signout', { token })
  assert.deepEqual(out.body, { ok: true })
  expectError(await api('GET', '/api/staff/crews', { token }), 401, 'unauthorized')
})

test('staff: crews and settings', async () => {
  const seeded = await reset()
  assert.equal(seeded.pin, '3690')
  const token = await signin()
  await create()
  await putOk(token, 1001, { crew_id: 1 })
  const crews = await api('GET', '/api/staff/crews', { token })
  assert.deepEqual(crews.body.crews, [
    { id: 1, name: ROADS, active: true, open_count: 1 },
    { id: 2, name: 'Water and sewer crew (SAMPLE)', active: true, open_count: 0 },
    { id: 3, name: 'Parks and trees crew (SAMPLE)', active: true, open_count: 0 }
  ])
  assert.deepEqual(seeded.crews.map(c => c.name), crews.body.crews.map(c => c.name))
  const s = await api('GET', '/api/staff/settings', { token })
  assert.deepEqual(s.body, {
    town_name: TOWN_NAME,
    emergency_phone: '709-555-0142',
    office_phone: '709-555-0100',
    office_hours: 'Monday to Friday, 9 AM to 4:30 PM',
    sla_days: { pothole: 14, streetlight: 10, snow: 2, water: 3, garbage: 3, tree: 5, other: 14 }
  })
})

test('staff list: filters and counts', async () => {
  await reset()
  const token = await signin()
  const south = [49.125, -55.35]
  const r1 = await create({ category: 'pothole' }, at(T0, -20 * DAY)) // centre, overdue by 6 days
  const r2 = await create({ category: 'streetlight', ...at2(POINTS.on_street.point) }, at(T0, -2 * DAY)) // north
  const r3 = await create({ category: 'snow', ...at2(south) }, at(T0, -1 * DAY)) // south, done
  const r4 = await create({ category: 'garbage' }, at(T0, -5 * DAY)) // centre, won't fix
  const r5 = await create({ category: 'pothole', ...at2(south) }) // south, new today
  await putOk(token, r2.id, { crew_id: 2 })
  await putOk(token, r3.id, { status: 'done' }, at(T0, -12 * HOUR))
  await putOk(token, r4.id, { status: 'wont_fix', public_message: 'That street is private (SAMPLE).' })

  const ids = l => l.requests.map(x => x.id)
  const all = await list(token)
  assert.deepEqual(ids(all), [r1.id, r4.id, r2.id, r3.id, r5.id])
  assert.deepEqual(all.counts, { new: 2, assigned: 1, in_progress: 0, done: 1, wont_fix: 1 })
  assert.equal(all.now, T0)
  assert.equal(all.now_label, 'Mon Sep 7, 10:45 AM')

  const one = all.requests[0]
  assert.equal(one.age_days, 20)
  assert.equal(one.overdue, true)
  assert.equal(one.overdue_days, 6)
  assert.equal(one.due_at, at(T0, -6 * DAY))
  assert.equal(one.due_label, 'Tue Sep 1')
  assert.equal(one.ward, 'centre')
  const closed = all.requests.find(x => x.id === r3.id)
  assert.equal(closed.closed_at, at(T0, -12 * HOUR))
  assert.equal(closed.days_to_close, 0.5)
  assert.equal(closed.overdue, false)
  assert.equal(all.requests.find(x => x.id === r2.id).crew_name, 'Water and sewer crew (SAMPLE)')

  assert.deepEqual(ids(await list(token, '?status=open')), [r1.id, r2.id, r5.id])
  assert.deepEqual(ids(await list(token, '?status=closed')), [r4.id, r3.id])
  assert.deepEqual(ids(await list(token, '?status=assigned')), [r2.id])
  const potholes = await list(token, '?category=pothole')
  assert.deepEqual(ids(potholes), [r1.id, r5.id])
  assert.deepEqual(potholes.counts, { new: 2, assigned: 0, in_progress: 0, done: 0, wont_fix: 0 })
  const southWard = await list(token, '?ward=south')
  assert.deepEqual(ids(southWard), [r3.id, r5.id])
  assert.deepEqual(southWard.counts, { new: 1, assigned: 0, in_progress: 0, done: 1, wont_fix: 0 })
  const old = await list(token, '?min_age_days=5')
  assert.deepEqual(ids(old), [r1.id, r4.id])
  assert.deepEqual(old.counts, { new: 1, assigned: 0, in_progress: 0, done: 0, wont_fix: 1 })
  const overdue = await list(token, '?overdue=1')
  assert.deepEqual(ids(overdue), [r1.id])
  assert.deepEqual(overdue.counts, { new: 1, assigned: 0, in_progress: 0, done: 0, wont_fix: 0 })
  const combined = await list(token, '?status=closed&ward=south&min_age_days=1')
  assert.deepEqual(ids(combined), [r3.id])
  assert.deepEqual(combined.counts, { new: 0, assigned: 0, in_progress: 0, done: 1, wont_fix: 0 })
  assert.deepEqual(ids(await list(token, '?status=&category=&overdue=')), ids(all))

  for (const [q, field] of [['status=bogus', 'status'], ['category=volcano', 'category'], ['ward=east', 'ward'], ['min_age_days=-1', 'min_age_days'],
    ['min_age_days=1.5', 'min_age_days'], ['overdue=yes', 'overdue']]) {
    expectError(await api('GET', `/api/staff/requests?${q}`, { token }), 400, 'bad_request', field)
  }
})

test('overdue on a fake clock through the API', async () => {
  await reset()
  const T = '2026-10-05T12:00:00.000Z'
  const c = await create({ category: 'streetlight' }, T)

  const early = at(T, 9 * DAY + 23 * HOUR)
  let token = await signin(early)
  let d = await detail(token, c.id, early)
  assert.equal(d.overdue, false)
  assert.equal(d.overdue_days, 0)
  assert.equal(d.due_at, at(T, 10 * DAY))
  assert.equal((await list(token, '?overdue=1', early)).requests.length, 0)

  const late = at(T, 10 * DAY + HOUR)
  token = await signin(late)
  d = await detail(token, c.id, late)
  assert.equal(d.overdue, true)
  assert.equal(d.overdue_days, 1)
  assert.deepEqual((await list(token, '?overdue=1', late)).requests.map(x => x.id), [c.id])

  const done = await put(token, c.id, { version: d.version, status: 'done' }, late)
  assert.equal(done.status, 200, done.text)
  assert.equal(done.body.overdue, false)
  assert.equal(done.body.overdue_days, 0)
  assert.equal(done.body.closed_at, late)
  assert.equal(done.body.days_to_close, 10)
  assert.equal((await list(token, '?overdue=1', late)).requests.length, 0)
})

test('PUT: assigning a crew moves new to assigned, and history texts are exact', async () => {
  await reset()
  const c = await create()
  const token = await signin()
  const T1 = at(T0, HOUR)
  const r = await put(token, c.id, { version: 1, crew_id: 1 }, T1)
  assert.equal(r.status, 200, r.text)
  assert.equal(r.body.status, 'assigned')
  assert.equal(r.body.crew_id, 1)
  assert.equal(r.body.crew_name, ROADS)
  assert.equal(r.body.version, 2)

  const same = await put(token, c.id, { version: 2, crew_id: 1, status: 'assigned', public_message: '' }, T1)
  assert.equal(same.status, 200)
  assert.equal(same.body.version, 2, 'nothing changed: same version')

  let d = await putOk(token, c.id, { status: 'in_progress', public_message: '  Booked for Thursday.  ' }, at(T0, 2 * HOUR))
  assert.equal(d.public_message, 'Booked for Thursday.')
  d = await putOk(token, c.id, { public_message: '' }, at(T0, 3 * HOUR))
  assert.equal(d.public_message, null)
  d = await putOk(token, c.id, { status: 'new', crew_id: null }, at(T0, 4 * HOUR))
  assert.equal(d.crew_id, null)
  d = await putOk(token, c.id, { status: 'wont_fix', public_message: 'Private road (SAMPLE).' }, at(T0, 5 * HOUR))
  assert.equal(d.version, 6)
  assert.deepEqual(d.history.map(h => [h.kind, h.text, h.internal]), [
    ['created', 'Reported', false],
    ['crew', `Crew: ${ROADS}`, true],
    ['status', 'Assigned', false],
    ['status', 'Work started', false],
    ['message', 'Public message: Booked for Thursday.', false],
    ['message', 'Public message removed', true],
    ['crew', 'Crew removed', true],
    ['status', 'Reopened', false],
    ['status', 'Closed without a fix', false],
    ['message', 'Public message: Private road (SAMPLE).', false]
  ])
  assert.equal(d.history[1].at, T1)
  assert.equal(d.history[1].at_label, 'Mon Sep 7, 11:45 AM')
  const s = await status(`/api/status/${c.status_key}`)
  assert.deepEqual(s.body.history.map(h => h.text), [
    'Reported', 'Assigned to a crew', 'Work started', 'Message from the town: Booked for Thursday.', 'Reopened', 'Closed without a fix',
    'Message from the town: Private road (SAMPLE).'
  ])
})

test('PUT: validation', async () => {
  await reset()
  const c = await create()
  const token = await signin()
  expectError(await put(token, c.id, { version: 1, status: 'assigned' }), 400, 'bad_request', 'crew_id', 'Pick a crew first.')
  expectError(await put(token, c.id, { version: 1, status: 'wont_fix' }), 400, 'bad_request', 'public_message', 'Say why in the message to the public.')
  expectError(await put(token, c.id, { version: 1, status: 'wont_fix', public_message: '   ' }), 400, 'bad_request', 'public_message')
  expectError(await put(token, c.id, { version: 1, status: 'merged' }), 400, 'bad_request', 'status', 'Pick a status.')
  expectError(await put(token, c.id, { version: 1, crew_id: 99 }), 400, 'bad_request', 'crew_id', 'Pick one of the crews.')
  expectError(await put(token, c.id, { version: 1, crew_id: '1' }), 400, 'bad_request', 'crew_id')
  expectError(await put(token, c.id, { version: 1, public_message: 'm'.repeat(501) }), 400, 'bad_request', 'public_message', 'Keep the message under 500 characters.')
  expectError(await put(token, c.id, { status: 'done' }), 400, 'bad_request', 'version')
  expectError(await put(token, 9999, { version: 1 }), 404, 'not_found')
  const d = await detail(token, c.id)
  assert.equal(d.version, 1)
  assert.equal(d.history.length, 1)
  // in_progress with a crew in the same body is fine
  const ok = await put(token, c.id, { version: 1, status: 'in_progress', crew_id: 3 })
  assert.equal(ok.status, 200, ok.text)
  assert.deepEqual(ok.body.history.map(h => h.text), ['Reported', 'Crew: Parks and trees crew (SAMPLE)', 'Work started'])
})

test('PUT: a stale version is 409 with the current request', async () => {
  await reset()
  const c = await create()
  const token = await signin()
  await putOk(token, c.id, { crew_id: 1 })
  const r = await put(token, c.id, { version: 1, status: 'done' })
  expectError(r, 409, 'stale', undefined, 'Someone else changed this report. Reload to see their change.')
  assert.equal(r.body.request.id, c.id)
  assert.equal(r.body.request.version, 2)
  assert.equal(r.body.request.status, 'assigned')
  assert.equal(r.body.request.crew_name, ROADS)
})

test('PUT: closed_at is set when closed, kept from done to won\'t fix, and cleared when reopened', async () => {
  await reset()
  const c = await create()
  const when = days => at(T0, days * DAY)
  let d = await putOk(await signin(when(3.25)), c.id, { status: 'done' }, when(3.25))
  assert.equal(d.closed_at, at(T0, 3.25 * DAY))
  assert.equal(d.days_to_close, 3.3)
  assert.equal(d.closed_label, 'Thu Sep 10, 4:45 PM')
  d = await putOk(await signin(when(4)), c.id, { status: 'wont_fix', public_message: 'Duplicate of a town project (SAMPLE).' }, when(4))
  assert.equal(d.closed_at, at(T0, 3.25 * DAY))
  d = await putOk(await signin(when(5)), c.id, { status: 'new' }, when(5))
  assert.equal(d.closed_at, null)
  assert.equal(d.closed_label, null)
  assert.equal(d.days_to_close, null)
})

test('notes: internal in staff history, never on the status page, and no version change', async () => {
  await reset()
  const c = await create()
  const token = await signin()
  expectError(await api('POST', `/api/staff/requests/${c.id}/notes`, { token, body: { text: '   ' } }), 400, 'bad_request', 'text', 'Write the note first.')
  expectError(await api('POST', `/api/staff/requests/${c.id}/notes`, { token, body: { text: 'n'.repeat(1001) } }), 400, 'bad_request', 'text')
  const r = await api('POST', `/api/staff/requests/${c.id}/notes`, { token, body: { text: '  Resident says it is by the church (OCELOT)  ' } })
  assert.equal(r.status, 201, r.text)
  assert.equal(r.body.version, 1)
  assert.deepEqual(r.body.history.at(-1), { at: T0, at_label: 'Mon Sep 7, 10:45 AM', kind: 'note', text: 'Resident says it is by the church (OCELOT)', internal: true })
  const s = await status(`/api/status/${c.status_key}`)
  assert.ok(!s.text.includes('OCELOT'))
  assert.deepEqual(s.body.history.map(h => h.text), ['Reported'])
  expectError(await api('POST', '/api/staff/requests/9999/notes', { token, body: { text: 'x' } }), 404, 'not_found')
})

test('candidates: other open reports of the same category within 200 m', async () => {
  await reset()
  const p = POINTS.inside_centre
  const a = await create({ ...at2(p) })
  const near = await create({ ...at2(north(p, 150)) })
  const nearer = await create({ ...at2(north(p, 30)) })
  await create({ ...at2(north(p, 210)) })
  await create({ category: 'tree', ...at2(north(p, 5)) })
  const done = await create({ ...at2(north(p, 20)) })
  const token = await signin()
  await putOk(token, done.id, { status: 'done' })
  const r = await api('GET', `/api/staff/requests/${a.id}/candidates`, { token })
  assert.equal(r.status, 200, r.text)
  assert.deepEqual(r.body.requests.map(x => [x.id, x.distance_m]), [[nearer.id, 30], [near.id, 150]])
  assert.equal(r.body.requests[0].ref, nearer.ref)
  assert.equal(r.body.requests[0].version, 1)
})

test('merge keeps the +1 count', async () => {
  await reset()
  const p = POINTS.inside_centre
  const A = await create({ ...at2(p) })
  const B = await create({ ...at2(north(p, 20)) })
  const C = await create({ ...at2(north(p, 30)) })
  const D = await create({ ...at2(north(p, 40)) })
  for (let i = 0; i < 2; i++) assert.equal((await meToo(A.id)).status, 201)
  for (let i = 0; i < 3; i++) assert.equal((await meToo(B.id)).status, 201)
  assert.equal((await meToo(D.id)).status, 201)
  const token = await signin()
  const merge = (from, into) => api('POST', `/api/staff/requests/${from}/merge`, { token, body: { into_id: into } })

  let r = await merge(B.id, A.id)
  assert.equal(r.status, 200, r.text)
  assert.equal(r.body.request.id, A.id)
  assert.equal(r.body.request.plus_ones, 6)
  assert.equal(r.body.request.merged_count, 1)
  assert.equal(r.body.request.history.at(-1).text, `Joined in ${B.ref} (+4)`)
  assert.equal(r.body.merged.id, B.id)
  assert.equal(r.body.merged.status, 'merged')
  assert.equal(r.body.merged.status_label, 'Joined with another report')
  assert.deepEqual(r.body.merged.merged_into, { id: A.id, ref: A.ref })
  assert.equal(r.body.merged.merged_into_ref, A.ref)
  assert.equal(r.body.merged.closed_at, T0)
  assert.equal(r.body.merged.history.at(-1).text, `Joined with ${A.ref}`)
  let bStatus = await status(`/api/status/${B.status_key}`)
  assert.deepEqual(bStatus.body.merged_into, { ref: A.ref, status_url: A.status_url })
  assert.equal(bStatus.body.history.at(-1).text, `Joined with ${A.ref}`)
  assert.equal((await status(`/api/status/${A.status_key}`)).body.history.at(-1).text, 'Another report of the same problem was joined to this one')

  r = await merge(C.id, A.id)
  assert.equal(r.status, 200, r.text)
  assert.equal(r.body.request.plus_ones, 7)

  r = await merge(A.id, D.id)
  assert.equal(r.status, 200, r.text)
  assert.equal(r.body.request.plus_ones, 9)
  assert.equal(r.body.request.history.at(-1).text, `Joined in ${A.ref} (+8)`)
  assert.deepEqual(r.body.request.merged.map(m => m.id).sort(), [A.id, B.id, C.id].sort())
  assert.equal(r.body.request.merged_count, 3)
  for (const x of [B, C, A]) assert.deepEqual((await detail(token, x.id)).merged_into, { id: D.id, ref: D.ref })
  bStatus = await status(`/api/status/${B.status_key}`)
  assert.deepEqual(bStatus.body.merged_into, { ref: D.ref, status_url: D.status_url })
  assert.equal((await detail(token, D.id)).copy_update.includes('We have your report.'), true)
  assert.ok((await detail(token, A.id)).copy_update.includes(`It was joined with report ${D.ref}.`))

  // the default list leaves merged requests out
  assert.deepEqual((await list(token)).requests.map(x => x.id), [D.id])
  assert.deepEqual((await list(token, '?status=merged')).requests.map(x => x.id), [A.id, B.id, C.id])
})

test('merge: into itself 400, into a merged report 409, an already merged source 409, merged reports refuse changes', async () => {
  await reset()
  const A = await create()
  const B = await create()
  const C = await create()
  const token = await signin()
  const merge = (from, into) => api('POST', `/api/staff/requests/${from}/merge`, { token, body: { into_id: into } })
  expectError(await merge(A.id, A.id), 400, 'bad_request', 'into_id', 'Pick a different report to join it with.')
  expectError(await merge(A.id, 9999), 404, 'not_found')
  expectError(await merge(9999, A.id), 404, 'not_found')
  assert.equal((await merge(B.id, A.id)).status, 200)
  expectError(await merge(C.id, B.id), 409, 'bad_state', undefined, `${B.ref} was itself joined with ${A.ref}. Join with ${A.ref} instead.`)
  expectError(await merge(B.id, C.id), 409, 'bad_state', undefined, `This report was already joined with ${A.ref}.`)
  const b = await detail(token, B.id)
  expectError(await put(token, B.id, { version: b.version, status: 'new' }), 409, 'bad_state', undefined, `This report was joined with ${A.ref}. Change that one instead.`)
  expectError(await meToo(B.id), 409, 'bad_state')
  // a closed target is allowed, and a closed source keeps its closed_at
  await putOk(await signin(at(T0, DAY)), C.id, { status: 'done' }, at(T0, DAY))
  const D = await create()
  await putOk(await signin(at(T0, 2 * DAY)), D.id, { status: 'done' }, at(T0, 2 * DAY))
  const later = await signin(at(T0, 3 * DAY))
  const r = await api('POST', `/api/staff/requests/${D.id}/merge`, { token: later, body: { into_id: C.id }, now: at(T0, 3 * DAY) })
  assert.equal(r.status, 200, r.text)
  assert.equal(r.body.merged.closed_at, at(T0, 2 * DAY))
  assert.equal(r.body.request.plus_ones, 1)
})

test('copy_update text exact for assigned with a message', async () => {
  await reset()
  const c = await create({ ...at2(POINTS.on_street.point) })
  const token = await signin()
  const d = await putOk(token, c.id, { crew_id: 1, public_message: 'Crew booked for Thursday, weather permitting.' })
  assert.equal(d.copy_update, `${TOWN_NAME}: update on your report HP-1001 (Pothole, ${POINTS.on_street.street}). A crew has been assigned. ` +
    `Message from the town: Crew booked for Thursday, weather permitting. Follow it here: ${c.status_url}`)
  const fresh = await create()
  assert.equal((await detail(token, fresh.id)).copy_update,
    `${TOWN_NAME}: update on your report ${fresh.ref} (Pothole, ${fresh.location_label}). We have your report. Follow it here: ${fresh.status_url}`)
})

test('PUT: re-sending the current crew of a new request is no change (clarification 10)', async () => {
  await reset()
  const c = await create()
  const token = await signin()
  await putOk(token, c.id, { crew_id: 1 })
  const reopened = await putOk(token, c.id, { status: 'new' })
  assert.equal(reopened.crew_id, 1)
  const r = await put(token, c.id, { version: reopened.version, crew_id: 1 })
  assert.equal(r.status, 200, r.text)
  assert.equal(r.body.status, 'new')
  assert.equal(r.body.version, reopened.version)
  const moved = await put(token, c.id, { version: reopened.version, crew_id: 2 })
  assert.equal(moved.body.status, 'assigned')
})

test('a malformed escape in a key is a 404, not a 500 (clarification 11)', async () => {
  await reset()
  expectError(await api('GET', '/api/status/%E0%A4%A'), 404, 'not_found', undefined, "We can't find that report. Check the link, or call the town office.")
  expectError(await api('GET', '/api/photos/%E0%A4%A'), 404, 'not_found', undefined, "We can't find that photo.")
})

// ---- M2: PIN, crews, settings ----

test('PIN change: the old PIN is refused after, the new one works, other sessions keep working', async () => {
  await reset()
  const a = await signin()
  const b = await signin()
  const change = (token, body) => api('PUT', '/api/staff/pin', { token, body })
  expectError(await api('PUT', '/api/staff/pin', { body: { current_pin: '3690', new_pin: '2468' } }), 401, 'unauthorized', undefined, 'Sign in again.')
  for (const bad of ['123', '123456789', '12a4', 2468, '', ' 2468']) {
    expectError(await change(a, { current_pin: '3690', new_pin: bad }), 400, 'bad_request', 'new_pin', 'Use 4 to 8 digits.')
  }
  expectError(await change(a, { current_pin: '1111', new_pin: '2468' }), 401, 'unauthorized', 'current_pin', 'That PIN is not right.')
  const r = await change(a, { current_pin: '3690', new_pin: '2468' })
  assert.equal(r.status, 200, r.text)
  assert.deepEqual(r.body, { ok: true })
  expectError(await api('POST', '/api/staff/signin', { body: { pin: '3690' } }), 401, 'unauthorized', 'pin', 'That PIN is not right.')
  assert.equal((await api('POST', '/api/staff/signin', { body: { pin: '2468' } })).status, 200)
  assert.equal((await api('GET', '/api/staff/crews', { token: b })).status, 200, 'the other session still works')
  assert.equal((await api('GET', '/api/staff/crews', { token: a })).status, 200, 'the changing session still works')
  assert.equal((await change(b, { current_pin: '2468', new_pin: '12345678' })).status, 200)
  assert.equal((await api('POST', '/api/staff/signin', { body: { pin: '12345678' } })).status, 200)
  await reset()
  assert.equal((await api('POST', '/api/staff/signin', { body: { pin: '3690' } })).status, 200, 'reset restores the SAMPLE PIN')
})

test('crews: add, rename, deactivate; a deactivated crew stays on its requests but cannot be picked', async () => {
  await reset()
  const token = await signin()
  const post = body => api('POST', '/api/staff/crews', { token, body })
  const putCrew = (id, body) => api('PUT', `/api/staff/crews/${id}`, { token, body })
  for (const name of ['', '   ', 'x'.repeat(41), 7, undefined]) {
    expectError(await post({ name }), 400, 'bad_request', 'name', 'Give the crew a name.')
  }
  expectError(await api('POST', '/api/staff/crews', { body: { name: 'No token (SAMPLE)' } }), 401, 'unauthorized')
  let r = await post({ name: '  Sidewalk crew (SAMPLE)  ' })
  assert.equal(r.status, 201, r.text)
  assert.deepEqual(r.body, { id: 4, name: 'Sidewalk crew (SAMPLE)', active: true, open_count: 0 })
  assert.equal((await post({ name: 'y'.repeat(40) })).status, 201)

  const c = await create()
  await putOk(token, c.id, { crew_id: 4 })
  r = await putCrew(4, { name: ' Sidewalks (SAMPLE) ', active: false })
  assert.equal(r.status, 200, r.text)
  assert.deepEqual(r.body, { id: 4, name: 'Sidewalks (SAMPLE)', active: false, open_count: 1 })
  expectError(await putCrew(4, { name: 'Sidewalks (SAMPLE)', active: 'no' }), 400, 'bad_request', 'active')
  expectError(await putCrew(4, { name: 'Sidewalks (SAMPLE)' }), 400, 'bad_request', 'active')
  expectError(await putCrew(4, { name: '', active: true }), 400, 'bad_request', 'name', 'Give the crew a name.')
  expectError(await putCrew(99, { name: 'Nobody (SAMPLE)', active: true }), 404, 'not_found')

  const d = await detail(token, c.id)
  assert.equal(d.crew_id, 4)
  assert.equal(d.crew_name, 'Sidewalks (SAMPLE)', 'the deactivated crew stays on its request')
  const keep = await put(token, c.id, { version: d.version, crew_id: 4, status: 'in_progress' })
  assert.equal(keep.status, 200, keep.text)
  const other = await create()
  expectError(await put(token, other.id, { version: 1, crew_id: 4 }), 400, 'bad_request', 'crew_id', 'Pick one of the crews.')
  const crews = (await api('GET', '/api/staff/crews', { token })).body.crews
  assert.deepEqual(crews.map(x => [x.id, x.active]), [[1, true], [2, true], [3, true], [4, false], [5, true]])
  assert.equal((await putCrew(4, { name: 'Sidewalks (SAMPLE)', active: true })).status, 200)
  assert.equal((await put(token, other.id, { version: 1, crew_id: 4 })).status, 200, 'active again, it can be picked')
})

const GOOD_SETTINGS = {
  emergency_phone: ' 709-555-0199 ',
  office_phone: '(709) 555-0111',
  office_hours: 'Monday to Thursday, 9 AM to 4 PM',
  sla_days: { pothole: 14, streetlight: 10, snow: 1, water: 3, garbage: 365, tree: 5, other: null }
}

test('settings: validation per field', async () => {
  await reset()
  const token = await signin()
  const putS = body => api('PUT', '/api/staff/settings', { token, body })
  const phoneMsg = 'Type a phone number like 709-555-0100.'
  const hoursMsg = 'Keep the office hours short.'
  const slaMsg = 'Use 1 to 365 days, or leave it blank for no target.'
  const { garbage, ...noGarbage } = GOOD_SETTINGS.sla_days
  assert.equal(garbage, 365)
  const sla = over => ({ sla_days: { ...GOOD_SETTINGS.sla_days, ...over } })
  const cases = [
    [{ emergency_phone: 'call us' }, 'emergency_phone', phoneMsg],
    [{ emergency_phone: undefined }, 'emergency_phone', phoneMsg],
    [{ office_phone: '555-01' }, 'office_phone', phoneMsg],
    [{ office_phone: `709.555.0100${'.'.repeat(19)}` }, 'office_phone', phoneMsg],
    [{ office_hours: '   ' }, 'office_hours', hoursMsg],
    [{ office_hours: 'h'.repeat(121) }, 'office_hours', hoursMsg],
    [sla({ pothole: 0 }), 'sla_days.pothole', slaMsg],
    [sla({ snow: 366 }), 'sla_days.snow', slaMsg],
    [sla({ water: 2.5 }), 'sla_days.water', slaMsg],
    [sla({ tree: '5' }), 'sla_days.tree', slaMsg],
    [{ sla_days: noGarbage }, 'sla_days.garbage', slaMsg],
    [{ sla_days: null }, 'sla_days.pothole', slaMsg]
  ]
  for (const [over, field, msg] of cases) expectError(await putS({ ...GOOD_SETTINGS, ...over }), 400, 'bad_request', field, msg)
  const unchanged = await api('GET', '/api/staff/settings', { token })
  assert.equal(unchanged.body.emergency_phone, '709-555-0142')

  const r = await putS({ ...GOOD_SETTINGS, office_hours: 'h'.repeat(120) })
  assert.equal(r.status, 200, r.text)
  assert.deepEqual(r.body, {
    town_name: TOWN_NAME, emergency_phone: '709-555-0199', office_phone: '(709) 555-0111', office_hours: 'h'.repeat(120), sla_days: GOOD_SETTINGS.sla_days
  })
  const town = (await api('GET', '/api/town')).body
  assert.equal(town.emergency_phone, '709-555-0199')
  assert.equal(town.office_phone, '(709) 555-0111')
  expectError(await api('PUT', '/api/staff/settings', { body: GOOD_SETTINGS }), 401, 'unauthorized')
})

test('settings: an SLA change flips overdue on read', async () => {
  await reset()
  const c = await create({ category: 'streetlight' }, at(T0, -11 * DAY))
  const token = await signin()
  const sla = async streetlight => {
    const r = await api('PUT', '/api/staff/settings', { token, body: { ...GOOD_SETTINGS, sla_days: { ...GOOD_SETTINGS.sla_days, streetlight } } })
    assert.equal(r.status, 200, r.text)
  }
  let d = await detail(token, c.id)
  assert.equal(d.overdue, true)
  assert.equal(d.overdue_days, 1)
  await sla(12)
  d = await detail(token, c.id)
  assert.equal(d.overdue, false)
  assert.equal(d.due_at, at(T0, DAY))
  assert.equal((await list(token, '?overdue=1')).requests.length, 0)
  await sla(null)
  d = await detail(token, c.id)
  assert.equal(d.overdue, false)
  assert.equal(d.due_at, null)
  assert.equal(d.due_label, null)
  await sla(10)
  assert.deepEqual((await list(token, '?overdue=1')).requests.map(x => x.id), [c.id])
})

// ---- M2: weekly report ----

test('weekly report on a fake clock', async () => {
  await reset()
  const mk = (category, created) => create({ category, ...(category === 'other' ? { description: 'Report test (SAMPLE)' } : {}) }, created)
  const close = async (id, when, status = 'done', message) =>
    putOk(await signin(when), id, { status, ...(message ? { public_message: message } : {}) }, when)
  const p0 = await mk('pothole', '2026-08-25T12:00:00.000Z')
  await close(p0.id, '2026-09-06T12:00:00.000Z') // Sun Sep 6, 9:30 AM NDT: the week before
  const p1 = await mk('pothole', '2026-09-07T12:00:00.000Z')
  await close(p1.id, '2026-09-09T00:00:00.000Z') // 1.5 days
  const p2 = await mk('pothole', '2026-09-08T00:00:00.000Z')
  await close(p2.id, '2026-09-11T06:00:00.000Z', 'wont_fix', 'That lane is private (SAMPLE).') // 3.25 days
  const p3 = await mk('pothole', '2026-08-31T12:00:00.000Z')
  await close(p3.id, '2026-09-10T12:00:00.000Z') // 10 days, opened the week before
  const s1 = await mk('streetlight', '2026-09-09T00:00:00.000Z')
  await close(s1.id, '2026-09-09T06:00:00.000Z') // 0.25 days -> 0.3 half-up
  const w1 = await mk('water', '2026-09-10T00:00:00.000Z')
  const m1 = await mk('garbage', '2026-09-10T12:00:00.000Z')
  const g1 = await mk('garbage', '2026-09-10T13:00:00.000Z')
  const n1 = await mk('snow', '2026-09-14T02:00:00.000Z') // Sun Sep 13, 11:30 PM NDT
  const t1 = await mk('tree', '2026-09-15T12:00:00.000Z')
  const o1 = await mk('other', '2026-09-15T13:00:00.000Z')
  const o2 = await mk('other', '2026-09-15T14:00:00.000Z')
  const joined = await api('POST', `/api/staff/requests/${m1.id}/merge`, { token: await signin('2026-09-11T12:00:00.000Z'), body: { into_id: g1.id }, now: '2026-09-11T12:00:00.000Z' })
  assert.equal(joined.status, 200, joined.text)

  const NOW = '2026-09-16T15:00:00.000Z'
  const token = await signin(NOW)
  const weekly = async q => {
    const r = await api('GET', `/api/staff/report/weekly${q}`, { token, now: NOW })
    assert.equal(r.status, 200, r.text)
    return r.body
  }
  const w = await weekly('?week=2026-09-07')
  assert.equal(w.week_start, '2026-09-07')
  assert.equal(w.week_label, 'Mon Sep 7 to Sun Sep 13')
  const row = (category, opened, closed, avg) => ({ category, label: TOWN_LABELS[category], opened, closed, avg_days_to_close: avg })
  assert.deepEqual(w.rows, [
    row('pothole', 2, 3, 4.9), // (1.5 + 3.25 + 10) / 3 = 4.9167
    row('streetlight', 1, 1, 0.3),
    row('snow', 1, 0, null), // the Sunday 11:30 PM report
    row('water', 1, 0, null),
    row('garbage', 1, 0, null), // the merged duplicate is left out
    row('tree', 0, 0, null),
    row('other', 0, 0, null)
  ])
  // every closed request of the week: (1.5 + 3.25 + 10 + 0.25) / 4 = 3.75 -> 3.8 (a mean of the row means would be 2.6)
  assert.deepEqual(w.totals, { opened: 6, closed: 4, avg_days_to_close: 3.8 })
  assert.equal(w.open_now, 6)
  assert.equal(w.overdue_now, 3) // water, garbage and snow are past their SLA at NOW
  assert.deepEqual(w.oldest_open.map(x => x.id), [w1.id, g1.id, n1.id, t1.id, o1.id])
  assert.equal(w.oldest_open[0].ref, w1.ref)
  assert.equal(w.oldest_open[0].overdue, true)
  assert.equal(w.oldest_open[1].plus_ones, 1)
  assert.ok(!w.oldest_open.some(x => x.id === o2.id || x.id === m1.id))

  const next = await weekly('?week=2026-09-14')
  assert.deepEqual(next.rows.map(r => [r.category, r.opened, r.closed]), [
    ['pothole', 0, 0], ['streetlight', 0, 0], ['snow', 0, 0], ['water', 0, 0], ['garbage', 0, 0], ['tree', 1, 0], ['other', 2, 0]
  ])
  assert.deepEqual(next.totals, { opened: 3, closed: 0, avg_days_to_close: null })
  assert.equal(next.open_now, 6)
  assert.equal((await weekly('')).week_start, '2026-09-14', 'default: the week containing now')
  const before = await weekly('?week=2026-08-31')
  assert.equal(before.rows[0].opened, 1)
  assert.equal(before.rows[0].closed, 1, 'p0 closed on Sunday Sep 6 NL time')
  assert.equal(before.totals.avg_days_to_close, 12)
})
const TOWN_LABELS = { pothole: 'Pothole', streetlight: 'Streetlight out', snow: 'Missed snow clearing', water: 'Water or sewer problem', garbage: 'Missed garbage pickup', tree: 'Fallen tree', other: 'Something else' }

test('weekly report: NL week boundaries, the Sunday 11:30 PM request and the DST weeks', async () => {
  await reset()
  await create({ category: 'snow' }, '2026-09-14T02:00:00.000Z') // Sun Sep 13, 11:30 PM NDT = Mon Sep 14, 02:00 UTC
  await create({ category: 'tree' }, '2026-09-14T02:30:00.000Z') // Mon Sep 14, 12:00 AM NDT exactly
  const NOW = '2026-09-16T12:00:00.000Z'
  const token = await signin(NOW)
  const weekly = async (q, now = NOW) => {
    const r = await api('GET', `/api/staff/report/weekly${q}`, { token, now })
    assert.equal(r.status, 200, r.text)
    return r.body
  }
  const pick = w => ({ week_start: w.week_start, week_label: w.week_label, start_at: w.start_at, end_at: w.end_at })
  const earlier = await weekly('?week=2026-09-07')
  assert.deepEqual(pick(earlier), { week_start: '2026-09-07', week_label: 'Mon Sep 7 to Sun Sep 13', start_at: '2026-09-07T02:30:00.000Z', end_at: '2026-09-14T02:30:00.000Z' })
  assert.deepEqual(earlier.rows.map(r => r.opened), [0, 0, 1, 0, 0, 0, 0], 'the Sunday 11:30 PM report counts in the earlier week')
  const later = await weekly('?week=2026-09-14')
  assert.deepEqual(later.rows.map(r => r.opened), [0, 0, 0, 0, 0, 1, 0], 'midnight Monday NL time starts the next week')
  assert.equal((await weekly('?week=2026-09-13')).week_start, '2026-09-07', 'a Sunday belongs to the week that started on Monday')
  assert.equal((await weekly('', '2026-09-14T02:00:00.000Z')).week_start, '2026-09-07', 'now is still Sunday in NL')
  assert.equal((await weekly('', '2026-09-14T02:30:00.000Z')).week_start, '2026-09-14')

  assert.deepEqual(pick(await weekly('?week=2026-10-28')), {
    week_start: '2026-10-26', week_label: 'Mon Oct 26 to Sun Nov 1', start_at: '2026-10-26T02:30:00.000Z', end_at: '2026-11-02T03:30:00.000Z'
  }, 'the week the clocks fall back is 7 days and 1 hour long')
  assert.deepEqual(pick(await weekly('?week=2026-03-08')), {
    week_start: '2026-03-02', week_label: 'Mon Mar 2 to Sun Mar 8', start_at: '2026-03-02T03:30:00.000Z', end_at: '2026-03-09T02:30:00.000Z'
  }, 'the week the clocks spring forward is 7 days less 1 hour')

  for (const bad of ['2026-02-30', '2026-9-7', 'abc', '2026-13-01']) {
    expectError(await api('GET', `/api/staff/report/weekly?week=${bad}`, { token, now: NOW }), 400, 'bad_request', 'week')
  }
})

// ---- M2: CSV ----

test('CSV export: header, CRLF, quoting, formula guard and NL-date filename', async () => {
  await reset()
  const a = await create({ ...at2(POINTS.on_street.point) })
  const b = await create({ category: 'streetlight' }, at(T0, HOUR))
  const c = await create({ category: 'snow', ...at2(POINTS.far_from_streets_inside.point) }, at(T0, 2 * HOUR))
  const token = await signin()
  await putOk(token, a.id, { crew_id: 1, public_message: 'He said "fix it", please' })
  await putOk(token, b.id, { public_message: '=SUM(A1)' })
  const closedAt = at(T0, 3.25 * DAY)
  await putOk(await signin(closedAt), c.id, { status: 'wont_fix', public_message: '@crew' }, closedAt)

  const NOW = '2026-09-11T02:00:00.000Z' // Thu Sep 10, 11:30 PM NDT (already Sep 11 in UTC)
  const t2 = await signin(NOW)
  const r = await api('GET', '/api/staff/export.csv', { token: t2, now: NOW })
  assert.equal(r.status, 200, r.text)
  assert.equal(r.headers.get('content-type'), 'text/csv; charset=utf-8')
  assert.equal(r.headers.get('content-disposition'), 'attachment; filename="harbour-pond-requests-2026-09-10.csv"')
  assert.ok(r.text.endsWith('\r\n'))
  assert.ok(!r.text.replace(/\r\n/g, '').includes('\n'), 'every line ends with CRLF')
  const lines = r.text.split('\r\n')
  assert.equal(lines.pop(), '')
  assert.deepEqual(lines, [
    'Reference,Category,Location,Ward,Status,Crew,Plus ones,Reported,Due,Overdue,Closed,Days to close,Public message',
    `HP-1001,Pothole,${POINTS.on_street.street},North Ward (SAMPLE),Assigned,${ROADS},0,2026-09-07 10:45,2026-09-21 10:45,No,,,"He said ""fix it"", please"`,
    `HP-1002,Streetlight out,${b.location_label},Centre Ward (SAMPLE),New,,0,2026-09-07 11:45,2026-09-17 11:45,No,,,'=SUM(A1)`,
    "HP-1003,Missed snow clearing,Not near a named street,South Ward (SAMPLE),Won't fix,,0,2026-09-07 12:45,2026-09-09 12:45,No,2026-09-10 16:45,3.2,'@crew"
  ])
  const closedOnly = await api('GET', '/api/staff/export.csv?status=closed', { token: t2, now: NOW })
  assert.deepEqual(closedOnly.text.split('\r\n').map(l => l.split(',')[0]), ['Reference', 'HP-1003', ''])
  expectError(await api('GET', '/api/staff/export.csv?category=volcano', { token: t2, now: NOW }), 400, 'bad_request', 'category')
  expectError(await api('GET', '/api/staff/export.csv', { now: NOW }), 401, 'unauthorized')
})

test("CSV export never contains the reporter's name, phone, description or note text", async () => {
  await reset()
  const c = await create({ name: 'Zebediah Quillfeather (SAMPLE)', phone: '709-555-0177', description: 'MARMOSET by the hydrant (SAMPLE)' })
  const token = await signin()
  assert.equal((await api('POST', `/api/staff/requests/${c.id}/notes`, { token, body: { text: 'PANGOLIN internal note' } })).status, 201)
  await putOk(token, c.id, { public_message: 'Booked for Friday (SAMPLE).' })
  const r = await api('GET', '/api/staff/export.csv', { token })
  assert.equal(r.status, 200)
  for (const s of ['Zebediah', 'Quillfeather', '709-555-0177', '5550177', '555-0177', 'MARMOSET', 'hydrant', 'PANGOLIN', 'internal note', c.submission.device_id]) {
    assert.ok(!r.text.includes(s), `CSV must not contain ${JSON.stringify(s)}`)
  }
  assert.ok(r.text.includes('Booked for Friday (SAMPLE).'))
  assert.equal(r.text.split('\r\n')[0].split(',').length, 13)
})

// ---- M2: rate guards ----

test('rate guard: 10 new reports per IP per rolling hour', async () => {
  await reset()
  const send = (body, ip, now) => api('POST', '/api/requests', { body, ip, now })
  const first = report()
  assert.equal((await send(first, 'ip-a', T0)).status, 201)
  for (let i = 1; i < 10; i++) assert.equal((await send(report(), 'ip-a', at(T0, i * 60000))).status, 201)
  const limitMsg = "That's a lot of reports from one phone in a short time. Please call the town office."
  expectError(await send(report(), 'ip-a', at(T0, 30 * 60000)), 429, 'rate_limited', undefined, limitMsg)
  const resend = await send(first, 'ip-a', at(T0, 30 * 60000))
  assert.equal(resend.status, 200, 'a resend of a report already made is not refused')
  assert.equal(resend.body.duplicate, true)
  assert.equal((await send(report(), 'ip-b', at(T0, 30 * 60000))).status, 201, 'another IP is unaffected')
  expectError(await send(report(), 'ip-a', at(T0, HOUR - 1)), 429, 'rate_limited')
  assert.equal((await send(report(), 'ip-a', at(T0, HOUR))).status, 201, 'the first report has left the rolling hour')
  expectError(await send(report(), 'ip-a', at(T0, HOUR)), 429, 'rate_limited')
  const token = await signin(at(T0, HOUR))
  assert.equal((await list(token, '', at(T0, HOUR))).requests.length, 12)
  await reset()
  assert.equal((await send(report(), 'ip-a', at(T0, HOUR))).status, 201, 'reset clears the guard')
})

test('rate guard: 30 "Me too" taps per IP per rolling hour', async () => {
  await reset()
  const c = await create()
  const tap = (deviceId, ip, now = T0) => api('POST', `/api/requests/${c.id}/me-too`, { body: { device_id: deviceId }, ip, now })
  const firstDevice = randomUUID()
  assert.equal((await tap(firstDevice, 'ip-m')).status, 201)
  for (let i = 1; i < 30; i++) assert.equal((await tap(randomUUID(), 'ip-m', at(T0, i * 1000))).status, 201)
  expectError(await tap(randomUUID(), 'ip-m', at(T0, 60000)), 429, 'rate_limited', undefined, "That's a lot of taps from one phone. Please call the town office.")
  const again = await tap(firstDevice, 'ip-m', at(T0, 60000))
  assert.equal(again.status, 200, 'a phone already counted is answered as a duplicate')
  assert.equal(again.body.duplicate, true)
  assert.equal((await tap(randomUUID(), 'ip-n', at(T0, 60000))).status, 201, 'another IP is unaffected')
  assert.equal((await tap(randomUUID(), 'ip-m', at(T0, HOUR))).status, 201, 'the first tap has left the rolling hour')
  const token = await signin(at(T0, HOUR))
  assert.equal((await detail(token, c.id, at(T0, HOUR))).plus_ones, 32)
})

test('rate guard: 5 wrong PINs per IP per 15 minutes', async () => {
  await reset()
  const signinAs = (pin, ip, now) => api('POST', '/api/staff/signin', { body: { pin }, ip, now })
  for (let i = 0; i < 4; i++) expectError(await signinAs('0000', 'ip-p', at(T0, i * 1000)), 401, 'unauthorized', 'pin')
  assert.equal((await signinAs('3690', 'ip-p', at(T0, 4000))).status, 200, 'a right PIN is not counted')
  expectError(await signinAs('0000', 'ip-p', at(T0, 5000)), 401, 'unauthorized', 'pin')
  expectError(await signinAs('3690', 'ip-p', at(T0, 6000)), 429, 'rate_limited', undefined, 'Too many tries. Wait 15 minutes and try again.')
  assert.equal((await signinAs('3690', 'ip-q', at(T0, 6000))).status, 200, 'another IP is unaffected')
  expectError(await signinAs('3690', 'ip-p', at(T0, 15 * 60000 - 1)), 429, 'rate_limited') // the first wrong PIN is still inside
  assert.equal((await signinAs('3690', 'ip-p', at(T0, 15 * 60000 + 1000))).status, 200, 'the first wrong PIN has left the window')
  await reset()
  for (let i = 0; i < 5; i++) await signinAs('0000', 'ip-r', T0)
  expectError(await signinAs('3690', 'ip-r', T0), 429, 'rate_limited')
  await reset()
  assert.equal((await signinAs('3690', 'ip-r', T0)).status, 200, 'reset clears the guard')
})

test('rate guard: 30 unknown status links per IP per 10 minutes, then even good links', async () => {
  await reset()
  const c = await create()
  const key = new URL(c.status_url).searchParams.get('k')
  const look = (k, ip, now = T0) => api('GET', `/api/status/${k}`, { ip, now })
  for (let i = 0; i < 5; i++) assert.equal((await look(key, 'ip-s')).status, 200, 'good links are not counted')
  for (let i = 0; i < 30; i++) expectError(await look(`nope-${i}`, 'ip-s', at(T0, i * 1000)), 404, 'not_found')
  const r = await look(key, 'ip-s', at(T0, 30000))
  expectError(r, 429, 'rate_limited')
  assert.ok(!r.text.includes(c.ref), 'a refused good link shows nothing of the report')
  assert.equal((await look(key, 'ip-t', at(T0, 30000))).status, 200, 'another IP is unaffected')
  expectError(await look(key, 'ip-s', at(T0, 10 * 60000 - 1)), 429, 'rate_limited') // the first unknown link is still inside
  assert.equal((await look(key, 'ip-s', at(T0, 10 * 60000 + 1000))).status, 200, 'the first unknown link has left the window')
})

// ---- M2: demo seed ----

test('demo seed: every status and category, overdue ones, a merged pair, photos that load', async () => {
  const NOW = '2026-09-14T15:00:00.000Z'
  expectError(await api('POST', '/api/test/seed', { body: { scenario: 'party' }, now: NOW }), 400, 'bad_request', 'scenario')
  const r = await api('POST', '/api/test/seed', { body: { scenario: 'demo' }, now: NOW })
  assert.equal(r.status, 200, r.text)
  assert.deepEqual(Object.keys(r.body).sort(), ['pin', 'requests'])
  assert.equal(r.body.pin, '3690')
  const seeded = r.body.requests
  assert.ok(seeded.length >= 20 && seeded.length <= 30, String(seeded.length))
  for (const x of seeded) {
    assert.deepEqual(Object.keys(x).sort(), ['id', 'ref', 'status', 'status_url'])
    assert.equal(x.ref, `HP-${x.id}`)
    assert.equal(new URL(x.status_url).origin, new URL(BASE).origin)
    assert.equal(new URL(x.status_url).pathname, '/s/')
  }

  const token = await signin(NOW)
  const details = await Promise.all(seeded.map(x => detail(token, x.id, NOW)))
  assert.deepEqual(details.map(d => d.status), seeded.map(x => x.status))
  assert.deepEqual([...new Set(details.map(d => d.status))].sort(), ['assigned', 'done', 'in_progress', 'merged', 'new', 'wont_fix'])
  assert.deepEqual([...new Set(details.map(d => d.category))].sort(), ['garbage', 'other', 'pothole', 'snow', 'streetlight', 'tree', 'water'])
  assert.ok(details.filter(d => d.overdue).length >= 2, 'at least two overdue')
  const board = await list(token, '', NOW)
  for (const [status, n] of Object.entries(board.counts)) assert.ok(n > 0, `the ${status} column has requests`)

  const merged = details.filter(d => d.status === 'merged')
  assert.ok(merged.length >= 1)
  const target = details.find(d => d.id === merged[0].merged_into.id)
  assert.notEqual(target.status, 'merged')
  assert.ok(target.merged.some(m => m.id === merged[0].id))
  assert.equal(target.history.filter(h => h.kind === 'merged_in').length, merged.filter(m => m.merged_into.id === target.id).length)
  const mergedStatus = await api('GET', new URL(seeded.find(x => x.id === merged[0].id).status_url).pathname.replace('/s/', '/api/status/') +
    new URL(seeded.find(x => x.id === merged[0].id).status_url).searchParams.get('k'), { now: NOW })
  assert.equal(mergedStatus.body.merged_into.ref, target.ref)

  assert.ok(details.some(d => d.crew_name), 'crews')
  assert.ok(details.some(d => d.public_message), 'public messages')
  assert.ok(details.some(d => d.history.some(h => h.kind === 'note' && h.internal)), 'internal notes')
  assert.ok(details.some(d => d.plus_ones > 0), '"Me too" counts')
  assert.ok(details.some(d => d.reporter_name) && details.some(d => d.reporter_phone), 'names and phones on some')
  const floor = Date.parse(NOW) - 35 * DAY
  for (const d of details) {
    assert.ok(Date.parse(d.created_at) >= floor && Date.parse(d.created_at) <= Date.parse(NOW), `${d.ref} within five weeks`)
    assert.ok(d.history.every(h => h.at >= d.created_at && Date.parse(h.at) <= Date.parse(NOW)), `${d.ref} history in order`)
    assert.equal(d.history[0].kind, 'created')
    assert.ok(pointInRing([d.lat, d.lng], TOWN.boundary), `${d.ref} inside the boundary`)
    assert.ok(d.description === null || d.description.endsWith('(SAMPLE)'), d.description)
    assert.ok(d.reporter_name === null || d.reporter_name.includes('SAMPLE'), d.reporter_name)
    assert.ok(d.reporter_phone === null || /^709-555-01\d\d$/.test(d.reporter_phone), d.reporter_phone)
    if (d.crew_id !== null) assert.ok(d.crew_name.includes('SAMPLE'))
    if (['assigned', 'in_progress'].includes(d.status)) assert.notEqual(d.crew_id, null, `${d.ref} has a crew`)
    if (d.status === 'wont_fix') assert.ok(d.public_message, `${d.ref} says why`)
    assert.equal(d.closed_at === null, ['new', 'assigned', 'in_progress'].includes(d.status), `${d.ref} closed_at`)
  }
  assert.ok(details.filter(d => d.location_label !== 'Not near a named street').length >= 20, 'pins sit on the real streets')

  const withPhotos = details.filter(d => d.photo_url)
  assert.ok(withPhotos.length >= 3)
  for (const d of withPhotos) {
    const p = await api('GET', d.photo_url, { now: NOW })
    assert.equal(p.status, 200)
    assert.equal(p.headers.get('content-type'), 'image/svg+xml')
    assert.match(p.headers.get('content-security-policy'), /default-src 'none'/)
    assert.ok(p.text.startsWith('<svg') && p.text.includes('SAMPLE photo') && !/<script|href=|xlink/i.test(p.text), d.ref)
  }

  const again = await api('POST', '/api/test/seed', { body: { scenario: 'demo' }, now: NOW })
  assert.equal(again.body.requests.length, seeded.length)
  const t3 = await signin(NOW)
  assert.equal((await list(t3, '?status=merged', NOW)).requests.length + (await list(t3, '', NOW)).requests.length, seeded.length, 'seeding twice does not double up')
})

test('unknown API routes answer 404 JSON', async () => {
  expectError(await api('GET', '/api/nope'), 404, 'not_found')
  expectError(await api('DELETE', '/api/town'), 404, 'not_found')
})
