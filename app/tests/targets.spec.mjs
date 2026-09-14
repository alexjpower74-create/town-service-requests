// Tap targets, the SAMPLE badge, no sideways scroll, colour contrast, and the map attribution.
import {
  test, expect, tap, typeText, choosePhoto, hitTest, contrast, rgb, api, makeRequest, north, staffToken, staffPut, mergeInto,
  signIn, openCard, statusPath, POINTS, TOWN_NAME,
} from './helpers.mjs'

// Every visible button (and link styled as one) inside `scope`: at least 44 px each way, primary buttons at least 56 px tall,
// and the centre hit-tests to the button itself.
async function buttonsOk(page, scope, label) {
  const buttons = page.locator(`${scope} button, ${scope} a.btn`)
  let checked = 0
  for (let i = 0; i < (await buttons.count()); i++) {
    const b = buttons.nth(i)
    if (!(await b.isVisible())) continue
    await b.scrollIntoViewIfNeeded()
    const name = (await b.innerText()).trim().replace(/\s+/g, ' ')
    const { box, hit } = await hitTest(b)
    expect(box.height, `${label} "${name}" is at least 44 px tall`).toBeGreaterThanOrEqual(44)
    expect(box.width, `${label} "${name}" is at least 44 px wide`).toBeGreaterThanOrEqual(44)
    if (await b.evaluate((el) => el.classList.contains('btn-primary'))) expect(box.height, `${label} "${name}" (primary) is at least 56 px tall`).toBeGreaterThanOrEqual(56)
    expect(hit, `${label} "${name}" hit-tests to itself`).toBe('')
    checked++
  }
  expect(checked, `${label}: buttons were found to check`).toBeGreaterThan(0)
}

test('every resident button is at least 44 px (primary 56 px) and hit-tests to itself at 390 @phone', async ({ page, request }) => {
  const town = (await api(request, 'GET', '/api/town')).body
  const main = town.streets.find((s) => s.name === 'Main Street')
  await makeRequest(request, { point: north(main.point, 10) })

  await page.goto('/')
  await expect(page.locator('.cat-btn')).toHaveCount(7)
  await buttonsOk(page, '#step-home', 'home')
  for (const cat of await page.locator('.cat-btn').all()) expect((await cat.boundingBox()).height).toBeGreaterThanOrEqual(64)

  await tap(page, page.locator('[data-category="pothole"]'), 'Pothole')
  await buttonsOk(page, '#step-where', 'where')
  await tap(page, page.locator('#search-open'), 'Search a street')
  await typeText(page, page.locator('#street-q'), 'Main', 'street search')
  await expect(page.locator('.street-opt[data-street="Main Street"]')).toBeVisible()
  await buttonsOk(page, '#street-list', 'street list')
  await tap(page, page.locator('.street-opt[data-street="Main Street"]'), 'Main Street')
  await expect(page.locator('#where-next')).toBeEnabled()
  await buttonsOk(page, '#step-where', 'where with a pin')
  await tap(page, page.locator('#where-next'), 'Next')

  await expect(page.locator('#step-nearby')).toBeVisible()
  await buttonsOk(page, '#step-nearby', 'nearby')
  await tap(page, page.locator('#nearby-different'), 'No, mine is different')
  await buttonsOk(page, '#step-photo', 'photo')
  await choosePhoto(page, page.locator('#photo-add'))
  await expect(page.locator('#photo-chosen')).toBeVisible()
  await buttonsOk(page, '#step-photo', 'photo chosen')
  await tap(page, page.locator('#photo-next'), 'Next (photo)')
  await buttonsOk(page, '#step-details', 'details')
  await tap(page, page.locator('#send'), 'Send report')
  await expect(page.locator('[data-photo-ok]')).toBeVisible()
  await buttonsOk(page, '#step-sent', 'report sent')
})

test('the SAMPLE badge and the town name are on the resident page, the status page and the town office', async ({ page, request }) => {
  const created = await makeRequest(request)
  for (const [url, label] of [['/', 'resident'], [statusPath(created.status_url), 'status'], ['/staff/', 'town office']]) {
    await page.goto(url)
    await expect(page.locator('[data-sample]').first(), `${label}: SAMPLE badge`).toBeVisible()
    await expect(page.locator('[data-sample]').first()).toHaveText('SAMPLE')
    await expect(page.locator('[data-town-name]').first(), `${label}: town name`).toHaveText(TOWN_NAME)
  }
})

test('no horizontal scroll at 390 on any screen @phone', async ({ page, request }) => {
  const created = await makeRequest(request)
  const wide = async (label) => {
    const [scroll, inner] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
    expect(scroll, `${label}: the page is ${scroll} px wide in a ${inner} px window`).toBeLessThanOrEqual(inner)
  }
  await page.goto('/')
  await expect(page.locator('.cat-btn')).toHaveCount(7)
  await wide('resident home')
  await tap(page, page.locator('[data-category="water"]'), 'Water')
  await expect(page.locator('#map')).toHaveAttribute('data-zoom', /\d+/)
  await wide('resident map')
  await page.goto(statusPath(created.status_url))
  await expect(page.locator('#status-ref')).toBeVisible()
  await wide('status')
  await page.goto('/staff/')
  await expect(page.locator('#pin')).toBeVisible()
  await wide('staff sign-in')
  await signIn(page)
  await wide('staff board')
  await openCard(page, created.ref, 'new')
  await wide('staff detail')
})

test('status chips, the emergency banner and primary buttons meet 4.5 : 1', async ({ page, request }) => {
  const token = await staffToken(request)
  const at = (m) => ({ point: north(POINTS.inside_centre, m) })
  const byStatus = { new: await makeRequest(request) }
  byStatus.assigned = await makeRequest(request, at(100))
  await staffPut(request, token, byStatus.assigned.id, { crew_id: 1 })
  byStatus.in_progress = await makeRequest(request, at(200))
  await staffPut(request, token, byStatus.in_progress.id, { crew_id: 1, status: 'in_progress' })
  byStatus.done = await makeRequest(request, at(300))
  await staffPut(request, token, byStatus.done.id, { status: 'done' })
  byStatus.wont_fix = await makeRequest(request, at(400))
  await staffPut(request, token, byStatus.wont_fix.id, { status: 'wont_fix', public_message: 'Private property. (SAMPLE)' })
  byStatus.merged = await makeRequest(request, at(10))
  await mergeInto(request, token, byStatus.merged.id, byStatus.new.id)

  const pair = (loc) => loc.evaluate((el) => {
    let bg = 'rgba(0, 0, 0, 0)'
    for (let n = el; n && /rgba\(0, 0, 0, 0\)|transparent/.test(bg); n = n.parentElement) bg = getComputedStyle(n).backgroundColor
    return [getComputedStyle(el).color, bg]
  })
  for (const [status, created] of Object.entries(byStatus)) {
    await page.goto(statusPath(created.status_url))
    const chip = page.locator('.chip-big')
    await expect(chip).toHaveAttribute('data-status', status)
    const [fg, bg] = await pair(chip)
    expect(contrast(rgb(fg), rgb(bg)), `${status} chip ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
  }

  await page.goto('/')
  await expect(page.locator('#emergency')).toBeVisible()
  for (const sel of ['#emergency p', '#emergency-phone']) {
    const [fg, bg] = await pair(page.locator(sel))
    expect(contrast(rgb(fg), rgb(bg)), `banner ${sel} ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
  }
  const [sfg, sbg] = await pair(page.locator('[data-sample]'))
  expect(contrast(rgb(sfg), rgb(sbg)), `SAMPLE badge ${sfg} on ${sbg}`).toBeGreaterThanOrEqual(4.5)

  await tap(page, page.locator('[data-category="pothole"]'), 'Pothole')
  await tap(page, page.locator('#search-open'), 'Search a street')
  await typeText(page, page.locator('#street-q'), 'Main', 'street search')
  await tap(page, page.locator('.street-opt[data-street="Main Street"]'), 'Main Street')
  await expect(page.locator('#where-next')).toBeEnabled()
  const [nfg, nbg] = await pair(page.locator('#where-next'))
  expect(contrast(rgb(nfg), rgb(nbg)), `Next ${nfg} on ${nbg}`).toBeGreaterThanOrEqual(4.5)

  await page.goto('/staff/')
  const [pfg, pbg] = await pair(page.locator('#signin-btn'))
  expect(contrast(rgb(pfg), rgb(pbg)), `Sign in ${pfg} on ${pbg}`).toBeGreaterThanOrEqual(4.5)
})

test('the resident map shows the OpenFreeMap attribution with its three links', async ({ page }) => {
  await page.goto('/')
  await tap(page, page.locator('[data-category="pothole"]'), 'Pothole')
  const attribution = page.locator('#map .leaflet-control-attribution')
  await expect(attribution).toBeVisible()
  for (const [href, text] of [['https://openfreemap.org', 'OpenFreeMap'], ['https://www.openmaptiles.org/', '© OpenMapTiles'], ['https://www.openstreetmap.org/copyright', 'OpenStreetMap']]) {
    const link = attribution.locator(`a[href="${href}"]`)
    await expect(link, `attribution link ${href}`).toBeVisible()
    await expect(link).toHaveText(text)
    await link.scrollIntoViewIfNeeded()
    expect((await hitTest(link)).hit, `${text} link is not covered`).toBe('')
  }
  await expect(attribution).toContainText('Data from')
})
