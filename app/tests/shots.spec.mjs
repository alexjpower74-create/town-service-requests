// Screenshots on the real Worker (chromium 390 and 1280 only, tag @shots): the resident flow and the town office.
// The base map is a stand-in drawn from the town's street lines (nothing leaves 127.0.0.1). Pictures go to
// tests/shots/<project>-<name>.png. Map screens and the fixed detail panel are viewport captures (a full-page capture resizes
// the viewport faster than the map canvas follows).
import {
  test, expect, tap, tapAt, typeText, choosePhoto, api, makeRequest, meToo, north, staffToken, staffPut, mergeInto, putPhoto,
  signIn, openCard, shot, statusPath, useStreetStyle, POINTS,
} from './helpers.mjs'

const mapReady = (page, sel = '#map') => expect(page.locator(sel)).toHaveAttribute('data-style-loaded', '1', { timeout: 20_000 })

test('screenshots: the resident flow @shots', async ({ page, context, request }, testInfo) => {
  await useStreetStyle(context)
  const town = (await api(request, 'GET', '/api/town')).body
  const main = town.streets.find((s) => s.name === 'Main Street')
  const near = await makeRequest(request, { point: north(main.point, 25), description: 'Deep one by the hydrant (SAMPLE)' })
  await meToo(request, near.id)
  await meToo(request, near.id)

  await page.goto('/')
  await expect(page.locator('.cat-btn')).toHaveCount(7)
  await shot(page, testInfo, 'resident-home')
  await tap(page, page.locator('[data-category="pothole"]'), 'Pothole')
  await mapReady(page)
  await tap(page, page.locator('#search-open'), 'Search a street')
  await typeText(page, page.locator('#street-q'), 'Main', 'street search')
  await tap(page, page.locator('.street-opt[data-street="Main Street"]'), 'Main Street')
  await expect(page.locator('#where-label')).toHaveText('Near Main Street')
  await page.locator('#where-next').scrollIntoViewIfNeeded()
  await page.waitForTimeout(500)
  await shot(page, testInfo, 'resident-where', { fullPage: false })
  await tap(page, page.locator('#where-next'), 'Next')
  await expect(page.locator('.near-card')).toHaveCount(1)
  await shot(page, testInfo, 'resident-nearby')
  await tap(page, page.locator('#nearby-different'), 'No, mine is different')
  await choosePhoto(page, page.locator('#photo-add'))
  await expect(page.locator('#photo-chosen')).toBeVisible()
  await shot(page, testInfo, 'resident-photo')
  await tap(page, page.locator('#photo-next'), 'Next (photo)')
  await typeText(page, page.locator('#description'), 'Another hole a bit further up (SAMPLE)', 'description')
  await typeText(page, page.locator('#name'), 'Sam Sample (SAMPLE)', 'name')
  await typeText(page, page.locator('#phone'), '709-555-0123', 'phone')
  await shot(page, testInfo, 'resident-details')
  await tap(page, page.locator('#send'), 'Send report')
  await expect(page.locator('[data-photo-ok]')).toBeVisible()
  await shot(page, testInfo, 'resident-sent')
  await tap(page, page.locator('#open-status'), 'Open the status page')
  await expect(page.locator('#status-ref')).toBeVisible()
  await shot(page, testInfo, 'status-new')
  await page.goto(statusPath(near.status_url))
  await expect(page.locator('#status-ref')).toBeVisible()
  await shot(page, testInfo, 'status-plus-ones')
})

test('screenshots: the town office @shots', async ({ page, context, request }, testInfo) => {
  await useStreetStyle(context)
  const token = await staffToken(request)
  const days = (n) => new Date(Date.now() - n * 86_400_000).toISOString()
  const at = (m) => north(POINTS.inside_centre, m)

  const fiveDaysAgo = days(5)
  const main = await makeRequest(request, {
    has_photo: true, at: fiveDaysAgo, description: 'Deep pothole by the fire hydrant, a car lost a hubcap (SAMPLE)', name: 'Pat Sample (SAMPLE)', phone: '709-555-0187',
  })
  await putPhoto(request, main, { at: fiveDaysAgo })
  await meToo(request, main.id)
  await meToo(request, main.id)
  await staffPut(request, token, main.id, { crew_id: 1, public_message: 'The roads crew is booked for Thursday.' })
  await api(request, 'POST', `/api/staff/requests/${main.id}/notes`, { token, data: { text: 'Resident says it fills with water when it rains. (SAMPLE)' } })
  const dup = await makeRequest(request, { point: at(35), at: days(1), description: 'Big hole near the hydrant (SAMPLE)' })
  await makeRequest(request, { category: 'streetlight', point: POINTS.on_street.point, at: days(12) })
  await makeRequest(request, { category: 'water', point: at(400), at: days(2), name: 'Lee Sample (SAMPLE)', phone: '709-555-0144' })
  const snow = await makeRequest(request, { category: 'snow', point: at(-600), at: days(4) })
  await staffPut(request, token, snow.id, { crew_id: 1, status: 'in_progress' })
  const bins = await makeRequest(request, { category: 'garbage', point: at(700), at: days(9) })
  await staffPut(request, token, bins.id, { status: 'done', public_message: 'Picked up this morning.' })
  const tree = await makeRequest(request, { category: 'tree', point: at(-300), at: days(6) })
  await staffPut(request, token, tree.id, { status: 'wont_fix', public_message: 'That tree is on private land. Please call the owner.' })
  const old = await makeRequest(request, { category: 'other', point: at(-800), at: days(3), description: 'Bench broken in the park (SAMPLE)' })
  const oldDup = await makeRequest(request, { category: 'other', point: at(-810), at: days(2), description: 'Park bench is broken (SAMPLE)' })
  await mergeInto(request, token, oldDup.id, old.id)

  await page.goto('/staff/')
  await expect(page.locator('#pin')).toBeVisible()
  await shot(page, testInfo, 'staff-signin')
  await signIn(page)
  await shot(page, testInfo, 'staff-board')

  await openCard(page, main.ref, 'assigned')
  await expect(page.locator('#detail-photo')).toBeVisible()
  await page.waitForFunction(() => document.getElementById('detail-photo')?.complete && document.getElementById('detail-photo').naturalWidth > 0)
  await mapReady(page, '#detail-map')
  await page.waitForTimeout(400)
  await shot(page, testInfo, 'staff-detail', { fullPage: false })
  await page.locator('#d-history').scrollIntoViewIfNeeded()
  await shot(page, testInfo, 'staff-detail-notes-history', { fullPage: false })

  await tap(page, page.locator('#detail-close'), 'Close')
  await openCard(page, dup.ref, 'new')
  await tap(page, page.locator('#join-open'), 'Join with another report')
  await tap(page, page.locator(`[data-cand="${main.id}"]`), `candidate ${main.ref}`)
  await expect(page.locator('#join-confirm')).toBeVisible()
  await page.locator('#join-confirm').scrollIntoViewIfNeeded()
  await shot(page, testInfo, 'staff-join-confirm', { fullPage: false })
  await tapAt(page, page.locator('#join-yes'), 0.5, 0.5, 'Join them')
  await expect(page.locator('#detail-ref')).toHaveText(main.ref)
  await shot(page, testInfo, 'staff-after-join', { fullPage: false })
})
