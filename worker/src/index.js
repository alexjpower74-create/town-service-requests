// Town Service Requests Worker: the API in docs/API.md. Static files in ../app/public are served by [assets]; only /api/*
// reaches here.

import { TOWN } from './town-data.js'
import { CATEGORIES, CATEGORY_KEYS, categoryLabel, STATUS_LABELS, BOARD_STATUSES, OPEN_STATUSES, CLOSED_STATUSES, isOpen } from './lists.js'
import { haversine, pointInRing, wardOf, locationLabel } from './geo.js'
import { dateLabel, fullLabel, nlDate, weekOf, parseIsoDate } from './time.js'
import { dueAt, isOverdue, overdueDays, ageDays, daysToClose, meanDaysHalfUp } from './sla.js'
import { now as clockNow, clientIp, isTestMode } from './clock.js'
import { randomKey, sha256Hex, hashPin, verifyPin, isUuidV4 } from './auth.js'
import * as H from './history.js'
import { copyUpdate } from './copy.js'
import { toCsv } from './csv.js'
import { seedDemo } from './seed.js'
import { SAMPLE_PIN, SAMPLE_CREWS, resetStatements } from './sample.js'

const NEARBY_METRES = 50
const CANDIDATE_METRES = 200
const MAX_NEARBY = 10
const SESSION_MS = 12 * 3600000
const UPLOAD_TOKEN_MS = 3600000
const PHOTO_MAX_BYTES = 5000000
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const DEFAULT_MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'
const OPEN_SQL = OPEN_STATUSES.map(s => `'${s}'`).join(', ')

// ---- responses ----

class HttpError extends Error {
  constructor (status, code, error, extra = {}) {
    super(error)
    this.status = status
    this.body = { error, code, ...extra }
  }
}

const API_HEADERS = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' }

function json (status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...API_HEADERS } })
}

const badRequest = (field, error) => new HttpError(400, 'bad_request', error, field ? { field } : {})
const notFound = error => new HttpError(404, 'not_found', error)
const badState = error => new HttpError(409, 'bad_state', error)
const unauthorized = (error, field) => new HttpError(401, 'unauthorized', error, field ? { field } : {})
const NOT_FOUND_REPORT = "We can't find that report."
const PHONE_MESSAGE = 'Something went wrong on this phone. Reload the page and try again.'

// ---- rate guards (per IP, rolling windows; /api/test/reset clears them) ----

const RATE = {
  create: { windowMs: 3600000, limit: 10, error: "That's a lot of reports from one phone in a short time. Please call the town office." },
  me_too: { windowMs: 3600000, limit: 30, error: "That's a lot of taps from one phone. Please call the town office." },
  pin: { windowMs: 15 * 60000, limit: 5, error: 'Too many tries. Wait 15 minutes and try again.' },
  status: { windowMs: 10 * 60000, limit: 30, error: "Too many report links that don't work. Wait 10 minutes and try again." }
}

/** 429 when this IP already has `limit` attempts of `kind` in the window (now − window, now]. */
async function rateGuard (ctx, kind) {
  const r = RATE[kind]
  const row = await ctx.db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE kind = ? AND ip = ? AND at > ? AND at <= ?')
    .bind(kind, ctx.ip, iso(ctx.now - r.windowMs), iso(ctx.now)).first()
  if (row.n >= r.limit) throw new HttpError(429, 'rate_limited', r.error)
}

const attemptStmt = (ctx, kind) => ctx.db.prepare('INSERT INTO attempts (kind, ip, at) VALUES (?, ?, ?)').bind(kind, ctx.ip, iso(ctx.now))

async function readJson (request) {
  const text = await request.text()
  if (!text.trim()) return {}
  try {
    const body = JSON.parse(text)
    if (body && typeof body === 'object' && !Array.isArray(body)) return body
  } catch {}
  throw badRequest(null, 'That request could not be read.')
}

const iso = ms => new Date(ms).toISOString()
const ms = at => (at === null || at === undefined ? null : Date.parse(at))
const chars = s => [...s].length
const refOf = id => `HP-${id}`
const has = (body, key) => Object.prototype.hasOwnProperty.call(body, key)
const statusUrl = (ctx, key) => `${ctx.origin}/s/?k=${key}`
const photoUrl = (ctx, key) => `${ctx.origin}/api/photos/${key}`
const errorText = e => String(e?.message || e) + String(e?.cause?.message || '')
const isUniqueViolation = e => /UNIQUE constraint failed/i.test(errorText(e))
// json() of a non-JSON string raises "malformed JSON" and rolls the whole D1 batch back: the in-batch guards use it.
const isGuardRefusal = e => /malformed JSON/i.test(errorText(e))
const guardOneChange = db => db.prepare("SELECT CASE WHEN changes() = 1 THEN 1 ELSE json('refused') END")

// ---- settings and town ----

async function loadSettings (db) {
  const row = await db.prepare('SELECT * FROM settings WHERE id = 1').first()
  if (!row) throw new HttpError(500, 'server_error', 'The town is not set up yet.')
  return { ...row, sla_days: JSON.parse(row.sla_days) }
}

const wardName = id => TOWN.wards.find(w => w.id === id)?.name ?? null
const slaFor = (settings, category) => settings.sla_days[category] ?? null

/** Pins must be inside the town boundary. */
function requireInside (lat, lng) {
  if (!pointInRing([lat, lng], TOWN.boundary)) {
    throw new HttpError(400, 'outside_boundary', 'That spot is outside the town. Move the pin inside the line on the map.', { field: 'location' })
  }
}

// ---- request rows and views ----

const REQUEST_SELECT = `SELECT r.*, c.name AS crew_name, t.status_key AS target_status_key, p.photo_key AS photo_key,
  (SELECT COUNT(*) FROM requests m WHERE m.merged_into = r.id) AS merged_count
  FROM requests r LEFT JOIN crews c ON c.id = r.crew_id LEFT JOIN requests t ON t.id = r.merged_into
  LEFT JOIN photos p ON p.request_id = r.id`

async function loadRow (db, id, message = NOT_FOUND_REPORT) {
  const row = Number.isSafeInteger(id) ? await db.prepare(`${REQUEST_SELECT} WHERE r.id = ?`).bind(id).first() : null
  if (!row) throw notFound(message)
  return row
}

function summary (row, settings, now) {
  const createdAt = ms(row.created_at)
  const closedAt = ms(row.closed_at)
  const due = dueAt(createdAt, slaFor(settings, row.category))
  const clock = { status: row.status, createdAt, dueAt: due, now }
  return {
    id: row.id,
    ref: refOf(row.id),
    category: row.category,
    category_label: categoryLabel(row.category),
    location_label: row.location_label,
    lat: row.lat,
    lng: row.lng,
    ward: row.ward,
    ward_name: wardName(row.ward),
    status: row.status,
    status_label: STATUS_LABELS[row.status],
    crew_id: row.crew_id,
    crew_name: row.crew_name ?? null,
    plus_ones: row.plus_ones,
    has_photo: row.photo === 'stored',
    has_contact: Boolean(row.reporter_name || row.reporter_phone),
    merged_count: row.merged_count,
    merged_into_ref: row.merged_into === null ? null : refOf(row.merged_into),
    created_at: row.created_at,
    created_label: fullLabel(createdAt),
    age_days: ageDays(createdAt, now),
    due_at: due === null ? null : iso(due),
    due_label: dateLabel(due),
    overdue: isOverdue(clock),
    overdue_days: overdueDays(clock),
    closed_at: row.closed_at,
    closed_label: fullLabel(closedAt),
    days_to_close: daysToClose(createdAt, closedAt),
    version: row.version
  }
}

async function staffDetail (ctx, id, settings) {
  const { db, now } = ctx
  settings = settings || await loadSettings(db)
  const row = await loadRow(db, id)
  const [merged, history] = await Promise.all([
    db.prepare('SELECT r.*, p.photo_key FROM requests r LEFT JOIN photos p ON p.request_id = r.id WHERE r.merged_into = ? ORDER BY r.created_at, r.id')
      .bind(id).all(),
    db.prepare('SELECT at, kind, staff_text, internal FROM request_history WHERE request_id = ? ORDER BY at, id').bind(id).all()
  ])
  const url = statusUrl(ctx, row.status_key)
  return {
    ...summary(row, settings, now),
    description: row.description,
    reporter_name: row.reporter_name,
    reporter_phone: row.reporter_phone,
    photo: row.photo,
    photo_url: row.photo_key ? photoUrl(ctx, row.photo_key) : null,
    public_message: row.public_message,
    status_url: url,
    merged_into: row.merged_into === null ? null : { id: row.merged_into, ref: refOf(row.merged_into) },
    merged: merged.results.map(m => ({
      id: m.id,
      ref: refOf(m.id),
      created_label: fullLabel(m.created_at),
      plus_ones: m.plus_ones,
      description: m.description,
      reporter_name: m.reporter_name,
      reporter_phone: m.reporter_phone,
      photo_url: m.photo_key ? photoUrl(ctx, m.photo_key) : null
    })),
    history: history.results.map(h => ({ at: h.at, at_label: fullLabel(h.at), kind: h.kind, text: h.staff_text, internal: h.internal === 1 })),
    copy_update: copyUpdate({
      townName: settings.town_name,
      ref: refOf(row.id),
      categoryLabel: categoryLabel(row.category),
      locationLabel: row.location_label,
      status: row.status,
      targetRef: row.merged_into === null ? null : refOf(row.merged_into),
      publicMessage: row.public_message,
      statusUrl: url
    })
  }
}

const historyStmt = (db, requestId, at, e) =>
  db.prepare('INSERT INTO request_history (request_id, at, kind, public_text, staff_text, internal) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(requestId, at, e.kind, e.public_text, e.staff_text, e.internal)

// ---- resident routes ----

async function getTown (ctx) {
  const s = await loadSettings(ctx.db)
  return json(200, {
    name: s.town_name,
    sample: s.town_name.includes('SAMPLE'),
    timezone: 'America/St_Johns',
    emergency_phone: s.emergency_phone,
    office_phone: s.office_phone,
    office_hours: s.office_hours,
    map_style_url: ctx.env.MAP_STYLE_URL || DEFAULT_MAP_STYLE_URL,
    center: TOWN.center,
    zoom: TOWN.zoom,
    boundary: TOWN.boundary,
    wards: TOWN.wards.map(w => ({ id: w.id, name: w.name })),
    categories: CATEGORIES.map(c => ({ key: c.key, label: c.label, hint: c.hint })),
    streets: TOWN.streets.map(s => ({ name: s.name, point: s.point })),
    nearby_metres: NEARBY_METRES
  })
}

/** GET /api/town/locate: the Worker's own boundary, street label and ward for a pin (API.md clarification 9). */
async function locate (ctx) {
  const q = ctx.url.searchParams
  const lat = queryNumber(q.get('lat'))
  const lng = queryNumber(q.get('lng'))
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw badRequest('location', 'Put a pin on the map where the problem is.')
  const point = [lat, lng]
  return json(200, { inside: pointInRing(point, TOWN.boundary), location_label: locationLabel(point, TOWN.streets), ward: wardOf(point, TOWN.wards) })
}

const queryNumber = v => (v === null || v.trim() === '' ? NaN : Number(v))

/** undefined or null -> ''; a string -> trimmed; anything else -> null (invalid). */
const optionalText = v => (v === undefined || v === null ? '' : typeof v === 'string' ? v.trim() : null)

function validPhone (text) {
  if (chars(text) > 30) return false
  const digits = text.replace(/[\s().+-]/g, '')
  return /^\d{7,15}$/.test(digits)
}

function validateReport (body) {
  if (!isUuidV4(body.submission_id)) throw badRequest('submission_id', PHONE_MESSAGE)
  if (body.device_id !== undefined && body.device_id !== null && !isUuidV4(body.device_id)) throw badRequest('device_id', PHONE_MESSAGE)
  if (!CATEGORY_KEYS.includes(body.category)) throw badRequest('category', 'Pick what kind of problem it is.')
  if (!Number.isFinite(body.lat) || !Number.isFinite(body.lng)) throw badRequest('location', 'Put a pin on the map where the problem is.')
  requireInside(body.lat, body.lng)
  const description = optionalText(body.description)
  if (description === null || chars(description) > 500) throw badRequest('description', 'Keep it under 500 characters.')
  if (body.category === 'other' && !description) throw badRequest('description', 'Tell us what the problem is.')
  const name = optionalText(body.name)
  if (name === null || chars(name) > 80) throw badRequest('name', 'Keep your name under 80 characters.')
  const phone = optionalText(body.phone)
  if (phone === null || (phone && !validPhone(phone))) {
    throw badRequest('phone', "That phone number doesn't look right. Leave it blank if you'd rather not say.")
  }
  if (typeof body.has_photo !== 'boolean') throw badRequest('has_photo', PHONE_MESSAGE)
  return { description: description || null, name: name || null, phone: phone || null }
}

const findBySubmission = (db, submissionId) => db.prepare('SELECT * FROM requests WHERE submission_id = ?').bind(submissionId).first()

async function issueUploadToken (ctx, requestId) {
  const token = randomKey()
  const expiresAt = iso(ctx.now + UPLOAD_TOKEN_MS)
  await ctx.db.batch([
    ctx.db.prepare('DELETE FROM upload_tokens WHERE request_id = ?').bind(requestId),
    ctx.db.prepare('INSERT INTO upload_tokens (token_hash, request_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256Hex(token), requestId, iso(ctx.now), expiresAt)
  ])
  return { token, expiresAt }
}

async function createdResponse (ctx, row, duplicate, upload) {
  return json(duplicate ? 200 : 201, {
    id: row.id,
    ref: refOf(row.id),
    status_url: statusUrl(ctx, row.status_key),
    status_key: row.status_key,
    category_label: categoryLabel(row.category),
    location_label: row.location_label,
    reported_label: fullLabel(row.created_at),
    photo: row.photo,
    upload_url: upload ? `${ctx.origin}/api/requests/${row.id}/photo` : null,
    upload_token: upload ? upload.token : null,
    upload_expires_at: upload ? upload.expiresAt : null,
    duplicate
  })
}

async function duplicateResponse (ctx, row) {
  const upload = row.photo === 'waiting' ? await issueUploadToken(ctx, row.id) : null
  return createdResponse(ctx, row, true, upload)
}

async function createRequest (ctx) {
  const { db } = ctx
  const body = await readJson(ctx.request)
  const v = validateReport(body)
  const existing = await findBySubmission(db, body.submission_id)
  if (existing) return duplicateResponse(ctx, existing)
  await rateGuard(ctx, 'create') // a resend of a report already made is never refused

  const at = iso(ctx.now)
  const point = [body.lat, body.lng]
  const statusKey = randomKey()
  const photo = body.has_photo ? 'waiting' : 'none'
  // The rows that belong to the new request find it by its fresh random status key, never by submission_id: only the
  // lookup above and the UNIQUE constraint decide whether a send is a duplicate.
  const byKey = 'SELECT id FROM requests WHERE status_key = ?'
  const created = H.created()
  const statements = [
    db.prepare(`INSERT INTO requests (id, submission_id, category, lat, lng, ward, location_label, description, reporter_name,
      reporter_phone, status, photo, status_key, created_at, updated_at)
      SELECT COALESCE(MAX(id), 1000) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ? FROM requests`)
      .bind(body.submission_id, body.category, body.lat, body.lng, wardOf(point, TOWN.wards), locationLabel(point, TOWN.streets),
        v.description, v.name, v.phone, photo, statusKey, at, at),
    db.prepare(`INSERT INTO request_history (request_id, at, kind, public_text, staff_text, internal)
      SELECT id, ?, ?, ?, ?, ? FROM (${byKey})`)
      .bind(at, created.kind, created.public_text, created.staff_text, created.internal, statusKey)
  ]
  if (body.device_id) {
    statements.push(db.prepare(`INSERT INTO metoo_devices (request_id, device_id, reporter, at) SELECT id, ?, 1, ? FROM (${byKey})`)
      .bind(body.device_id, at, statusKey))
  }
  let upload = null
  if (body.has_photo) {
    upload = { token: randomKey(), expiresAt: iso(ctx.now + UPLOAD_TOKEN_MS) }
    statements.push(db.prepare(`INSERT INTO upload_tokens (token_hash, request_id, created_at, expires_at) SELECT ?, id, ?, ? FROM (${byKey})`)
      .bind(await sha256Hex(upload.token), at, upload.expiresAt, statusKey))
  }
  statements.push(attemptStmt(ctx, 'create'), db.prepare('DELETE FROM attempts WHERE at < ?').bind(iso(ctx.now - 86400000)))
  try {
    await db.batch(statements)
  } catch (e) {
    // Two sends of the same report at once: the second loses the UNIQUE race and answers as the duplicate it is.
    if (!isUniqueViolation(e)) throw e
    const row = await findBySubmission(db, body.submission_id)
    if (!row) throw e
    return duplicateResponse(ctx, row)
  }
  const row = await db.prepare('SELECT * FROM requests WHERE status_key = ?').bind(statusKey).first()
  return createdResponse(ctx, row, false, upload)
}

async function uploadPhoto (ctx, id) {
  const { db, request } = ctx
  const row = await loadRow(db, id)
  const auth = request.headers.get('Authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  const valid = token && await db.prepare('SELECT 1 FROM upload_tokens WHERE token_hash = ? AND request_id = ? AND expires_at > ?')
    .bind(await sha256Hex(token), id, iso(ctx.now)).first()
  if (!valid) throw unauthorized('This photo link has expired. Your report was still sent.')

  const tooLarge = new HttpError(413, 'too_large', 'That photo is too big. Try another or skip the photo.')
  if (Number(request.headers.get('Content-Length') || 0) > PHOTO_MAX_BYTES) throw tooLarge
  const contentType = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase()
  const bytes = await request.arrayBuffer()
  if (bytes.byteLength > PHOTO_MAX_BYTES) throw tooLarge
  if (!PHOTO_TYPES.includes(contentType)) {
    throw new HttpError(415, 'unsupported_photo', "That kind of file can't be used. Take a photo or pick a JPEG or PNG.")
  }
  if (row.photo === 'stored') return json(200, { photo: 'stored', duplicate: true })

  const key = randomKey()
  await ctx.env.PHOTOS.put(key, bytes, { httpMetadata: { contentType } })
  const at = iso(ctx.now)
  const e = H.photo()
  const results = await db.batch([
    db.prepare('INSERT INTO photos (photo_key, request_id, content_type, size, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (request_id) DO NOTHING')
      .bind(key, id, contentType, bytes.byteLength, at),
    db.prepare("UPDATE requests SET photo = 'stored' WHERE id = ? AND changes() = 1").bind(id),
    db.prepare('INSERT INTO request_history (request_id, at, kind, public_text, staff_text, internal) SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1')
      .bind(id, at, e.kind, e.public_text, e.staff_text, e.internal)
  ])
  if (results[0].meta.changes !== 1) {
    await ctx.env.PHOTOS.delete(key) // another upload for this report won the race; keep the first photo
    return json(200, { photo: 'stored', duplicate: true })
  }
  return json(200, { photo: 'stored' })
}

async function nearby (ctx) {
  const q = ctx.url.searchParams
  const category = q.get('category')
  if (!CATEGORY_KEYS.includes(category)) throw badRequest('category', 'Pick what kind of problem it is.')
  const lat = queryNumber(q.get('lat'))
  const lng = queryNumber(q.get('lng'))
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw badRequest('location', 'Put a pin on the map where the problem is.')
  requireInside(lat, lng)
  const { results } = await ctx.db.prepare(`SELECT * FROM requests WHERE category = ? AND status IN (${OPEN_SQL})`).bind(category).all()
  const found = results
    .map(r => ({ row: r, distance: haversine([lat, lng], [r.lat, r.lng]) }))
    .filter(x => x.distance <= NEARBY_METRES)
    .sort((a, b) => a.distance - b.distance || a.row.id - b.row.id)
    .slice(0, MAX_NEARBY)
  return json(200, {
    metres: NEARBY_METRES,
    requests: found.map(({ row, distance }) => ({
      id: row.id,
      ref: refOf(row.id),
      category: row.category,
      category_label: categoryLabel(row.category),
      location_label: row.location_label,
      status: row.status,
      status_label: STATUS_LABELS[row.status],
      reported_label: dateLabel(row.created_at),
      distance_m: Math.round(distance),
      plus_ones: row.plus_ones
    }))
  })
}

async function meToo (ctx, id) {
  const { db } = ctx
  const body = await readJson(ctx.request)
  if (!isUuidV4(body.device_id)) throw badRequest('device_id', PHONE_MESSAGE)
  const row = await loadRow(db, id)
  if (!isOpen(row.status)) throw badState('This report is already closed.')
  const known = await db.prepare('SELECT 1 FROM metoo_devices WHERE request_id = ? AND device_id = ?').bind(id, body.device_id).first()
  if (!known) await rateGuard(ctx, 'me_too') // a phone already counted is answered as a duplicate, never refused
  const at = iso(ctx.now)
  const e = H.meToo()
  const results = await db.batch([
    db.prepare('INSERT INTO metoo_devices (request_id, device_id, reporter, at) VALUES (?, ?, 0, ?) ON CONFLICT DO NOTHING').bind(id, body.device_id, at),
    db.prepare(`UPDATE requests SET plus_ones = plus_ones + 1 WHERE id = ? AND status IN (${OPEN_SQL}) AND changes() = 1`).bind(id),
    db.prepare('INSERT INTO request_history (request_id, at, kind, public_text, staff_text, internal) SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1')
      .bind(id, at, e.kind, e.public_text, e.staff_text, e.internal),
    db.prepare('INSERT INTO attempts (kind, ip, at) SELECT ?, ?, ? WHERE changes() = 1').bind('me_too', ctx.ip, at)
  ])
  const added = results[1].meta.changes === 1
  const after = await db.prepare('SELECT plus_ones, status_key FROM requests WHERE id = ?').bind(id).first()
  return json(added ? 201 : 200, { ref: refOf(id), plus_ones: after.plus_ones, status_url: statusUrl(ctx, after.status_key), duplicate: !added })
}

async function publicStatus (ctx, key) {
  const { db } = ctx
  await rateGuard(ctx, 'status') // once tripped, even good links wait for the window
  const row = key === null ? null : await db.prepare('SELECT r.*, t.status_key AS target_status_key FROM requests r LEFT JOIN requests t ON t.id = r.merged_into WHERE r.status_key = ?')
    .bind(key).first()
  if (!row) {
    await attemptStmt(ctx, 'status').run()
    throw notFound("We can't find that report. Check the link, or call the town office.")
  }
  const [settings, history] = await Promise.all([
    loadSettings(db),
    db.prepare('SELECT at, public_text FROM request_history WHERE request_id = ? AND internal = 0 ORDER BY at, id').bind(row.id).all()
  ])
  const entries = history.results
  const updatedAt = entries.length ? entries[entries.length - 1].at : row.created_at
  const body = {
    town: { name: settings.town_name, sample: settings.town_name.includes('SAMPLE'), office_phone: settings.office_phone },
    ref: refOf(row.id),
    category: row.category,
    category_label: categoryLabel(row.category),
    location_label: row.location_label, // public: the street name, never the pin
    status: row.status,
    status_label: STATUS_LABELS[row.status],
    public_message: row.public_message,
    plus_ones: row.plus_ones,
    reported_at: row.created_at,
    reported_label: fullLabel(row.created_at),
    updated_at: updatedAt,
    updated_label: fullLabel(updatedAt),
    closed_at: row.closed_at,
    closed_label: fullLabel(row.closed_at),
    merged_into: row.merged_into === null ? null : { ref: refOf(row.merged_into), status_url: statusUrl(ctx, row.target_status_key) },
    history: entries.map(h => ({ at: h.at, at_label: fullLabel(h.at), text: h.public_text }))
  }
  return json(200, body)
}

async function getPhoto (ctx, key) {
  const row = key === null ? null : await ctx.db.prepare('SELECT * FROM photos WHERE photo_key = ?').bind(key).first()
  const object = row && await ctx.env.PHOTOS.get(key)
  if (!object) throw notFound("We can't find that photo.")
  return new Response(object.body, {
    status: 200,
    headers: {
      'content-type': row.content_type,
      'cache-control': 'private, max-age=86400',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      // The demo photos are SVG: opened on their own they may never run script or load anything.
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox"
    }
  })
}

// ---- staff routes ----

async function requireStaff (ctx) {
  const auth = ctx.request.headers.get('Authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  const ok = token && await ctx.db.prepare('SELECT 1 FROM staff_sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(await sha256Hex(token), iso(ctx.now)).first()
  if (!ok) throw unauthorized('Sign in again.')
  return token
}

async function signin (ctx) {
  const body = await readJson(ctx.request)
  await rateGuard(ctx, 'pin') // once tripped, even the right PIN waits for the window
  const settings = await loadSettings(ctx.db)
  if (!await verifyPin(typeof body.pin === 'string' ? body.pin : '', settings)) {
    await attemptStmt(ctx, 'pin').run() // count the wrong PIN
    throw unauthorized('That PIN is not right.', 'pin')
  }
  const token = randomKey(24)
  const expiresAt = iso(ctx.now + SESSION_MS)
  await ctx.db.prepare('INSERT INTO staff_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256Hex(token), iso(ctx.now), expiresAt).run()
  return json(200, { token, expires_at: expiresAt })
}

async function signout (ctx) {
  const token = await requireStaff(ctx)
  await ctx.db.prepare('DELETE FROM staff_sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run()
  return json(200, { ok: true })
}

function listFilters (q) {
  const val = k => { const v = q.get(k); return v === null || v === '' ? null : v }
  const f = { status: val('status'), category: val('category'), ward: val('ward'), minAge: val('min_age_days'), overdue: val('overdue') }
  if (f.status !== null && ![...BOARD_STATUSES, 'merged', 'open', 'closed'].includes(f.status)) throw badRequest('status', 'Pick a status.')
  if (f.category !== null && !CATEGORY_KEYS.includes(f.category)) throw badRequest('category', 'Pick one of the categories.')
  if (f.ward !== null && !TOWN.wards.some(w => w.id === f.ward)) throw badRequest('ward', 'Pick one of the wards.')
  if (f.minAge !== null) {
    if (!/^\d{1,5}$/.test(f.minAge)) throw badRequest('min_age_days', 'Use a whole number of days.')
    f.minAge = Number(f.minAge)
  }
  if (f.overdue !== null && f.overdue !== '1' && f.overdue !== '0') throw badRequest('overdue', 'Use overdue=1 for overdue reports only.')
  return f
}

function statusMatches (status, filter) {
  if (filter === null) return status !== 'merged'
  if (filter === 'open') return OPEN_STATUSES.includes(status)
  if (filter === 'closed') return CLOSED_STATUSES.includes(status)
  return status === filter
}

/** The board list and the CSV share this: every filter, counts (all filters but status), list order. Items are { s: summary, row }. */
async function filteredRequests (ctx) {
  const f = listFilters(ctx.url.searchParams)
  const settings = await loadSettings(ctx.db)
  const { results } = await ctx.db.prepare(`${REQUEST_SELECT} ORDER BY r.created_at, r.id`).all()
  const items = results.map(row => ({ row, s: summary(row, settings, ctx.now) })).filter(({ s }) =>
    (f.category === null || s.category === f.category) &&
    (f.ward === null || s.ward === f.ward) &&
    (f.minAge === null || s.age_days >= f.minAge) &&
    (f.overdue !== '1' || s.overdue))
  const counts = Object.fromEntries(BOARD_STATUSES.map(st => [st, items.filter(({ s }) => s.status === st).length]))
  return { counts, items: items.filter(({ s }) => statusMatches(s.status, f.status)) }
}

async function listRequests (ctx) {
  const { counts, items } = await filteredRequests(ctx)
  return json(200, { now: iso(ctx.now), now_label: fullLabel(ctx.now), counts, requests: items.map(({ s }) => s) })
}

async function exportCsv (ctx) {
  const { items } = await filteredRequests(ctx)
  const body = toCsv(items.map(({ s, row }) => ({ ...s, public_message: row.public_message })))
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="harbour-pond-requests-${nlDate(ctx.now)}.csv"`,
      ...API_HEADERS
    }
  })
}

async function getRequest (ctx, id) {
  return json(200, await staffDetail(ctx, id))
}

async function updateRequest (ctx, id) {
  const { db } = ctx
  const body = await readJson(ctx.request)
  const settings = await loadSettings(db)
  const row = await loadRow(db, id)
  if (!Number.isInteger(body.version)) throw badRequest('version', 'Reload this report and try again.')
  if (row.status === 'merged') throw badState(`This report was joined with ${refOf(row.merged_into)}. Change that one instead.`)
  const stale = async () => new HttpError(409, 'stale', 'Someone else changed this report. Reload to see their change.',
    { request: await staffDetail(ctx, id, settings) })
  if (body.version !== row.version) throw await stale()

  if (has(body, 'status') && !BOARD_STATUSES.includes(body.status)) throw badRequest('status', 'Pick a status.')
  let crewId = row.crew_id
  let crewName = row.crew_name ?? null
  if (has(body, 'crew_id') && body.crew_id !== row.crew_id) {
    if (body.crew_id === null) {
      crewId = null
      crewName = null
    } else {
      const crew = Number.isSafeInteger(body.crew_id) ? await db.prepare('SELECT * FROM crews WHERE id = ? AND active = 1').bind(body.crew_id).first() : null
      if (!crew) throw badRequest('crew_id', 'Pick one of the crews.')
      crewId = crew.id
      crewName = crew.name
    }
  }
  let message = row.public_message
  if (has(body, 'public_message')) {
    if (body.public_message !== null && typeof body.public_message !== 'string') throw badRequest('public_message', 'Keep the message under 500 characters.')
    const text = (body.public_message ?? '').trim()
    if (chars(text) > 500) throw badRequest('public_message', 'Keep the message under 500 characters.')
    message = text || null
  }
  let status = row.status
  if (has(body, 'status')) status = body.status
  else if (crewId !== row.crew_id && crewId !== null && row.status === 'new') status = 'assigned' // only when the crew changes (clarification 10)
  if ((status === 'assigned' || status === 'in_progress') && crewId === null) throw badRequest('crew_id', 'Pick a crew first.')
  if (status === 'wont_fix' && !message) throw badRequest('public_message', 'Say why in the message to the public.')

  const entries = []
  if (crewId !== row.crew_id) entries.push(H.crew(crewName))
  if (status !== row.status) entries.push(H.status(status))
  if (message !== row.public_message) entries.push(message === null ? H.message(null) : H.message(message))
  if (!entries.length) return json(200, await staffDetail(ctx, id, settings))

  const at = iso(ctx.now)
  let closedAt = row.closed_at
  if (isOpen(status)) closedAt = null
  else if (!CLOSED_STATUSES.includes(row.status)) closedAt = at
  try {
    await db.batch([
      db.prepare('UPDATE requests SET status = ?, crew_id = ?, public_message = ?, closed_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?')
        .bind(status, crewId, message, closedAt, at, id, body.version), // the version this client saw, not the one just read
      guardOneChange(db),
      ...entries.map(e => historyStmt(db, id, at, e))
    ])
  } catch (e) {
    if (isGuardRefusal(e)) throw await stale()
    throw e
  }
  return json(200, await staffDetail(ctx, id, settings))
}

async function addNote (ctx, id) {
  const body = await readJson(ctx.request)
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text || chars(text) > 1000) throw badRequest('text', 'Write the note first.')
  await loadRow(ctx.db, id)
  await historyStmt(ctx.db, id, iso(ctx.now), H.note(text)).run()
  return json(201, await staffDetail(ctx, id))
}

async function candidates (ctx, id) {
  const settings = await loadSettings(ctx.db)
  const row = await loadRow(ctx.db, id)
  const { results } = await ctx.db.prepare(`${REQUEST_SELECT} WHERE r.category = ? AND r.id != ? AND r.status IN (${OPEN_SQL})`)
    .bind(row.category, id).all()
  const found = results
    .map(r => ({ r, d: haversine([row.lat, row.lng], [r.lat, r.lng]) }))
    .filter(x => x.d <= CANDIDATE_METRES)
    .sort((a, b) => a.d - b.d || a.r.id - b.r.id)
    .slice(0, MAX_NEARBY)
  return json(200, { requests: found.map(({ r, d }) => ({ ...summary(r, settings, ctx.now), distance_m: Math.round(d) })) })
}

async function mergeRequest (ctx, id, attempt = 0) {
  const { db } = ctx
  const body = ctx.body ?? (ctx.body = await readJson(ctx.request))
  const source = await loadRow(db, id)
  if (!Number.isSafeInteger(body.into_id) || body.into_id === id) throw badRequest('into_id', 'Pick a different report to join it with.')
  const target = await loadRow(db, body.into_id)
  if (source.status === 'merged') throw badState(`This report was already joined with ${refOf(source.merged_into)}.`)
  if (target.status === 'merged') {
    const next = refOf(target.merged_into)
    throw badState(`${refOf(target.id)} was itself joined with ${next}. Join with ${next} instead.`)
  }
  const added = source.plus_ones + 1
  const at = iso(ctx.now)
  try {
    await db.batch([
      db.prepare(`UPDATE requests SET status = 'merged', merged_into = ?, closed_at = CASE WHEN status IN (${OPEN_SQL}) THEN ? ELSE closed_at END,
        updated_at = ?, version = version + 1 WHERE id = ? AND version = ? AND status != 'merged'`)
        .bind(target.id, at, at, source.id, source.version),
      guardOneChange(db),
      db.prepare("UPDATE requests SET plus_ones = plus_ones + ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ? AND status != 'merged'")
        .bind(added, at, target.id, target.version),
      guardOneChange(db),
      db.prepare('UPDATE requests SET merged_into = ? WHERE merged_into = ?').bind(target.id, source.id),
      historyStmt(db, source.id, at, H.mergedInto(refOf(target.id))),
      historyStmt(db, target.id, at, H.mergedIn(refOf(source.id), added))
    ])
  } catch (e) {
    // Someone changed either report between the read and the batch: nothing was written; decide again on fresh rows.
    if (!isGuardRefusal(e)) throw e
    if (attempt < 2) return mergeRequest(ctx, id, attempt + 1)
    throw badState('Someone else changed one of these reports. Reload and try again.') // clarification 13
  }
  const settings = await loadSettings(db)
  return json(200, { request: await staffDetail(ctx, target.id, settings), merged: await staffDetail(ctx, source.id, settings) })
}

const CREW_SELECT = `SELECT c.id, c.name, c.active,
  (SELECT COUNT(*) FROM requests r WHERE r.crew_id = c.id AND r.status IN (${OPEN_SQL})) AS open_count FROM crews c`
const crewView = c => ({ id: c.id, name: c.name, active: c.active === 1, open_count: c.open_count })

async function listCrews (ctx) {
  const { results } = await ctx.db.prepare(`${CREW_SELECT} ORDER BY c.id`).all()
  return json(200, { crews: results.map(crewView) })
}

function crewNameFrom (value) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name || chars(name) > 40) throw badRequest('name', 'Give the crew a name.')
  return name
}

async function createCrew (ctx) {
  const body = await readJson(ctx.request)
  const name = crewNameFrom(body.name)
  const { meta } = await ctx.db.prepare('INSERT INTO crews (name, active) VALUES (?, 1)').bind(name).run()
  const crew = await ctx.db.prepare(`${CREW_SELECT} WHERE c.id = ?`).bind(meta.last_row_id).first()
  return json(201, crewView(crew))
}

async function updateCrew (ctx, id) {
  const body = await readJson(ctx.request)
  const name = crewNameFrom(body.name)
  if (typeof body.active !== 'boolean') throw badRequest('active', 'Say whether the crew is working.')
  const { meta } = await ctx.db.prepare('UPDATE crews SET name = ?, active = ? WHERE id = ?').bind(name, body.active ? 1 : 0, id).run()
  if (meta.changes !== 1) throw notFound("We can't find that crew.")
  return json(200, crewView(await ctx.db.prepare(`${CREW_SELECT} WHERE c.id = ?`).bind(id).first()))
}

async function changePin (ctx) {
  const body = await readJson(ctx.request)
  if (typeof body.new_pin !== 'string' || !/^\d{4,8}$/.test(body.new_pin)) throw badRequest('new_pin', 'Use 4 to 8 digits.')
  const settings = await loadSettings(ctx.db)
  if (!await verifyPin(typeof body.current_pin === 'string' ? body.current_pin : '', settings)) {
    throw unauthorized('That PIN is not right.', 'current_pin')
  }
  const h = await hashPin(body.new_pin)
  // Sessions are left alone: other people signed in at the counter keep working.
  await ctx.db.prepare('UPDATE settings SET pin_hash = ?, pin_salt = ?, pin_iterations = ? WHERE id = 1').bind(h.pin_hash, h.pin_salt, h.pin_iterations).run()
  return json(200, { ok: true })
}

async function putSettings (ctx) {
  const body = await readJson(ctx.request)
  const phone = field => {
    const v = typeof body[field] === 'string' ? body[field].trim() : ''
    if (!validPhone(v)) throw badRequest(field, 'Type a phone number like 709-555-0100.')
    return v
  }
  const emergencyPhone = phone('emergency_phone')
  const officePhone = phone('office_phone')
  const officeHours = typeof body.office_hours === 'string' ? body.office_hours.trim() : ''
  if (!officeHours || chars(officeHours) > 120) throw badRequest('office_hours', 'Keep the office hours short.')
  const given = body.sla_days && typeof body.sla_days === 'object' && !Array.isArray(body.sla_days) ? body.sla_days : {}
  const slaDays = {}
  for (const key of CATEGORY_KEYS) {
    const v = given[key]
    if (!(v === null || (Number.isInteger(v) && v >= 1 && v <= 365))) {
      throw badRequest(`sla_days.${key}`, 'Use 1 to 365 days, or leave it blank for no target.')
    }
    slaDays[key] = v
  }
  await ctx.db.prepare('UPDATE settings SET emergency_phone = ?, office_phone = ?, office_hours = ?, sla_days = ? WHERE id = 1')
    .bind(emergencyPhone, officePhone, officeHours, JSON.stringify(slaDays)).run()
  return getSettings(ctx)
}

async function weeklyReport (ctx) {
  const asked = ctx.url.searchParams.get('week')
  if (asked !== null && asked !== '' && !parseIsoDate(asked)) throw badRequest('week', 'Pick a week.')
  const week = weekOf(asked ? asked : nlDate(ctx.now))
  const settings = await loadSettings(ctx.db)
  const { results } = await ctx.db.prepare(`${REQUEST_SELECT} ORDER BY r.created_at, r.id`).all()
  const counted = results.filter(r => r.status !== 'merged') // merged requests are the same problem counted once
  const inWeek = at => at !== null && at >= week.start_at && at < week.end_at
  const closedIn = rows => rows.filter(r => CLOSED_STATUSES.includes(r.status) && inWeek(r.closed_at))
  const average = rows => (rows.length
    ? meanDaysHalfUp(rows.reduce((sum, r) => sum + (ms(r.closed_at) - ms(r.created_at)), 0), rows.length)
    : null)
  const rows = CATEGORIES.map(c => {
    const mine = counted.filter(r => r.category === c.key)
    const closed = closedIn(mine)
    return { category: c.key, label: c.label, opened: mine.filter(r => inWeek(r.created_at)).length, closed: closed.length, avg_days_to_close: average(closed) }
  })
  const allClosed = closedIn(counted)
  const open = counted.filter(r => isOpen(r.status)).map(r => summary(r, settings, ctx.now))
  return json(200, {
    ...week,
    rows,
    totals: { opened: rows.reduce((n, r) => n + r.opened, 0), closed: allClosed.length, avg_days_to_close: average(allClosed) },
    open_now: open.length,
    overdue_now: open.filter(s => s.overdue).length,
    oldest_open: open.slice(0, 5)
  })
}

async function getSettings (ctx) {
  const s = await loadSettings(ctx.db)
  return json(200, {
    town_name: s.town_name,
    emergency_phone: s.emergency_phone,
    office_phone: s.office_phone,
    office_hours: s.office_hours,
    sla_days: Object.fromEntries(CATEGORY_KEYS.map(k => [k, s.sla_days[k] ?? null]))
  })
}

// ---- test routes (TEST_MODE=1 only) ----

/** Every table wiped (rate guards included), SAMPLE settings, PIN and crews written, every photo object removed. */
async function resetAll (ctx) {
  await ctx.db.batch(resetStatements(ctx.db))
  let cursor
  do {
    const page = await ctx.env.PHOTOS.list({ cursor })
    if (page.objects.length) await ctx.env.PHOTOS.delete(page.objects.map(o => o.key))
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
}

async function testReset (ctx) {
  await resetAll(ctx)
  return json(200, { pin: SAMPLE_PIN, crews: SAMPLE_CREWS.map(c => ({ id: c.id, name: c.name, active: true, open_count: 0 })) })
}

async function testSeed (ctx) {
  const body = await readJson(ctx.request)
  if (body.scenario !== 'demo') throw badRequest('scenario', 'Use the scenario "demo".')
  await resetAll(ctx)
  const requests = await seedDemo(ctx)
  return json(200, {
    pin: SAMPLE_PIN,
    requests: requests.map(r => ({ id: r.id, ref: r.ref, status: r.status, status_url: statusUrl(ctx, r.status_key) }))
  })
}

// ---- router ----

const ID = '(\\d{1,15})'
const ROUTES = [
  ['GET', '/api/town', getTown],
  ['GET', '/api/town/locate', locate],
  ['POST', '/api/requests', createRequest],
  ['GET', '/api/requests/nearby', nearby],
  ['PUT', `/api/requests/${ID}/photo`, uploadPhoto, 'id'],
  ['POST', `/api/requests/${ID}/me-too`, meToo, 'id'],
  ['GET', '/api/status/([^/]+)', publicStatus],
  ['GET', '/api/photos/([^/]+)', getPhoto],
  ['POST', '/api/staff/signin', signin],
  ['POST', '/api/staff/signout', signout],
  ['GET', '/api/staff/requests', listRequests, 'staff'],
  ['GET', `/api/staff/requests/${ID}`, getRequest, 'staff id'],
  ['PUT', `/api/staff/requests/${ID}`, updateRequest, 'staff id'],
  ['POST', `/api/staff/requests/${ID}/notes`, addNote, 'staff id'],
  ['GET', `/api/staff/requests/${ID}/candidates`, candidates, 'staff id'],
  ['POST', `/api/staff/requests/${ID}/merge`, mergeRequest, 'staff id'],
  ['GET', '/api/staff/crews', listCrews, 'staff'],
  ['GET', '/api/staff/settings', getSettings, 'staff'],
  ['PUT', '/api/staff/settings', putSettings, 'staff'],
  ['PUT', '/api/staff/pin', changePin, 'staff'],
  ['POST', '/api/staff/crews', createCrew, 'staff'],
  ['PUT', `/api/staff/crews/${ID}`, updateCrew, 'staff id'],
  ['GET', '/api/staff/report/weekly', weeklyReport, 'staff'],
  ['GET', '/api/staff/export\\.csv', exportCsv, 'staff'],
  ['POST', '/api/test/reset', testReset, 'test'],
  ['POST', '/api/test/seed', testSeed, 'test']
].map(([method, path, handler, flags = '']) => ({ method, re: new RegExp(`^${path}$`), handler, flags: flags.split(' ') }))

async function route (request, env) {
  const url = new URL(request.url)
  const ctx = { request, env, url, db: env.DB, now: clockNow(request, env), ip: clientIp(request, env), origin: url.origin }
  for (const r of ROUTES) {
    const m = url.pathname.match(r.re)
    if (!m || r.method !== request.method) continue
    if (r.flags.includes('test') && !isTestMode(env)) break
    if (r.flags.includes('staff')) await requireStaff(ctx)
    // A malformed escape in a key reaches the handler as null, which answers its own 404 (clarification 11).
    const decoded = s => { try { return decodeURIComponent(s) } catch { return null } }
    const arg = r.flags.includes('id') ? Number(m[1]) : m[1] === undefined ? undefined : decoded(m[1])
    return r.handler(ctx, arg)
  }
  throw notFound('Not found.')
}

export default {
  async fetch (request, env) {
    try {
      return await route(request, env)
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, e.body)
      console.error(e)
      return json(500, { error: 'Something went wrong. Try again.', code: 'server_error' })
    }
  }
}
