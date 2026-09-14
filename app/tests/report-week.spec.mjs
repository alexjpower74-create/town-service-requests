// The weekly report on the real Worker: requests created and closed at chosen instants in the previous NL week. The table, totals,
// "open now" and oldest open equal the API's answer for that week; Previous / Next week move; Download CSV gives exactly the text
// GET /api/staff/export.csv gives, with no phone number or name in it.
import { readFileSync } from 'node:fs'
import { test, expect, tap, api, makeRequest, north, staffToken, staffPut, signIn, goView, shiftDate, POINTS } from './helpers.mjs'

const PHONE = '709-555-0166'
const NAME = 'Weekly Testperson (SAMPLE)'
const avgText = (v) => (v === null ? '–' : String(v))

test('the weekly report shows the API numbers for a past week, moves between weeks, and downloads the API CSV', async ({ page, request }) => {
  const token = await staffToken(request)
  const current = (await api(request, 'GET', '/api/staff/report/weekly', { token })).body
  const prevStart = shiftDate(current.week_start, -7)
  const weekOf = async (w) => (await api(request, 'GET', `/api/staff/report/weekly?week=${w}`, { token })).body
  const prev0 = await weekOf(prevStart)
  const t0 = Date.parse(prev0.start_at)
  const at = (hours) => new Date(t0 + hours * 3_600_000).toISOString()

  // Monday 10:00 pothole with a phone, done Wednesday 10:00 (2 days).
  const a = await makeRequest(request, { at: at(10), phone: PHONE, name: NAME, description: 'Week test (SAMPLE)' })
  await staffPut(request, token, a.id, { status: 'done' }, at(58))
  // Tuesday 06:00 streetlight, assigned, done Friday 04:00 (2.9 days).
  const b = await makeRequest(request, { category: 'streetlight', point: north(POINTS.inside_centre, 200), at: at(30) })
  await staffPut(request, token, b.id, { crew_id: 1 }, at(31))
  await staffPut(request, token, b.id, { status: 'done' }, at(100))
  // Tuesday 16:00 pothole, won't fix Saturday 10:00 (4.75 days).
  const c = await makeRequest(request, { point: north(POINTS.inside_centre, 400), at: at(40) })
  await staffPut(request, token, c.id, { status: 'wont_fix', public_message: 'Private lane. (SAMPLE)' }, at(130))
  // Still open: Wednesday 02:00 water and Sunday 06:00 garbage.
  await makeRequest(request, { category: 'water', point: north(POINTS.inside_centre, 600), at: at(50) })
  await makeRequest(request, { category: 'garbage', point: north(POINTS.inside_centre, -300), at: at(150) })

  const prev = await weekOf(prevStart)
  expect(prev.totals.opened, 'five opened in the arranged week').toBe(5)
  expect(prev.totals.closed, 'three closed in the arranged week').toBe(3)

  await signIn(page)
  await goView(page, 'report')
  await expect(page.locator('#week-label')).toHaveText(current.week_label)
  await expect(page.locator('#week-next')).toBeDisabled()

  await tap(page, page.locator('#week-prev'), 'Previous week')
  await expect(page.locator('#report-table')).toHaveAttribute('data-week', prev.week_start)
  await expect(page.locator('#week-label')).toHaveText(prev.week_label)
  for (const row of [...prev.rows, { category: 'total', ...prev.totals }]) {
    const tr = page.locator(`#report-table tr[data-category="${row.category}"]`)
    await expect(tr.locator('[data-col="opened"]'), `${row.category} opened`).toHaveText(String(row.opened))
    await expect(tr.locator('[data-col="closed"]'), `${row.category} closed`).toHaveText(String(row.closed))
    await expect(tr.locator('[data-col="avg"]'), `${row.category} average`).toHaveText(avgText(row.avg_days_to_close))
  }
  await expect(page.locator('[data-now="open"]')).toHaveText(String(prev.open_now))
  await expect(page.locator('[data-now="overdue"]')).toHaveText(String(prev.overdue_now))
  expect(await page.locator('#oldest [data-ref]').evaluateAll((els) => els.map((e) => e.dataset.ref))).toEqual(prev.oldest_open.map((s) => s.ref))

  await tap(page, page.locator('#week-next'), 'Next week')
  await expect(page.locator('#week-label')).toHaveText(current.week_label)
  await expect(page.locator('#report-table')).toHaveAttribute('data-week', current.week_start)

  const downloading = page.waitForEvent('download')
  await tap(page, page.locator('#download-csv'), 'Download CSV')
  const download = await downloading
  const text = readFileSync(await download.path(), 'utf8')
  const apiCsv = await request.fetch('/api/staff/export.csv', { headers: { Authorization: `Bearer ${token}` } })
  expect(apiCsv.status()).toBe(200)
  const expected = await apiCsv.text()
  expect(download.suggestedFilename()).toBe(/filename="([^"]+)"/.exec(apiCsv.headers()['content-disposition'])[1])
  expect(text, 'the downloaded CSV is exactly the API CSV').toBe(expected)
  expect(text.split('\r\n')[0]).toBe('Reference,Category,Location,Ward,Status,Crew,Plus ones,Reported,Due,Overdue,Closed,Days to close,Public message')
  expect(text.split('\r\n').filter(Boolean)).toHaveLength(6)
  for (const secret of [PHONE, PHONE.replace(/\D/g, ''), NAME, 'Testperson', 'Week test']) expect(text, `the CSV has no "${secret}"`).not.toContain(secret)
})
