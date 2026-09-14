// M1 smoke + screenshots for the resident page and the status page. Runs against the in-browser mock (?mock=1) on the dev
// server (serve.mjs, 8501), because ts1's Worker is not merged yet. Not the @playwright/test suite: that is M2, against the real
// Worker. Real input only: every tap goes through tap() (elementFromPoint on the target's centre first), map taps through
// tapAt(), typing is page.keyboard, the photo goes through the real file chooser with a generated PNG, location is the
// context's geolocation. evaluate only ever reads.
// Nothing leaves 127.0.0.1: the OpenFreeMap style is answered with a local stand-in drawn from the town's own street lines
// (data/town.json), so screenshots show streets without touching the internet; any other outside request fails the run.
// Usage (from app/): node tests/shots-m1.mjs [--engine chromium|webkit|all] [--no-shots] [--port 8501] [--only a,b]
// Screenshots (chromium) go to tests/shots/<name>-<390|1280>.png. Exit 1 on any FAIL.
import { chromium, webkit, devices } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { png } from './png.mjs'

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const PORT = Number(opt('--port', 8501))
const BASE = `http://127.0.0.1:${PORT}`
const ENGINES = opt('--engine', 'all') === 'all' ? ['chromium', 'webkit'] : [opt('--engine')]
const SHOTS = !args.includes('--no-shots')
const ONLY = opt('--only', '')
const TOWN_NAME = 'SAMPLE Town of Harbour Pond (demo)'
const OUTSIDE = 'That spot is outside the town. Move the pin inside the line on the map.'
const T = 10_000
const town = JSON.parse(await readFile(path.join(APP, '..', 'data', 'town.json'), 'utf8'))
const POINTS = JSON.parse(await readFile(path.join(APP, '..', 'data', 'test-points.json'), 'utf8'))

// The screenshot base map: background + the town's street lines as GeoJSON. No glyphs, sprites or tiles are requested.
const SHOT_STYLE = {
  version: 8,
  name: 'M1 screenshot stand-in (town street lines)',
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

let passes = 0
let failures = 0
const notes = []

/* ---- server ------------------------------------------------------------------ */
const up = async () => { try { return (await fetch(BASE + '/theme.css')).status === 200 } catch { return false } }
let server = null
if (!(await up())) {
  server = spawn(process.execPath, ['serve.mjs', String(PORT)], { cwd: APP, stdio: 'ignore', env: process.env })
  for (let i = 0; i < 50 && !(await up()); i++) await new Promise((r) => setTimeout(r, 100))
  if (!(await up())) { console.error(`FAIL could not start serve.mjs on ${PORT}`); process.exit(1) }
}
const at = (p) => `${BASE}${p}${p.includes('?') ? '&' : '?'}mock=1`

// 2400 x 1800, so the phone must shrink it to 1600 x 1200.
const PHOTO = { name: 'pothole-sample.png', mimeType: 'image/png', buffer: png(2400, 1800, (x, y) => (y > 1100 ? [70, 72, 76] : [120 + (x * 80) / 2400, 130 + (y * 60) / 1800, 140])) }

/* ---- helpers ------------------------------------------------------------------ */
function check(name, ok, detail = '') {
  if (ok) passes++
  else failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail !== '' ? ` (${detail})` : ''}`)
  if (!ok) throw new Error(`check failed: ${name}`)
}

async function hitAt(loc, x, y) {
  return loc.evaluate((el, [px, py]) => {
    const t = document.elementFromPoint(px, py)
    return t === el || el.contains(t) ? '' : t ? t.outerHTML.slice(0, 140) : 'nothing'
  }, [x, y])
}

async function intoView(page, loc) {
  await loc.waitFor({ state: 'visible', timeout: T })
  await loc.scrollIntoViewIfNeeded()
}

async function tap(page, loc, label, touch) {
  await intoView(page, loc)
  const box = await loc.boundingBox()
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  const hit = await hitAt(loc, x, y)
  if (hit) {
    failures++
    console.log(`  FAIL tap(${label}) hit-test: centre ${Math.round(x)},${Math.round(y)} lands on ${hit}`)
    throw new Error(`tap(${label}) is covered`)
  }
  if (touch) await page.touchscreen.tap(x, y)
  else await page.mouse.click(x, y)
}

async function tapAt(page, loc, fx, fy, label, touch) {
  await intoView(page, loc)
  const box = await loc.boundingBox()
  const x = box.x + box.width * fx
  const y = box.y + box.height * fy
  const hit = await hitAt(loc, x, y)
  check(`tapAt(${label}) hit-tests to the map`, hit === '', hit)
  if (touch) await page.touchscreen.tap(x, y)
  else await page.mouse.click(x, y)
}

async function type(page, loc, text, label, touch) {
  await tap(page, loc, label, touch)
  await page.keyboard.type(text)
  if ((await loc.inputValue()) !== text) {
    notes.push(`${label}: keys dropped after a tap, used insertText`)
    const n = (await loc.inputValue()).length
    for (let i = 0; i < n; i++) await page.keyboard.press('Backspace')
    await page.keyboard.insertText(text)
  }
  check(`${label} holds what was typed`, (await loc.inputValue()) === text, await loc.inputValue())
}

const see = (page, text) => page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: T })
const visible = (page, sel) => page.locator(sel).waitFor({ state: 'visible', timeout: T })

async function size(loc, label, minH, minW = 44) {
  const box = await loc.boundingBox()
  check(`${label} is at least ${minW} x ${minH} px`, box && box.height >= minH && box.width >= minW, box ? `${Math.round(box.width)} x ${Math.round(box.height)}` : 'no box')
}

async function badge(page) {
  await visible(page, '[data-sample]')
  check('SAMPLE badge visible', (await page.locator('[data-sample]').first().innerText()).trim() === 'SAMPLE')
  check('town name shown', (await page.locator('[data-town-name]').first().innerText()).trim() === TOWN_NAME)
}

async function noSideScroll(page, width) {
  if (width !== 390) return
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  check('no horizontal scroll at 390', w[0] <= w[1], `${w[0]} > ${w[1]}`)
}

async function mapReady(page) {
  await page.waitForFunction(() => {
    const m = document.getElementById('map')
    return m && (m.dataset.baseMap === 'unavailable' || m.dataset.styleLoaded === '1')
  }, null, { timeout: 20_000 })
  return page.locator('#map').getAttribute('data-base-map')
}

const pinOf = async (page) => [Number(await page.locator('#where-label').getAttribute('data-lat')), Number(await page.locator('#where-label').getAttribute('data-lng'))]
const store = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('tsr:mock-store')))

async function startPothole(page, touch, key = 'pothole') {
  await tap(page, page.locator(`[data-category="${key}"]`), `category ${key}`, touch)
  await visible(page, '#step-where')
  await mapReady(page)
}

async function searchStreet(page, touch, query, name) {
  await tap(page, page.locator('#search-open'), 'Search a street', touch)
  await type(page, page.locator('#street-q'), query, 'street search', touch)
  await tap(page, page.locator(`.street-opt[data-street="${name}"]`), `street ${name}`, touch)
  await page.locator('#where-label', { hasText: `Near ${name}` }).waitFor({ timeout: T })
}

/* ---- scenarios ------------------------------------------------------------------ */
const scenarios = {
  async home(page, { width, shot, touch }) {
    await page.goto(at('/?reset=1'))
    await visible(page, '#step-home')
    await badge(page)
    const banner = await page.locator('#emergency').innerText()
    check('emergency banner text', banner.includes('Water main break or danger right now? Call the town at 709-555-0142 or 911.'), banner)
    check('emergency number is a tel: link', (await page.locator('#emergency-phone').getAttribute('href')) === 'tel:7095550142')
    const first = await page.evaluate(() => document.querySelector('main').firstElementChild.id)
    check('the emergency banner is first', first === 'emergency', first)
    const cats = page.locator('.cat-btn')
    check('seven category buttons', (await cats.count()) === 7)
    for (let i = 0; i < 7; i++) {
      const c = cats.nth(i)
      await size(c, `category ${await c.getAttribute('data-category')}`, 64)
      await intoView(page, c)
      const box = await c.boundingBox()
      check(`category ${i + 1} hit-tests to itself`, (await hitAt(c, box.x + box.width / 2, box.y + box.height / 2)) === '')
      check(`category ${i + 1} has an SVG icon, no emoji`, (await c.locator('svg').count()) === 1 && !/\p{Extended_Pictographic}/u.test(await c.innerText()))
    }
    const tops = await cats.evaluateAll((els) => els.slice(0, 2).map((e) => Math.round(e.getBoundingClientRect().top)))
    check('two columns of categories', tops[0] === tops[1], tops.join(','))
    if (width === 1280) {
      const w = await page.locator('main').evaluate((el) => el.getBoundingClientRect().width)
      check('centred column at most 560 px at 1280', w <= 560, `${w}`)
    }
    const banner2 = await page.locator('#emergency').evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el).backgroundColor])
    check('banner colours are the Design tokens', banner2[0] === 'rgb(138, 28, 18)' && banner2[1] === 'rgb(253, 236, 234)', banner2.join(' on '))
    await noSideScroll(page, width)
    await shot('home')
  },

  async report(page, { width, shot, touch, context }) {
    await page.goto(at('/?reset=1'))
    await visible(page, '#step-home')
    await startPothole(page, touch)
    check('step line says Step 2 of 4', (await page.locator('#step-where .stepline').innerText()) === 'Step 2 of 4')
    check('Next is disabled before a pin', await page.locator('#where-next').isDisabled())
    if (width === 390) {
      const h = await page.locator('#map').evaluate((el) => el.getBoundingClientRect().height / innerHeight)
      check('map is at least 55 % of the viewport height at 390', h >= 0.55, `${Math.round(h * 100)} %`)
    }
    const links = await page.locator('.leaflet-control-attribution a').evaluateAll((as) => as.map((a) => a.href))
    for (const href of ['https://openfreemap.org/', 'https://www.openmaptiles.org/', 'https://www.openstreetmap.org/copyright']) {
      check(`attribution links ${href}`, links.includes(href), links.join(' '))
    }
    check('attribution visible', await page.locator('.leaflet-control-attribution').isVisible())

    // Use my location, outside the town: the message, Next stays disabled.
    await context.setGeolocation({ latitude: POINTS.outside_south[0], longitude: POINTS.outside_south[1] })
    await tap(page, page.locator('#locate'), 'Use my location (outside)', touch)
    await page.locator('#where-error', { hasText: OUTSIDE }).waitFor({ timeout: T })
    check('outside: the message shows', true)
    check('outside: Next is disabled', await page.locator('#where-next').isDisabled())
    check('outside: the pin is where the phone is', (await pinOf(page))[0] === POINTS.outside_south[0])
    await shot('where-outside', { viewport: true })

    // Use my location inside → the pin lands there.
    await context.setGeolocation({ latitude: POINTS.inside_centre[0], longitude: POINTS.inside_centre[1] })
    await tap(page, page.locator('#locate'), 'Use my location (inside)', touch)
    await page.waitForFunction((lat) => Number(document.getElementById('where-label').dataset.lat) === lat, POINTS.inside_centre[0], { timeout: T })
    check('inside: the message is gone and Next works', (await page.locator('#where-error').innerText()) === '' && !(await page.locator('#where-next').isDisabled()))

    // A real tap on the map near its centre → the pin moves there and stays inside.
    const before = await pinOf(page)
    await tapAt(page, page.locator('#map'), 0.3, 0.4, 'map', touch)
    await page.waitForFunction((lat) => Number(document.getElementById('where-label').dataset.lat) !== lat, before[0], { timeout: T })
    check('a map tap moves the pin', true, (await pinOf(page)).join(','))
    check('the tapped pin is inside', (await page.locator('#where-label').getAttribute('data-inside')) === 'true')

    // Search a street → the pin moves to it and "Near <street>" shows.
    const street = town.streets.find((s) => s.name === 'Main Street') || town.streets[0]
    await searchStreet(page, touch, street.name.slice(0, 4), street.name)
    const pin = await pinOf(page)
    check('search moves the pin to the street', pin[0] === street.point[0] && pin[1] === street.point[1], pin.join(','))
    await noSideScroll(page, width)
    await shot('where', { viewport: true })

    // Next → the mock has HP-1001, a pothole 30 m north of Main Street's point.
    await tap(page, page.locator('#where-next'), 'Next (where)', touch)
    await visible(page, '#step-nearby')
    const cards = page.locator('.near-card')
    check('one report nearby', (await cards.count()) === 1)
    check('it is HP-1001', (await cards.first().getAttribute('data-ref')) === 'HP-1001')
    check('about 30 m', (await cards.first().locator('[data-distance]').innerText()) === 'about 30 m from your pin', await cards.first().locator('[data-distance]').innerText())
    check('+2 others', (await cards.first().locator('.near-plus').innerText()) === '+2 others')
    await size(cards.first().locator('[data-metoo]'), 'Me too', 56)
    await shot('nearby')
    await tap(page, page.locator('#nearby-different'), 'No, mine is different', touch)

    // Photo through the real file chooser.
    await visible(page, '#step-photo')
    check('step line says Step 3 of 4', (await page.locator('#step-photo .stepline').innerText()) === 'Step 3 of 4')
    await size(page.locator('#photo-add'), 'Add a photo', 56)
    const chooser = page.waitForEvent('filechooser', { timeout: T })
    await tap(page, page.locator('#photo-add'), 'Add a photo', touch)
    await (await chooser).setFiles(PHOTO)
    await visible(page, '#photo-chosen')
    const d = await page.locator('#photo-preview').evaluate((el) => ({ ...el.dataset }))
    check('photo shrunk to 1600 x 1200 JPEG', d.width === '1600' && d.height === '1200' && d.type === 'image/jpeg', JSON.stringify(d))
    check('photo under 5 MB', Number(d.bytes) < 5_000_000, d.bytes)
    await page.waitForFunction(() => document.getElementById('photo-preview').complete && document.getElementById('photo-preview').naturalWidth === 1600, null, { timeout: T })
    await shot('photo')
    await tap(page, page.locator('#photo-next'), 'Next (photo)', touch)

    // Details.
    await visible(page, '#step-details')
    await type(page, page.locator('#description'), 'Deep hole by the mailbox (SAMPLE)', 'description', touch)
    check('counter counts', (await page.locator('#description-count').innerText()) === '33 of 500', await page.locator('#description-count').innerText())
    await type(page, page.locator('#name'), 'Robin Test (SAMPLE)', 'name', touch)
    await type(page, page.locator('#phone'), '709-555-0199', 'phone', touch)
    await size(page.locator('#send'), 'Send report', 56)
    await shot('details')
    await tap(page, page.locator('#send'), 'Send report', touch)

    await visible(page, '#step-sent')
    const ref = await page.locator('#sent-ref').innerText()
    check('Report sent with HP-1004', ref === 'HP-1004', ref)
    await page.locator('[data-photo-ok]').waitFor({ timeout: T })
    const s = await store(page)
    const made = s.requests.find((r) => r.id === 1004)
    check('the photo reached the mock as a JPEG', made.photo === 'stored' && made.photo_type === 'image/jpeg', `${made.photo} ${made.photo_type}`)
    check('one new request', s.requests.length === 4)
    check('nothing-is-texted note', (await page.locator('#step-sent .note').innerText()).startsWith('Nothing is texted or emailed.'))
    await noSideScroll(page, width)
    await shot('sent')

    // Open the status page: ref, category, street; no phone, name or description.
    const nav = page.waitForURL(/\/s\/\?k=/, { timeout: T })
    await tap(page, page.locator('#open-status'), 'Open the status page', touch)
    await nav
    await visible(page, '#status-card')
    await badge(page)
    check('status shows the ref', (await page.locator('#status-ref').innerText()) === 'Report HP-1004')
    const what = await page.locator('#status-what').innerText()
    check('status shows Pothole and the street', what.startsWith('Pothole · '), what)
    const text = await page.locator('body').innerText()
    for (const secret of ['709-555-0199', '7095550199', 'Robin Test', 'Deep hole by the mailbox']) check(`status page never shows "${secret}"`, !text.includes(secret))
    check('status has no img and no map', (await page.locator('img, #map, .leaflet-container').count()) === 0)
    check('status page sets no-referrer', (await page.locator('meta[name="referrer"]').getAttribute('content')) === 'no-referrer')
    await noSideScroll(page, width)
    await shot('status-new')

    // Back on / : "Your reports on this phone" lists it.
    await page.goto(at('/'))
    await page.locator('#mine-list a[data-ref="HP-1004"]').waitFor({ timeout: T })
    check('Your reports on this phone lists HP-1004', true)
    await shot('home-with-reports')
  },

  async metoo(page, { width, shot, touch }) {
    await page.goto(at('/?reset=1'))
    await visible(page, '#step-home')
    await startPothole(page, touch)
    await searchStreet(page, touch, 'Main', 'Main Street')
    await tap(page, page.locator('#where-next'), 'Next', touch)
    await visible(page, '#step-nearby')
    await tap(page, page.locator('.near-card[data-ref="HP-1001"] [data-metoo]'), 'Me too', touch)
    await visible(page, '#step-metoo')
    check('Thanks text', (await page.locator('#metoo-text').innerText()) === 'Thanks. We added you to HP-1001.', await page.locator('#metoo-text').innerText())
    const s = await store(page)
    check('the +1 reached the mock and no new request', s.requests.find((r) => r.id === 1001).plus_ones === 3 && s.requests.length === 3)
    await shot('metoo')
    // A second run from the same phone shows it as already added.
    await tap(page, page.locator('#step-metoo [data-restart]'), 'Back to the start', touch)
    await startPothole(page, touch)
    await searchStreet(page, touch, 'Main', 'Main Street')
    await tap(page, page.locator('#where-next'), 'Next', touch)
    await visible(page, '#step-nearby')
    await page.locator('.near-card[data-ref="HP-1001"] [data-added]').waitFor({ timeout: T })
    check('second run: already added, no Me too button', (await page.locator('.near-card[data-ref="HP-1001"] [data-metoo]').count()) === 0)
    await noSideScroll(page, width)
    await shot('nearby-already-added')
  },

  async photoFails(page, { shot, touch }) {
    await page.goto(at('/?reset=1&photo=fail-once'))
    await visible(page, '#step-home')
    await startPothole(page, touch, 'streetlight')
    await tapAt(page, page.locator('#map'), 0.5, 0.5, 'map centre', touch)
    await page.locator('#where-next:not([disabled])').waitFor({ timeout: T })
    await tap(page, page.locator('#where-next'), 'Next', touch)
    await visible(page, '#step-photo')
    const chooser = page.waitForEvent('filechooser', { timeout: T })
    await tap(page, page.locator('#photo-add'), 'Add a photo', touch)
    await (await chooser).setFiles(PHOTO)
    await visible(page, '#photo-chosen')
    await tap(page, page.locator('#photo-next'), 'Next (photo)', touch)
    await tap(page, page.locator('#send'), 'Send report', touch)
    await visible(page, '#step-sent')
    await see(page, "Your report was sent, but the photo didn't go through.")
    check('the report exists although the photo failed', (await store(page)).requests.some((r) => r.id === 1004 && r.photo === 'waiting'))
    await size(page.locator('#photo-retry'), 'Try the photo again', 44)
    await shot('sent-photo-failed')
    await tap(page, page.locator('#photo-retry'), 'Try the photo again', touch)
    await page.locator('[data-photo-ok]').waitFor({ timeout: T })
    const s = await store(page)
    check('retry: photo stored on the same report, still one new request', s.requests.length === 4 && s.requests.find((r) => r.id === 1004).photo === 'stored')
  },

  async otherNeedsText(page, { touch }) {
    await page.goto(at('/?reset=1'))
    await visible(page, '#step-home')
    await startPothole(page, touch, 'other')
    await tapAt(page, page.locator('#map'), 0.5, 0.5, 'map centre', touch)
    await page.locator('#where-next:not([disabled])').waitFor({ timeout: T })
    await tap(page, page.locator('#where-next'), 'Next', touch)
    await tap(page, page.locator('#photo-skip'), 'Skip the photo', touch)
    await visible(page, '#step-details')
    await tap(page, page.locator('#send'), 'Send report', touch)
    await page.locator('#description-error', { hasText: 'Tell us what the problem is.' }).waitFor({ timeout: T })
    check("the API's message shows next to the description", true)
    await type(page, page.locator('#phone'), '12', 'phone', touch)
    await type(page, page.locator('#description'), 'Bench broken (SAMPLE)', 'description', touch)
    await tap(page, page.locator('#send'), 'Send report', touch)
    await page.locator('#phone-error', { hasText: "That phone number doesn't look right." }).waitFor({ timeout: T })
    check("the API's phone message shows next to the phone", (await page.locator('#description-error').innerText()) === '')
    // Back on every step.
    await tap(page, page.locator('#step-details .back'), 'Back (details)', touch)
    await visible(page, '#step-photo')
    await tap(page, page.locator('#step-photo .back'), 'Back (photo)', touch)
    await visible(page, '#step-where')
    await tap(page, page.locator('#step-where .back'), 'Back (where)', touch)
    await visible(page, '#step-home')
    check('Back walks every step to the start', true)
  },

  async status(page, { width, shot }) {
    await page.goto(at('/s/?k=demo-status-sample-1001&reset=1'))
    await visible(page, '#status-card')
    await badge(page)
    check('ref', (await page.locator('#status-ref').innerText()) === 'Report HP-1001')
    check('chip says Assigned', (await page.locator('.chip-big').innerText()) === 'Assigned')
    check('sentence', (await page.locator('#status-sentence').innerText()) === 'A crew has been assigned.')
    check('public message in its box', (await page.locator('#public-message').innerText()).includes('The roads crew is booked for Thursday.'))
    check('+2 others', (await page.locator('#plus-ones').innerText()) === '+2 others reported this')
    check('history has 5 entries', (await page.locator('#history li').count()) === 5)
    check('office phone is a tel: link', (await page.locator('.office a').getAttribute('href')) === 'tel:7095550100')
    const text = await page.locator('body').innerText()
    for (const secret of ['Pat (SAMPLE)', '709-555-0187', 'Deep one by the hydrant']) check(`status never shows "${secret}"`, !text.includes(secret))
    await noSideScroll(page, width)
    await shot('status')
  },

  async statusMerged(page, { width, shot, touch }) {
    await page.goto(at('/s/?k=demo-status-sample-1003&reset=1'))
    await visible(page, '[data-merged]')
    await badge(page)
    check('joined with HP-1001', (await page.locator('[data-merged]').innerText()).startsWith('This report was joined with HP-1001.'))
    await noSideScroll(page, width)
    await shot('status-merged')
    const nav = page.waitForURL(/k=demo-status-sample-1001/, { timeout: T })
    await tap(page, page.locator('[data-merged] a'), 'HP-1001 link', touch)
    await nav
    await visible(page, '#public-message')
    check('the link opens the kept report', true)
  },

  async statusDone(page, { shot }) {
    await page.goto(at('/s/?k=demo-status-sample-1002&reset=1'))
    await visible(page, '#status-card')
    check('done chip', (await page.locator('.chip-big').innerText()) === 'Done')
    check('closed date shows', (await page.locator('.dates').innerText()).includes('Closed '))
    await shot('status-done')
  },

  async statusBad(page, { shot }) {
    await page.goto(at('/s/?k=not-a-real-status-key'))
    await see(page, "We can't find that report. Check the link, or call the town office.")
    await badge(page)
    await shot('status-not-found')
  },
}

/* ---- run ------------------------------------------------------------------------ */
if (SHOTS) await mkdir(path.join(APP, 'tests', 'shots'), { recursive: true })

for (const engine of ENGINES) {
  const browser = await (engine === 'webkit' ? webkit : chromium).launch(engine === 'chromium' ? { args: ['--enable-unsafe-swiftshader'] } : {})
  for (const width of [390, 1280]) {
    const touch = width === 390
    const device = width === 390
      ? engine === 'webkit' ? { ...devices['iPhone 14'] } : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }
    for (const [name, fn] of Object.entries(scenarios)) {
      if (ONLY && !ONLY.split(',').includes(name)) continue
      console.log(`mock ${engine}-${width} ${name}`)
      const context = await browser.newContext({ ...device, geolocation: { latitude: POINTS.inside_centre[0], longitude: POINTS.inside_centre[1] }, permissions: ['geolocation'] })
      const outside = []
      await context.route('https://tiles.openfreemap.org/styles/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SHOT_STYLE) }))
      await context.route((url) => url.protocol !== 'blob:' && url.protocol !== 'data:' && url.hostname !== '127.0.0.1' && !url.href.startsWith('https://tiles.openfreemap.org/styles/'), (route) => { outside.push(route.request().url()); return route.abort() })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      // Screens without a map: the full page. Screens with a map: the viewport with Next in view, because a fullPage capture
      // resizes the viewport faster than the map's GL canvas follows (an empty strip of map that no person ever sees), and a
      // taller viewport would stretch the map (its height is 58 % of the viewport).
      const shot = async (file, { viewport = false } = {}) => {
        if (!SHOTS || engine !== 'chromium') return
        if (viewport) await page.locator('#where-next').scrollIntoViewIfNeeded()
        else await page.evaluate(() => window.scrollY === 0 || new Promise((r) => { window.scrollTo(0, 0); requestAnimationFrame(() => r(true)) }))
        await page.waitForTimeout(300)
        await page.screenshot({ path: path.join(APP, 'tests', 'shots', `${file}-${width}.png`), fullPage: !viewport, animations: 'disabled' })
      }
      try {
        await fn(page, { touch, width, shot, engine, context })
        if (await page.locator('#map').count()) notes.push(`${engine}-${width} ${name}: base map ${await page.locator('#map').getAttribute('data-base-map')}`)
        check('no page errors', errors.length === 0, errors.join(' | '))
        check('no request left 127.0.0.1', outside.length === 0, outside.join(' '))
      } catch (e) {
        if (!/^check failed|is covered$/.test(e.message)) {
          failures++
          console.log(`  FAIL ${name}: ${e.message.split('\n')[0]}`)
          if (errors.length) console.log(`       page errors: ${errors.join(' | ')}`)
        }
      }
      await context.close()
    }
  }
  await browser.close()
}

server?.kill()
for (const n of [...new Set(notes)]) console.log(`NOTE ${n}`)
console.log(`\n${passes} passed, ${failures} failed`)
process.exit(failures ? 1 : 0)
