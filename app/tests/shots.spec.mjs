// Screenshots of every screen on the real Worker, in all four projects (tag @shots): the resident steps and status pages, and the
// town office (sign-in, board, detail, join confirm, map, weekly report, settings). The base map is a stand-in drawn from the town's
// street lines (nothing leaves 127.0.0.1). Pictures go to tests/shots/<project>-<name>.png. Map screens and the fixed detail panel
// are viewport captures (a full-page capture resizes the viewport faster than a map canvas follows).
import {
  test, expect, tap, tapAt, typeText, choosePhoto, api, makeRequest, meToo, north, staffToken, staffPut, mergeInto, putPhoto,
  signIn, openCard, goView, shot, statusPath, useStreetStyle, mapReady, shiftDate, POINTS,
} from './helpers.mjs'

const settle = (page) => page.waitForTimeout(400)

test('screenshots: the resident steps and the status page @shots', async ({ page, context, request }, testInfo) => {
  await useStreetStyle(context)
  const town = (await api(request, 'GET', '/api/town')).body
  const main = town.streets.find((s) => s.name === 'Main Street')
  const near = await makeRequest(request, { point: north(main.point, 25), description: 'Deep one by the hydrant (SAMPLE)' })
  await meToo(request, near.id)
  await meToo(request, near.id)
  const token = await staffToken(request)
  await staffPut(request, token, near.id, { crew_id: 1, public_message: 'The roads crew is booked for Thursday.' })
  const dup = await makeRequest(request, { point: north(main.point, 200) })
  await mergeInto(request, token, dup.id, near.id)

  await page.goto('/')
  await expect(page.locator('.cat-btn')).toHaveCount(7)
  await shot(page, testInfo, 'resident-1-home')
  await tap(page, page.locator('[data-category="pothole"]'), 'Pothole')
  await mapReady(page)
  await tap(page, page.locator('#search-open'), 'Search a street')
  await typeText(page, page.locator('#street-q'), 'Main', 'street search')
  await expect(page.locator('.street-opt[data-street="Main Street"]')).toBeVisible()
  await shot(page, testInfo, 'resident-2-where-search', { fullPage: false })
  await tap(page, page.locator('.street-opt[data-street="Main Street"]'), 'Main Street')
  await expect(page.locator('#where-label')).toHaveText('Near Main Street')
  await page.locator('#where-next').scrollIntoViewIfNeeded()
  await settle(page)
  await shot(page, testInfo, 'resident-3-where', { fullPage: false })
  await tap(page, page.locator('#where-next'), 'Next')
  await expect(page.locator('.near-card')).toHaveCount(1)
  await shot(page, testInfo, 'resident-4-nearby')
  await tap(page, page.locator('#nearby-different'), 'No, mine is different')
  await expect(page.locator('#photo-empty')).toBeVisible()
  await shot(page, testInfo, 'resident-5-photo-empty')
  await choosePhoto(page, page.locator('#photo-add'))
  await expect(page.locator('#photo-chosen')).toBeVisible()
  await shot(page, testInfo, 'resident-6-photo-chosen')
  await tap(page, page.locator('#photo-next'), 'Next (photo)')
  await typeText(page, page.locator('#description'), 'Another hole a bit further up (SAMPLE)', 'description')
  await typeText(page, page.locator('#name'), 'Sam Sample (SAMPLE)', 'name')
  await typeText(page, page.locator('#phone'), '709-555-0123', 'phone')
  await shot(page, testInfo, 'resident-7-details')
  await tap(page, page.locator('#send'), 'Send report')
  await expect(page.locator('[data-photo-ok]')).toBeVisible()
  await shot(page, testInfo, 'resident-8-sent')
  await tap(page, page.locator('#open-status'), 'Open the status page')
  await expect(page.locator('#status-ref')).toBeVisible()
  await shot(page, testInfo, 'status-1-new')
  await page.goto(statusPath(near.status_url))
  await expect(page.locator('#public-message')).toBeVisible()
  await shot(page, testInfo, 'status-2-assigned-message')
  await page.goto(statusPath(dup.status_url))
  await expect(page.locator('[data-merged]')).toBeVisible()
  await shot(page, testInfo, 'status-3-joined')
  await page.goto('/s/?k=not-a-real-status-key-0000')
  await expect(page.locator('#not-found')).toBeVisible()
  await shot(page, testInfo, 'status-4-not-found')
  // Me too, from a second report of the same pothole.
  await page.goto('/')
  await tap(page, page.locator('[data-category="pothole"]'), 'Pothole')
  await tap(page, page.locator('#search-open'), 'Search a street')
  await typeText(page, page.locator('#street-q'), 'Main', 'street search')
  await tap(page, page.locator('.street-opt[data-street="Main Street"]'), 'Main Street')
  await tap(page, page.locator('#where-next'), 'Next')
  await tap(page, page.locator(`.near-card[data-ref="${near.ref}"] [data-metoo]`), 'Me too')
  await expect(page.locator('#metoo-text')).toBeVisible()
  await shot(page, testInfo, 'resident-9-metoo')
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
  await makeRequest(request, { category: 'streetlight', point: at(250), at: days(12) })
  await makeRequest(request, { category: 'water', point: at(400), at: days(2), name: 'Lee Sample (SAMPLE)', phone: '709-555-0144' })
  const snow = await makeRequest(request, { category: 'snow', point: at(-600), at: days(4) })
  await staffPut(request, token, snow.id, { crew_id: 1, status: 'in_progress' }, days(4))
  const bins = await makeRequest(request, { category: 'garbage', point: at(700), at: days(9) })
  await staffPut(request, token, bins.id, { status: 'done', public_message: 'Picked up this morning.' }, days(8))
  const tree = await makeRequest(request, { category: 'tree', point: at(-300), at: days(6) })
  await staffPut(request, token, tree.id, { status: 'wont_fix', public_message: 'That tree is on private land. Please call the owner.' }, days(5))
  const bench = await makeRequest(request, { category: 'other', point: at(-800), at: days(3), description: 'Bench broken in the park (SAMPLE)' })
  const benchDup = await makeRequest(request, { category: 'other', point: at(-810), at: days(2), description: 'Park bench is broken (SAMPLE)' })
  await mergeInto(request, token, benchDup.id, bench.id)
  // A few more reports last week, so the weekly report has numbers.
  // "Last week" is the API's own current NL week minus 7 days, never a UTC date (DECISIONS 21).
  const thisWeek = (await api(request, 'GET', '/api/staff/report/weekly', { token })).body
  const lastWeek = (await api(request, 'GET', `/api/staff/report/weekly?week=${shiftDate(thisWeek.week_start, -7)}`, { token })).body
  const lw = (h) => new Date(Date.parse(lastWeek.start_at) + h * 3_600_000).toISOString()
  for (const [category, m, open, close] of [['pothole', 900, 10, 60], ['streetlight', -900, 30, 90], ['water', 1100, 50, null], ['tree', -1100, 70, 140]]) {
    const r = await makeRequest(request, { category, point: at(m), at: lw(open) })
    if (close) await staffPut(request, token, r.id, { status: 'done' }, lw(close))
  }

  await page.goto('/staff/')
  await expect(page.locator('#pin')).toBeVisible()
  await shot(page, testInfo, 'staff-1-signin')
  await signIn(page)
  await shot(page, testInfo, 'staff-2-board')

  await openCard(page, main.ref, 'assigned')
  await expect(page.locator('#detail-photo')).toBeVisible()
  await page.waitForFunction(() => document.getElementById('detail-photo')?.complete && document.getElementById('detail-photo').naturalWidth > 0)
  await mapReady(page, '#detail-map')
  await settle(page)
  await shot(page, testInfo, 'staff-3-detail', { fullPage: false })
  await page.locator('#d-history').scrollIntoViewIfNeeded()
  await shot(page, testInfo, 'staff-4-detail-notes-history', { fullPage: false })

  await tap(page, page.locator('#detail-close'), 'Close')
  await openCard(page, dup.ref, 'new')
  await tap(page, page.locator('#join-open'), 'Join with another report')
  await tap(page, page.locator(`[data-cand="${main.id}"]`), `candidate ${main.ref}`)
  await expect(page.locator('#join-confirm')).toBeVisible()
  await page.locator('#join-confirm').scrollIntoViewIfNeeded()
  await shot(page, testInfo, 'staff-5-join-confirm', { fullPage: false })
  await tapAt(page, page.locator('#join-yes'), 0.5, 0.5, 'Join them')
  await expect(page.locator('#detail-ref')).toHaveText(main.ref)
  await tap(page, page.locator('#detail-close'), 'Close')

  await goView(page, 'map')
  await mapReady(page, '#staff-map')
  await page.locator('#staff-map').scrollIntoViewIfNeeded()
  await settle(page)
  await shot(page, testInfo, 'staff-6-map', { fullPage: false })

  await goView(page, 'report')
  await tap(page, page.locator('#week-prev'), 'Previous week')
  await expect(page.locator('#report-table')).toHaveAttribute('data-week', lastWeek.week_start)
  await shot(page, testInfo, 'staff-7-weekly-report')

  await goView(page, 'settings')
  await shot(page, testInfo, 'staff-8-settings')
})
