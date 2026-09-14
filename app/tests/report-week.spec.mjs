// The weekly report on the real Worker: requests created and closed at chosen instants in the previous NL week. The table, totals,
// "open now" and oldest open equal the API's answer for that week; Previous / Next week move and ask for "this week" again; Download
// CSV gives exactly the text GET /api/staff/export.csv gives, with no phone number or name in it; a save from Oldest open refreshes
// the report.
// The browser can't send X-Test-Now, so anything that depends on the real clock (which week "this week" is, open and overdue counts,
// the CSV's dated filename) is compared with API answers read around the UI and either side is accepted (DECISIONS 21).
import { readFileSync } from 'node:fs'
import { test, expect, tap, api, makeRequest, north, staffToken, staffPut, signIn, goView, shiftDate, POINTS } from './helpers.mjs'

const PHONE = '709-555-0166'
const NAME = 'Weekly Testperson (SAMPLE)'
const avgText = (v) => (v === null ? '–' : v.toFixed(1))
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const oneOf = (a, b) => (a === b ? a : new RegExp(`^(?:${reEscape(a)}|${reEscape(b)})$`))
const weekly = async (request, token, week = '') => (await api(request, 'GET', `/api/staff/report/weekly${week ? `?week=${week}` : ''}`, { token })).body

async function apiCsv(request, token) {
  const r = await request.fetch('/api/staff/export.csv', { headers: { Authorization: `Bearer ${token}` } })
  expect(r.status()).toBe(200)
  return { text: await r.text(), filename: /filename="([^"]+)"/.exec(r.headers()['content-disposition'])[1] }
}

test('the weekly report shows the API numbers for a past week, moves between weeks, and downloads the API CSV', async ({ page, request }) => {
  const token = await staffToken(request)
  const current = await weekly(request, token)
  const prevStart = shiftDate(current.week_start, -7)
  const prev0 = await weekly(request, token, prevStart)
  const t0 = Date.parse(prev0.start_at)
  const at = (hours) => new Date(t0 + hours * 3_600_000).toISOString()

  // Monday 10:00 pothole with a phone, done Wednesday 10:00 (2 days).
  const a = await makeRequest(request, { at: at(10), phone: PHONE, name: NAME, description: 'Week test (SAMPLE)' })
  await staffPut(request, token, a.id, { status: 'done' }, at(58))
  // Tuesday 06:00 streetlight, assigned, done Friday 04:00 (2.9 days).
  const b = await makeRequest(request, { category: 'streetlight', point: north(POINTS.inside_centre, 200), at: at(30) })
  await staffPut(request, token, b.id, { crew_id: 1 }, at(31))
  await staffPut(request, token, b.id, { status: 'done' }, at(100))
  // Tuesday 16:00 pothole, won't fix Saturday 10:00 (3.75 days).
  const c = await makeRequest(request, { point: north(POINTS.inside_centre, 400), at: at(40) })
  await staffPut(request, token, c.id, { status: 'wont_fix', public_message: 'Private lane. (SAMPLE)' }, at(130))
  // Still open: Wednesday 02:00 water and Sunday 06:00 garbage.
  await makeRequest(request, { category: 'water', point: north(POINTS.inside_centre, 600), at: at(50) })
  await makeRequest(request, { category: 'garbage', point: north(POINTS.inside_centre, -300), at: at(150) })

  const arranged = await weekly(request, token, prevStart)
  expect(arranged.totals.opened, 'five opened in the arranged week').toBe(5)
  expect(arranged.totals.closed, 'three closed in the arranged week').toBe(3)

  await signIn(page)
  await goView(page, 'report')
  const currentAfter = await weekly(request, token) // read after the UI loaded
  await expect(page.locator('#week-label')).toHaveText(oneOf(current.week_label, currentAfter.week_label))
  const uiWeek = await page.locator('#report-table').getAttribute('data-week')
  expect([current.week_start, currentAfter.week_start]).toContain(uiWeek)
  await expect(page.locator('#week-next')).toBeDisabled()

  const uiPrev = shiftDate(uiWeek, -7)
  const prevBefore = await weekly(request, token, uiPrev)
  await tap(page, page.locator('#week-prev'), 'Previous week')
  await expect(page.locator('#report-table')).toHaveAttribute('data-week', uiPrev)
  const prevAfter = await weekly(request, token, uiPrev) // read after the UI shows that week
  await expect(page.locator('#week-label')).toHaveText(prevAfter.week_label)
  // Opened, closed and averages of a past week can't change with the clock.
  for (const row of [...prevAfter.rows, { category: 'total', ...prevAfter.totals }]) {
    const tr = page.locator(`#report-table tr[data-category="${row.category}"]`)
    await expect(tr.locator('[data-col="opened"]'), `${row.category} opened`).toHaveText(String(row.opened))
    await expect(tr.locator('[data-col="closed"]'), `${row.category} closed`).toHaveText(String(row.closed))
    await expect(tr.locator('[data-col="avg"]'), `${row.category} average`).toHaveText(avgText(row.avg_days_to_close))
  }
  // "Now" numbers may change between reads: the UI equals the answer before or the answer after.
  await expect(page.locator('[data-now="open"]')).toHaveText(oneOf(String(prevBefore.open_now), String(prevAfter.open_now)))
  await expect(page.locator('[data-now="overdue"]')).toHaveText(oneOf(String(prevBefore.overdue_now), String(prevAfter.overdue_now)))
  const oldest = await page.locator('#oldest [data-ref]').evaluateAll((els) => els.map((e) => e.dataset.ref))
  expect([prevBefore.oldest_open.map((s) => s.ref), prevAfter.oldest_open.map((s) => s.ref)]).toContainEqual(oldest)
  if (uiPrev === prevStart) expect(prevAfter.totals).toMatchObject({ opened: 5, closed: 3 })

  await tap(page, page.locator('#week-next'), 'Next week')
  await expect(page.locator('#report-table')).toHaveAttribute('data-week', uiWeek)
  const nextAfter = await weekly(request, token)
  await expect(page.locator('#week-label')).toHaveText(oneOf(currentAfter.week_label, nextAfter.week_label))

  // The CSV: the API's text read just before and just after the download; the file equals one of them (an NL midnight between
  // them changes the dated filename).
  const csvBefore = await apiCsv(request, token)
  const downloading = page.waitForEvent('download')
  await tap(page, page.locator('#download-csv'), 'Download CSV')
  const download = await downloading
  const text = readFileSync(await download.path(), 'utf8')
  const csvAfter = await apiCsv(request, token)
  expect([csvBefore.filename, csvAfter.filename]).toContain(download.suggestedFilename())
  expect([csvBefore.text, csvAfter.text], 'the downloaded CSV is exactly the API CSV').toContain(text)
  expect(text.split('\r\n')[0]).toBe('Reference,Category,Location,Ward,Status,Crew,Plus ones,Reported,Due,Overdue,Closed,Days to close,Public message')
  expect(text.split('\r\n').filter(Boolean)).toHaveLength(6)
  for (const secret of [PHONE, PHONE.replace(/\D/g, ''), NAME, 'Testperson', 'Week test']) expect(text, `the CSV has no "${secret}"`).not.toContain(secret)
})

test('Previous and Next week ask for "this week" again, so Next is never stuck on an old week', async ({ page }) => {
  await signIn(page)
  const asked = []
  page.on('request', (r) => { if (r.url().includes('/api/staff/report/weekly')) asked.push(new URL(r.url()).searchParams.get('week')) })
  await goView(page, 'report')
  const week = await page.locator('#report-table').getAttribute('data-week')
  await expect(page.locator('#week-next')).toBeDisabled()

  const opened = asked.length
  await tap(page, page.locator('#week-prev'), 'Previous week')
  await expect(page.locator('#report-table')).toHaveAttribute('data-week', shiftDate(week, -7))
  const onPrevious = asked.slice(opened)
  expect(onPrevious, 'Previous asks for that week').toContain(shiftDate(week, -7))
  expect(onPrevious, 'Previous also asks for this week').toContain(null)
  await expect(page.locator('#week-next')).toBeEnabled()

  const beforeNext = asked.length
  await tap(page, page.locator('#week-next'), 'Next week')
  await expect(page.locator('#report-table')).toHaveAttribute('data-week', week)
  expect(asked.slice(beforeNext), 'Next also asks for this week').toContain(null)
  await expect(page.locator('#week-next')).toBeDisabled()
})

test('saving a report opened from Oldest open refreshes the weekly report', async ({ page, request }) => {
  const older = await makeRequest(request, { at: new Date(Date.now() - 4 * 86_400_000).toISOString() })
  await makeRequest(request, { point: north(POINTS.inside_centre, 300) })
  await signIn(page)
  await goView(page, 'report')
  await expect(page.locator('[data-now="open"]')).toHaveText('2')
  await tap(page, page.locator(`#oldest [data-ref="${older.ref}"]`), `oldest ${older.ref}`)
  await expect(page.locator('#detail-ref')).toHaveText(older.ref)
  await page.locator('#d-status').selectOption('done')
  await tap(page, page.locator('#save'), 'Save')
  await expect(page.locator('#save-ok')).toHaveText('Saved.')
  await expect(page.locator('[data-now="open"]'), 'the report behind the panel refreshed').toHaveText('1')
  await expect(page.locator(`#oldest [data-ref="${older.ref}"]`)).toHaveCount(0)
})
