// The town office on the real Worker: sign-in, board counts, assigning a crew with a public message, internal notes, the
// API's inline errors, and the stale path when someone else changed the report.
import {
  test, expect, tap, typeText, api, staffToken, staffGet, staffList, staffPut, makeRequest, north, signIn, openCard, showColumn,
  statusPath, recordBodies, goView, POINTS,
} from './helpers.mjs'

const COLUMNS = ['new', 'assigned', 'in_progress', 'done', 'wont_fix']
const MESSAGE = 'The roads crew is booked for Thursday. (SAMPLE)'

test('a wrong PIN is refused with the API message and a 401', async ({ page }) => {
  await page.goto('/staff/')
  await expect(page.locator('[data-sample]')).toHaveText('SAMPLE')
  await typeText(page, page.locator('#pin'), '1111', 'PIN')
  const answer = page.waitForResponse((r) => r.url().endsWith('/api/staff/signin'))
  await tap(page, page.locator('#signin-btn'), 'Sign in')
  expect((await answer).status()).toBe(401)
  await expect(page.locator('#pin-error')).toHaveText('That PIN is not right.')
  await expect(page.locator('#board')).toHaveCount(0)
})

test('five wrong PINs trip the sign-in guard: the 429 text shows as is, and even the right PIN is refused', async ({ page }) => {
  await page.goto('/staff/')
  for (let i = 1; i <= 5; i++) {
    await typeText(page, page.locator('#pin'), '1111', `wrong PIN ${i}`)
    const answer = page.waitForResponse((r) => r.url().endsWith('/api/staff/signin'))
    await tap(page, page.locator('#signin-btn'), `Sign in (wrong PIN ${i})`)
    expect((await answer).status(), `wrong PIN ${i}`).toBe(401)
    await expect(page.locator('#pin-error')).toHaveText('That PIN is not right.')
    await expect(page.locator('#pin'), 'the box is emptied for the next try').toHaveValue('')
  }
  await typeText(page, page.locator('#pin'), '3690', 'the right PIN')
  const answer = page.waitForResponse((r) => r.url().endsWith('/api/staff/signin'))
  await tap(page, page.locator('#signin-btn'), 'Sign in (right PIN, after 5 wrong)')
  const res = await answer
  expect(res.status()).toBe(429)
  const body = await res.json()
  expect(body.code).toBe('rate_limited')
  await expect(page.locator('#pin-error')).toHaveText(body.error)
  await expect(page.locator('#pin-error')).toHaveText('Too many tries. Wait 15 minutes and try again.')
  await expect(page.locator('#board')).toHaveCount(0)
  await expect(page.locator('#nav')).toBeHidden()
})

test('the board counts and cards match the API, with and without a filter', async ({ page, request }) => {
  const token = await staffToken(request)
  await makeRequest(request)
  await makeRequest(request, { category: 'streetlight', point: POINTS.on_street.point })
  const water = await makeRequest(request, { category: 'water', point: north(POINTS.inside_centre, 300) })
  const done = await makeRequest(request, { point: north(POINTS.inside_centre, 500) })
  const tree = await makeRequest(request, { category: 'tree', point: north(POINTS.inside_centre, 700) })
  await staffPut(request, token, water.id, { crew_id: 2 })
  await staffPut(request, token, done.id, { status: 'done' })
  await staffPut(request, token, tree.id, { status: 'wont_fix', public_message: 'That tree is on private land. (SAMPLE)' })

  await signIn(page)
  const matches = async (query) => {
    const list = await staffList(request, token, query)
    for (const k of COLUMNS) {
      await expect(page.locator(`[data-count="${k}"]`), `${query || 'no filter'}: ${k} count`).toHaveText(String(list.counts[k]))
      await expect(page.locator(`.col[data-col="${k}"] .card-req`), `${query || 'no filter'}: ${k} cards`).toHaveCount(list.requests.filter((r) => r.status === k).length)
    }
    return list
  }
  const all = await matches('')
  expect(all.counts).toEqual({ new: 2, assigned: 1, in_progress: 0, done: 1, wont_fix: 1 })

  const before = await page.locator('#board').getAttribute('data-loaded')
  await page.locator('#f-category').selectOption('pothole')
  await expect(page.locator('#board')).not.toHaveAttribute('data-loaded', before)
  const potholes = await matches('?category=pothole')
  expect(potholes.counts).toEqual({ new: 1, assigned: 0, in_progress: 0, done: 1, wont_fix: 0 })
})

test('assign a crew and a public message: the card moves to Assigned and the status page shows the message', async ({ page, request }) => {
  const created = await makeRequest(request)
  await signIn(page)
  await openCard(page, created.ref, 'new')
  await page.locator('#d-crew').selectOption('1')
  await typeText(page, page.locator('#d-message'), MESSAGE, 'public message')
  await tap(page, page.locator('#save'), 'Save')
  await expect(page.locator('#save-ok')).toHaveText('Saved.')
  await expect(page.locator('.detail-head .chip')).toHaveText('Assigned')

  const token = await staffToken(request)
  const saved = await staffGet(request, token, created.id)
  expect(saved.status).toBe('assigned')
  expect(saved.crew_id).toBe(1)
  expect(saved.public_message).toBe(MESSAGE)

  await tap(page, page.locator('#detail-close'), 'Close')
  const assigned = await showColumn(page, 'assigned')
  await expect(assigned.locator(`[data-ref="${created.ref}"]`)).toBeVisible()
  await expect(page.locator(`.col[data-col="new"] [data-ref="${created.ref}"]`)).toHaveCount(0)

  await page.goto(statusPath(created.status_url))
  await expect(page.locator('.chip-big')).toHaveText('Assigned')
  await expect(page.locator('#public-message')).toContainText(MESSAGE)
})

test('an internal note shows in the staff history and never on the status page', async ({ page, request }) => {
  const NOTE = 'Gate code for the lane is 4471 (SAMPLE)'
  const created = await makeRequest(request)
  await signIn(page)
  await openCard(page, created.ref, 'new')
  await typeText(page, page.locator('#note-text'), NOTE, 'note')
  await tap(page, page.locator('#add-note'), 'Add note')
  const entry = page.locator('#d-history li.internal', { hasText: NOTE })
  await expect(entry).toBeVisible()
  await expect(entry.locator('.staff-only')).toHaveText('Staff only')
  const token = await staffToken(request)
  expect((await staffGet(request, token, created.id)).history.some((h) => h.text === NOTE && h.internal)).toBe(true)

  const bodies = recordBodies(page)
  await page.goto(statusPath(created.status_url))
  await expect(page.locator('#status-ref')).toHaveText(`Report ${created.ref}`)
  await page.waitForLoadState('networkidle')
  await expect.poll(() => bodies.some((b) => b.url.includes('/api/status/'))).toBe(true)
  await expect(page.locator('body')).not.toContainText('4471')
  for (const b of bodies) expect(b.text, `${b.url} never contains the note`).not.toContain('4471')
})

test("won't fix without a message shows the API's message next to the message box", async ({ page, request }) => {
  const created = await makeRequest(request)
  await signIn(page)
  await openCard(page, created.ref, 'new')
  await page.locator('#d-status').selectOption('wont_fix')
  const answer = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes(`/api/staff/requests/${created.id}`))
  await tap(page, page.locator('#save'), 'Save')
  expect((await answer).status()).toBe(400)
  await expect(page.locator('#err-public_message')).toHaveText('Say why in the message to the public.')
  const token = await staffToken(request)
  expect((await staffGet(request, token, created.id)).status).toBe('new')
})

test('a report someone else changed shows the stale message, and Reload shows their change', async ({ page, request }) => {
  const OTHER = 'Booked for Monday by the other counter. (SAMPLE)'
  const created = await makeRequest(request)
  await signIn(page)
  await openCard(page, created.ref, 'new')
  const token = await staffToken(request)
  await staffPut(request, token, created.id, { crew_id: 1, public_message: OTHER })

  await typeText(page, page.locator('#d-message'), 'My own message (SAMPLE)', 'public message')
  const answer = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes(`/api/staff/requests/${created.id}`))
  await tap(page, page.locator('#save'), 'Save')
  expect((await answer).status()).toBe(409)
  await expect(page.locator('#stale')).toContainText('Someone else changed this report.')
  await tap(page, page.locator('#stale-reload'), 'Reload')
  await expect(page.locator('#d-message')).toHaveValue(OTHER)
  await expect(page.locator('.detail-in')).toHaveAttribute('data-version', '2')
  expect((await staffGet(request, token, created.id)).public_message).toBe(OTHER)
  // Reload also reloads the board: the card is in Assigned, where the other change put it.
  await tap(page, page.locator('#detail-close'), 'Close')
  const assigned = await showColumn(page, 'assigned')
  await expect(assigned.locator(`[data-ref="${created.ref}"]`)).toBeVisible()
  await expect(page.locator(`.col[data-col="new"] [data-ref="${created.ref}"]`)).toHaveCount(0)
  // Sanity: the token the test used is a real staff session.
  expect((await api(request, 'GET', '/api/staff/crews', { token })).status).toBe(200)
})

const isPut = (id) => (r) => r.request().method() === 'PUT' && r.url().includes(`/api/staff/requests/${id}`)

test('a Save after adding a note never undoes a change made meanwhile: it answers 409 and shows the stale box', async ({ page, request }) => {
  const created = await makeRequest(request)
  await signIn(page)
  await openCard(page, created.ref, 'new')
  const token = await staffToken(request)
  // Someone else assigns a crew while the form still shows New and No crew.
  await staffPut(request, token, created.id, { crew_id: 1 })

  await typeText(page, page.locator('#note-text'), 'Called the resident back. (SAMPLE)', 'note')
  await tap(page, page.locator('#add-note'), 'Add note')
  await expect(page.locator('#d-history li.internal', { hasText: 'Called the resident back.' })).toBeVisible()
  await typeText(page, page.locator('#d-message'), 'Looking at it this week. (SAMPLE)', 'public message')
  const answer = page.waitForResponse(isPut(created.id))
  await tap(page, page.locator('#save'), 'Save')
  expect((await answer).status(), 'the Save meets the stale check').toBe(409)
  await expect(page.locator('#stale')).toContainText('Someone else changed this report.')
  const after = await staffGet(request, token, created.id)
  expect(after.status, 'the other change is not undone').toBe('assigned')
  expect(after.crew_id).toBe(1)
  expect(after.public_message).toBeNull()
})

test('a Save after the session ended goes to the sign-in screen without a page error', async ({ page, request }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`) })
  const created = await makeRequest(request)
  await signIn(page)
  await openCard(page, created.ref, 'new')
  // End this page's own session through the API (reading the token, never setting app state).
  const token = await page.evaluate(() => localStorage.getItem('tsr:staff-token'))
  expect((await api(request, 'POST', '/api/staff/signout', { token })).status).toBe(200)

  await typeText(page, page.locator('#d-message'), 'Too late (SAMPLE)', 'public message')
  const answer = page.waitForResponse(isPut(created.id))
  await tap(page, page.locator('#save'), 'Save')
  expect((await answer).status()).toBe(401)
  await expect(page.locator('#pin')).toBeVisible()
  await expect(page.locator('#pin-error')).toHaveText('Sign in again.')
  await expect(page.locator('#detail')).toBeHidden()
  await page.waitForTimeout(500)
  expect(errors, 'no page error after the sign-in screen shows').toEqual([])
})

test('the detail shows the due date for an open report with an SLA, and not once it is done', async ({ page, request }) => {
  const created = await makeRequest(request)
  const token = await staffToken(request)
  const staff = await staffGet(request, token, created.id)
  expect(staff.due_label).toBeTruthy()
  await signIn(page)
  await openCard(page, created.ref, 'new')
  await expect(page.locator('#d-due')).toHaveText(`Due ${staff.due_label}`)
  await page.locator('#d-status').selectOption('done')
  await tap(page, page.locator('#save'), 'Save')
  await expect(page.locator('#save-ok')).toHaveText('Saved.')
  await expect(page.locator('#d-due')).toHaveCount(0)
})

test('a crew deactivated from another session is gone from the crew list when a report opens', async ({ page, request }) => {
  const created = await makeRequest(request)
  await signIn(page)
  const token = await staffToken(request)
  const r = await api(request, 'PUT', '/api/staff/crews/3', { token, data: { name: 'Parks and trees crew (SAMPLE)', active: false } })
  expect(r.status).toBe(200)
  await openCard(page, created.ref, 'new')
  await expect(page.locator('#d-crew option[value="3"]')).toHaveCount(0)
  await expect(page.locator('#d-crew option')).toHaveCount(3)
})

// Page errors, leaving out the browser's own "Failed to load resource" line for a 401.
function pageErrors(page) {
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`) })
  return errors
}
// End this page's own session through the API (the token is read, never set).
async function endThisSession(page, request) {
  const token = await page.evaluate(() => localStorage.getItem('tsr:staff-token'))
  expect((await api(request, 'POST', '/api/staff/signout', { token })).status).toBe(200)
}
async function signedOutBy(page, action, urlPart, label) {
  const answer = page.waitForResponse((r) => r.url().includes(urlPart) && r.status() === 401)
  await action()
  await answer
  await expect(page.locator('#pin'), `${label}: the sign-in screen`).toBeVisible()
  await expect(page.locator('#pin-error')).toHaveText('Sign in again.')
}
async function signInHere(page, view) {
  await typeText(page, page.locator('#pin'), '3690', 'PIN')
  await tap(page, page.locator('#signin-btn'), 'Sign in')
  await expect(page.locator('#app')).toHaveAttribute('data-view', view)
}

test('Save settings, Add crew, Change PIN and Download CSV after the session ended go to sign-in without a page error', async ({ page, request }) => {
  const errors = pageErrors(page)
  await signIn(page)
  await goView(page, 'settings')

  await endThisSession(page, request)
  await signedOutBy(page, () => tap(page, page.locator('#settings-save'), 'Save settings'), '/api/staff/settings', 'Save settings')
  await signInHere(page, 'settings')

  await endThisSession(page, request)
  await typeText(page, page.locator('#crew-new'), 'Late crew (SAMPLE)', 'new crew')
  await signedOutBy(page, () => tap(page, page.locator('#crew-add'), 'Add crew'), '/api/staff/crews', 'Add crew')
  await signInHere(page, 'settings')

  await endThisSession(page, request)
  await typeText(page, page.locator('#pin-current'), '3690', 'current PIN')
  await typeText(page, page.locator('#pin-new'), '2468', 'new PIN')
  await signedOutBy(page, () => tap(page, page.locator('#pin-save'), 'Change PIN'), '/api/staff/pin', 'Change PIN')
  await signInHere(page, 'settings')

  await goView(page, 'report')
  await endThisSession(page, request)
  await signedOutBy(page, () => tap(page, page.locator('#download-csv'), 'Download CSV'), '/api/staff/export.csv', 'Download CSV')

  await page.waitForTimeout(500)
  expect(errors, 'no page error once the sign-in screen shows').toEqual([])
})

test('with the detail open at 1280 the board says it scrolls sideways and fades its right edge, until the last column is in view @desktop', async ({ page, request }) => {
  const created = await makeRequest(request)
  await signIn(page)
  const hint = page.locator('#board-hint')
  const scroller = page.locator('#board-scroll')
  const fade = () => scroller.evaluate((el) => getComputedStyle(el, '::after').backgroundImage)
  await expect(hint, 'no hint while all five columns fit').toBeHidden()

  await openCard(page, created.ref, 'new')
  await expect(hint).toBeVisible()
  await expect(hint).toHaveText('Scroll the board sideways for more columns.')
  await expect(scroller).toHaveAttribute('data-more', 'true')
  expect(await fade(), 'the right edge fades').toContain('gradient')
  await expect(page.locator('.col[data-col="wont_fix"] h2')).not.toBeInViewport({ ratio: 1 })

  // A real sideways wheel over the board brings the last column into view.
  const box = await page.locator('#board').boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + 80)
  await page.mouse.wheel(3000, 0)
  await expect(scroller).toHaveAttribute('data-more', 'false')
  await expect(hint).toBeHidden()
  expect(await fade()).toBe('none')
  await expect(page.locator('.col[data-col="wont_fix"] h2')).toBeInViewport({ ratio: 1 })

  await tap(page, page.locator('#detail-close'), 'Close')
  await expect(hint).toBeHidden()
})
