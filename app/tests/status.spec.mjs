// The public status page on the real Worker: public message and history, the "joined with" link, and a bad link.
import { test, expect, tap, makeRequest, north, staffToken, staffPut, mergeInto, statusPath, POINTS } from './helpers.mjs'

const MESSAGE = 'The roads crew is booked for Thursday. (SAMPLE)'

test('the status page shows the public message and the public history, and no crew name', async ({ page, request }) => {
  const created = await makeRequest(request)
  const token = await staffToken(request)
  await staffPut(request, token, created.id, { crew_id: 1, public_message: MESSAGE })
  await page.goto(statusPath(created.status_url))
  await expect(page.locator('#status-ref')).toHaveText(`Report ${created.ref}`)
  await expect(page.locator('.chip-big')).toHaveText('Assigned')
  await expect(page.locator('#status-sentence')).toHaveText('A crew has been assigned.')
  await expect(page.locator('#public-message')).toContainText(MESSAGE)
  const history = page.locator('#history li')
  await expect(history).toHaveCount(3)
  await expect(history.nth(0)).toContainText('Reported')
  await expect(history.nth(1)).toContainText('Assigned to a crew')
  await expect(history.nth(2)).toContainText(`Message from the town: ${MESSAGE}`)
  await expect(page.locator('body')).not.toContainText('Roads crew')
  await expect(page.locator('[data-sample]')).toHaveText('SAMPLE')
})

test('a report joined with another links to the one that was kept', async ({ page, request }) => {
  const kept = await makeRequest(request)
  const dup = await makeRequest(request, { point: north(POINTS.inside_centre, 20) })
  const token = await staffToken(request)
  await mergeInto(request, token, dup.id, kept.id)
  await page.goto(statusPath(dup.status_url))
  await expect(page.locator('[data-merged]')).toContainText(`This report was joined with ${kept.ref}.`)
  await tap(page, page.locator('[data-merged] a'), `${kept.ref} link`)
  await expect(page.locator('#status-ref')).toHaveText(`Report ${kept.ref}`)
  await expect(page.locator('#history')).toContainText('Another report of the same problem was joined to this one')
})

test('a bad status link shows the plain not-found message', async ({ page }) => {
  await page.goto('/s/?k=not-a-real-status-key-0000')
  await expect(page.locator('#not-found')).toHaveText("We can't find that report. Check the link, or call the town office.")
  await expect(page.locator('[data-sample]')).toHaveText('SAMPLE')
  await expect(page.locator('.office a')).toHaveAttribute('href', 'tel:7095550100')
})
