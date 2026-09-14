// Shared fixture and helpers for the e2e suite (runs against the real Worker).
// - Every test starts with POST /api/test/reset (auto fixture `seed`).
// - The map style (https://tiles.openfreemap.org/styles/*) is answered with a tiny local style (a background layer only, so MapLibre
//   asks for no tiles, glyphs or sprites), and any other request that leaves 127.0.0.1 is aborted and fails the test (auto fixture
//   `guarded`).
// - REAL input only: tap() hit-tests the target's centre with elementFromPoint before a real touch or click, map taps go through
//   tapAt() at a point hit-tested to the map, typing is page.keyboard, photos go through the real file chooser with a generated
//   image, location comes from the context's geolocation. evaluate is only ever used to read (and scroll a target into view).
import { test as base, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { png } from './png.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export { expect }
const HERE = path.dirname(fileURLToPath(import.meta.url))
const SHOTS = path.join(HERE, 'shots')
export const PIN = '3690'
export const TOWN_NAME = 'SAMPLE Town of Harbour Pond (demo)'
export const POINTS = JSON.parse(readFileSync(path.join(HERE, '..', '..', 'data', 'test-points.json'), 'utf8'))

/* ---- geometry for arranging data ---------------------------------------------- */
// A point moved north by `metres` (1 m = 1 / 111195.0797 degrees of latitude on the 6 371 008.8 m sphere).
export const north = ([lat, lng], metres) => [lat + metres / 111195.0797, lng]

/* ---- generated images ------------------------------------------------------------ */
export { png }
// 2400 x 1800, so the phone has to shrink it to 1600 x 1200.
export const PHOTO = {
  name: 'pothole-sample.png',
  mimeType: 'image/png',
  buffer: png(2400, 1800, (x, y) => (y > 1100 ? [70, 72, 76] : [120 + (x * 80) / 2400, 130 + (y * 60) / 1800, 140])),
}
export const TEST_STYLE = { version: 8, name: 'Town Service Requests test style (local fixture)', sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e9eef2' } }] }

/* ---- the network guard ------------------------------------------------------------ */
export async function guard(context) {
  const outside = []
  const styles = []
  await context.route('https://tiles.openfreemap.org/**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/styles/')) { styles.push(url.href); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TEST_STYLE) }) }
    outside.push(url.href)
    return route.abort('blockedbyclient')
  })
  await context.route(
    // blob: and data: URLs are objects inside the page, not network requests (MapLibre starts its web worker from a blob: URL).
    (url) => url.protocol !== 'blob:' && url.protocol !== 'data:' && url.hostname !== '127.0.0.1' && url.hostname !== 'tiles.openfreemap.org',
    (route) => { outside.push(route.request().url()); return route.abort('blockedbyclient') },
  )
  return { outside, styles }
}

export const test = base.extend({
  guarded: [async ({ context }, use) => {
    const g = await guard(context)
    await use(g)
    expect(g.outside, 'every request stays on 127.0.0.1 (the map style goes to the local fixture)').toEqual([])
  }, { auto: true }],
  seed: [async ({ request }, use) => {
    const r = await request.post('/api/test/reset')
    expect(r.status(), 'POST /api/test/reset').toBe(200)
    await use(await r.json())
  }, { auto: true }],
})

/* ---- real input ---------------------------------------------------------------------- */
// '' when the point hit-tests to the element (or a child), else a snippet of what is on top.
async function hitAt(locator, x, y) {
  return locator.evaluate((el, [px, py]) => {
    const t = document.elementFromPoint(px, py)
    return t === el || el.contains(t) ? '' : t ? t.outerHTML.slice(0, 160) : 'nothing'
  }, [x, y])
}

export async function hitTest(locator) {
  const box = await locator.boundingBox()
  if (!box) return { box, hit: 'no box' }
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  return { box, x, y, hit: await hitAt(locator, x, y) }
}

async function intoView(page, locator) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  const vh = page.viewportSize().height
  if (box && (box.y + box.height / 2 < 0 || box.y + box.height / 2 > vh)) await locator.evaluate((el) => el.scrollIntoView({ block: 'center' }))
}

export const isTouch = (page) => page.evaluate(() => matchMedia('(pointer: coarse)').matches)

export async function tap(page, locator, label = String(locator)) {
  await expect(locator, `tap(${label}): visible`).toBeVisible()
  await intoView(page, locator)
  const { x, y, hit } = await hitTest(locator)
  expect(hit, `tap(${label}) hit-test at ${Math.round(x)},${Math.round(y)}: something else is on top`).toBe('')
  if (await isTouch(page)) await page.touchscreen.tap(x, y)
  else await page.mouse.click(x, y)
}

// A tap or click at a fraction (fx, fy) of an element's box (the map), hit-tested to that element first.
export async function tapAt(page, locator, fx, fy, label = 'map') {
  await expect(locator).toBeVisible()
  await intoView(page, locator)
  const box = await locator.boundingBox()
  const x = box.x + box.width * fx
  const y = box.y + box.height * fy
  expect(await hitAt(locator, x, y), `tapAt(${label}) hit-test at ${Math.round(x)},${Math.round(y)}`).toBe('')
  if (await isTouch(page)) await page.touchscreen.tap(x, y)
  else await page.mouse.click(x, y)
}

// Tap the field, then type with the keyboard. In chromium touch projects keys can drop after a tap; then the field is
// emptied with Backspace and the text goes in with insertText. Either way the field's value is asserted.
export async function typeText(page, locator, text, label = 'field') {
  await tap(page, locator, label)
  await page.keyboard.type(text)
  if ((await locator.inputValue()) !== text) {
    const n = (await locator.inputValue()).length
    for (let i = 0; i < n; i++) await page.keyboard.press('Backspace')
    await page.keyboard.insertText(text)
  }
  await expect(locator, `${label} holds what was typed`).toHaveValue(text)
}

export async function choosePhoto(page, locator, label = 'Add a photo', file = PHOTO) {
  const chooser = page.waitForEvent('filechooser')
  await tap(page, locator, label)
  await (await chooser).setFiles(file)
}

// The pin the resident page placed, read from its data-lat / data-lng attributes.
export async function readPin(page) {
  const el = page.locator('#where-label')
  return [Number(await el.getAttribute('data-lat')), Number(await el.getAttribute('data-lng'))]
}

/* ---- API setup and reading (arranging data is not UI state) ---------------------------- */
export async function api(request, method, url, { data, headers = {}, token } = {}) {
  const h = { ...headers }
  if (token) h.Authorization = `Bearer ${token}`
  const r = await request.fetch(url, { method, data, headers: h })
  let body = null
  try { body = await r.json() } catch {}
  return { status: r.status(), body, headers: r.headers() }
}

export async function staffToken(request, pin = PIN) {
  const r = await api(request, 'POST', '/api/staff/signin', { data: { pin } })
  expect(r.status, 'sign in with the SAMPLE PIN').toBe(200)
  return r.body.token
}

const uuid4 = () => crypto.randomUUID()
// Arrange a request through the resident API. `at` (ISO) sets the server clock for that call (TEST_MODE X-Test-Now).
export async function makeRequest(request, { category = 'pothole', point = POINTS.inside_centre, at, ...rest } = {}) {
  const headers = at ? { 'X-Test-Now': at } : {}
  const r = await api(request, 'POST', '/api/requests', {
    headers, data: { submission_id: uuid4(), device_id: uuid4(), category, lat: point[0], lng: point[1], has_photo: false, ...rest },
  })
  expect(r.status, `arrange a ${category} request: ${JSON.stringify(r.body)}`).toBe(201)
  return r.body
}

export async function shot(page, testInfo, name, { fullPage = true } = {}) {
  await page.screenshot({ path: path.join(SHOTS, `${testInfo.project.name}-${name}.png`), fullPage, animations: 'disabled' })
}

/* ---- colour ---------------------------------------------------------------------------- */
const channel = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
export const rgb = (css) => css.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number)
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/* ---- more arranging and reading through the API ------------------------------------------ */
export const statusPath = (url) => { const u = new URL(url); return u.pathname + u.search }

export async function staffGet(request, token, id) {
  const r = await api(request, 'GET', `/api/staff/requests/${id}`, { token })
  expect(r.status, `GET staff request ${id}`).toBe(200)
  return r.body
}

export async function staffList(request, token, query = '') {
  const r = await api(request, 'GET', `/api/staff/requests${query}`, { token })
  expect(r.status, `GET staff requests ${query}`).toBe(200)
  return r.body
}

// Every request the Worker holds, merged ones included.
export async function requestCount(request, token) {
  const all = await staffList(request, token)
  const merged = await staffList(request, token, '?status=merged')
  return all.requests.length + merged.requests.length
}

// A staff change through the API at the request's current version (arranging, or "someone else at the counter").
export async function staffPut(request, token, id, changes) {
  const current = await staffGet(request, token, id)
  const r = await api(request, 'PUT', `/api/staff/requests/${id}`, { token, data: { version: current.version, ...changes } })
  expect(r.status, `PUT staff request ${id}: ${JSON.stringify(r.body)}`).toBe(200)
  return r.body
}

export async function meToo(request, id) {
  const r = await api(request, 'POST', `/api/requests/${id}/me-too`, { data: { device_id: crypto.randomUUID() } })
  expect(r.status, `me-too on ${id}`).toBe(201)
  return r.body
}

export async function mergeInto(request, token, id, intoId) {
  const r = await api(request, 'POST', `/api/staff/requests/${id}/merge`, { token, data: { into_id: intoId } })
  expect(r.status, `merge ${id} into ${intoId}: ${JSON.stringify(r.body)}`).toBe(200)
  return r.body
}

// `at`: the same X-Test-Now the request was created with. Upload tokens expire an hour after they are issued, so a request made
// "5 days ago" needs its photo sent at that time too.
export async function putPhoto(request, created, { file = PHOTO, at } = {}) {
  const headers = { Authorization: `Bearer ${created.upload_token}`, 'Content-Type': file.mimeType, ...(at ? { 'X-Test-Now': at } : {}) }
  const r = await request.fetch(new URL(created.upload_url).pathname, { method: 'PUT', data: file.buffer, headers })
  expect(r.status(), 'photo upload').toBe(200)
}

/* ---- staff app ------------------------------------------------------------------------------ */
export async function signIn(page, pin = PIN) {
  await page.goto('/staff/')
  await typeText(page, page.locator('#pin'), pin, 'PIN')
  await tap(page, page.locator('#signin-btn'), 'Sign in')
  await expect(page.locator('#board')).toHaveAttribute('data-loaded', /\d+/)
}

// At 390 one column shows at a time and a tab switches it; at 1280 all five show.
export async function showColumn(page, status) {
  const tab = page.locator(`.col-tab[data-col="${status}"]`)
  if (await tab.isVisible()) await tap(page, tab, `column tab ${status}`)
  const col = page.locator(`.col[data-col="${status}"]`)
  await expect(col).toBeVisible()
  return col
}

export async function openCard(page, ref, status) {
  const col = await showColumn(page, status)
  await tap(page, col.locator(`[data-ref="${ref}"]`), `card ${ref}`)
  await expect(page.locator('#detail-ref')).toHaveText(ref)
}

/* ---- the resident map ------------------------------------------------------------------------ */
// Tap the screen point of [lat, lng] on a map, worked out from the map's own data-zoom / data-center-* (Web Mercator, 256 px
// tiles) and hit-tested to the map first.
export async function tapLatLng(page, locator, [lat, lng], label) {
  await locator.scrollIntoViewIfNeeded()
  const m = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { left: r.left + el.clientLeft, top: r.top + el.clientTop, w: el.clientWidth, h: el.clientHeight, zoom: Number(el.dataset.zoom), lat: Number(el.dataset.centerLat), lng: Number(el.dataset.centerLng) }
  })
  const scale = 256 * 2 ** m.zoom
  const px = (la, ln) => [((ln + 180) / 360) * scale, ((1 - Math.log(Math.tan(Math.PI / 4 + (la * Math.PI) / 360)) / Math.PI) / 2) * scale]
  const [cx, cy] = px(m.lat, m.lng)
  const [x0, y0] = px(lat, lng)
  const x = m.left + m.w / 2 + (x0 - cx)
  const y = m.top + m.h / 2 + (y0 - cy)
  expect(x > m.left + 50 && x < m.left + m.w - 10 && y > m.top + 10 && y < m.top + m.h - 50, `${label}: ${lat},${lng} is on the visible map (${Math.round(x)},${Math.round(y)})`).toBe(true)
  expect(await hitAt(locator, x, y), `tapLatLng(${label}) hit-test at ${Math.round(x)},${Math.round(y)}`).toBe('')
  if (await isTouch(page)) await page.touchscreen.tap(x, y)
  else await page.mouse.click(x, y)
}

export async function zoomOutTo(page, zoom) {
  const map = page.locator('#map')
  let z = Number(await map.getAttribute('data-zoom'))
  while (z > zoom) {
    await tap(page, page.locator('#map .leaflet-control-zoom-out'), 'zoom out')
    z -= 1
    await expect(map).toHaveAttribute('data-zoom', String(z))
  }
}

/* ---- privacy: what a page received ------------------------------------------------------------ */
// Every response body the page receives from now on (HTML, scripts, styles and API answers).
export function recordBodies(page) {
  const bodies = []
  page.on('response', async (r) => {
    try { bodies.push({ url: r.url(), text: (await r.body()).toString('utf8') }) } catch {}
  })
  return bodies
}

/* ---- screenshots: a base map drawn from the town's own street lines (still nothing leaves 127.0.0.1) ---------- */
export function streetStyle() {
  const town = JSON.parse(readFileSync(path.join(HERE, '..', '..', 'data', 'town.json'), 'utf8'))
  return {
    version: 8,
    name: 'Screenshot stand-in (town street lines from data/town.json)',
    sources: {
      streets: {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: town.streets.map((s) => ({ type: 'Feature', properties: { name: s.name }, geometry: { type: 'MultiLineString', coordinates: s.lines.map((run) => run.map(([la, ln]) => [ln, la])) } })) },
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#eef1f3' } },
      { id: 'street-casing', type: 'line', source: 'streets', paint: { 'line-color': '#c9d1d8', 'line-width': 7 }, layout: { 'line-cap': 'round', 'line-join': 'round' } },
      { id: 'street', type: 'line', source: 'streets', paint: { 'line-color': '#ffffff', 'line-width': 5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } },
    ],
  }
}
// Registered after the guard, so it answers the style request first (Playwright runs the newest matching route first).
export async function useStreetStyle(context) {
  const body = JSON.stringify(streetStyle())
  await context.route('https://tiles.openfreemap.org/styles/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body }))
}
