// Overdue on the board follows the SLA the API reads: a streetlight past its 10-day target shows the red edge and "Overdue by N
// days", "Overdue only" shows just that one, and a 12-day target set in Settings clears it.
// Arranged 11 days and 1 hour ago: that is past 11 days, so the API's overdue_days is ceil(1 day + 1 hour) = 2, and the card must show
// what the API says. (Exactly "1 day" would need the report to be at most 11 days old, and then age_days is 10.)
import { test, expect, tap, makeRequest, north, staffToken, staffGet, api, signIn, showColumn, goView, replaceText, POINTS } from './helpers.mjs'

const DAY = 86_400_000
const RED = 'rgb(185, 28, 28)'

test('a streetlight past its SLA is overdue on the board, Overdue only shows just it, and a 12-day SLA clears it', async ({ page, request }) => {
  const token = await staffToken(request)
  const now = Date.now()
  const light = await makeRequest(request, { category: 'streetlight', point: north(POINTS.inside_centre, 300), at: new Date(now - 11 * DAY - 3_600_000).toISOString() })
  const hole = await makeRequest(request, { at: new Date(now - 3 * DAY).toISOString() })
  const light0 = await staffGet(request, token, light.id)
  expect(light0.overdue).toBe(true)
  expect(light0.overdue_days).toBe(2)
  expect(light0.age_days).toBe(11)
  expect((await staffGet(request, token, hole.id)).overdue).toBe(false)

  await signIn(page)
  await showColumn(page, 'new')
  const lightCard = page.locator(`.col[data-col="new"] [data-ref="${light.ref}"]`)
  const holeCard = page.locator(`.col[data-col="new"] [data-ref="${hole.ref}"]`)
  await expect(lightCard).toHaveAttribute('data-overdue', 'true')
  await expect(lightCard.locator('.card-overdue')).toHaveText(`Overdue by ${light0.overdue_days} days`)
  expect(await lightCard.evaluate((el) => getComputedStyle(el).borderLeftColor), 'red left edge').toBe(RED)
  expect(await lightCard.evaluate((el) => getComputedStyle(el).borderLeftWidth)).toBe('4px')
  await expect(holeCard).toHaveAttribute('data-overdue', 'false')
  await expect(holeCard.locator('.card-overdue')).toHaveCount(0)
  expect(await holeCard.evaluate((el) => getComputedStyle(el).borderLeftColor)).not.toBe(RED)

  // "Overdue only" shows just the overdue one.
  await tap(page, page.locator('#f-overdue'), 'Overdue only')
  await expect(page.locator('#f-overdue')).toBeChecked()
  await expect(page.locator('.col[data-col="new"] .card-req')).toHaveCount(1)
  await expect(lightCard).toBeVisible()
  await tap(page, page.locator('#f-overdue'), 'Overdue only (off)')
  await expect(page.locator('.col[data-col="new"] .card-req')).toHaveCount(2)

  // Settings: streetlight 12 days.
  await goView(page, 'settings')
  await replaceText(page, page.locator('#sla-streetlight'), '12', 'streetlight SLA')
  await tap(page, page.locator('#settings-save'), 'Save settings')
  await expect(page.locator('#settings-ok')).toHaveText('Saved.')
  expect((await api(request, 'GET', '/api/staff/settings', { token })).body.sla_days.streetlight).toBe(12)

  await goView(page, 'board')
  await showColumn(page, 'new')
  await expect(lightCard).toBeVisible()
  await expect(lightCard, 'no longer overdue after the SLA change').toHaveAttribute('data-overdue', 'false')
  await expect(lightCard.locator('.card-overdue')).toHaveCount(0)
  expect(await lightCard.evaluate((el) => getComputedStyle(el).borderLeftColor)).not.toBe(RED)
  expect((await staffGet(request, token, light.id)).overdue).toBe(false)
})
