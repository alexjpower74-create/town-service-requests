// Join a duplicate into another report in the town office, by a likely candidate and by a typed reference. The kept report
// shows the +1 count the API holds, and the duplicate's status link says it was joined.
import { test, expect, tap, typeText, makeRequest, meToo, mergeInto, north, staffToken, staffGet, signIn, openCard, statusPath, POINTS } from './helpers.mjs'

test('join a duplicate with a likely candidate: the kept report shows the +1s the API counts', async ({ page, request }) => {
  const token = await staffToken(request)
  const kept = await makeRequest(request)
  await meToo(request, kept.id)
  await meToo(request, kept.id)
  const dup = await makeRequest(request, { point: north(POINTS.inside_centre, 30) })
  await meToo(request, dup.id)

  await signIn(page)
  await openCard(page, dup.ref, 'new')
  await tap(page, page.locator('#join-open'), 'Join with another report')
  await tap(page, page.locator(`[data-cand="${kept.id}"]`), `candidate ${kept.ref}`)
  await expect(page.locator('#join-confirm')).toContainText(`Join ${dup.ref} into ${kept.ref}`)
  await tap(page, page.locator('#join-yes'), 'Join them')

  await expect(page.locator('#detail-ref')).toHaveText(kept.ref)
  const after = await staffGet(request, token, kept.id)
  expect(after.plus_ones, "2 of its own + the duplicate's 1 + its reporter").toBe(4)
  await expect(page.locator('#detail-plus')).toHaveText(`+${after.plus_ones} others reported this`)
  await expect(page.locator(`#d-merged [data-ref="${dup.ref}"]`)).toBeVisible()
  expect((await staffGet(request, token, dup.id)).status).toBe('merged')

  await page.goto(statusPath(dup.status_url))
  await expect(page.locator('[data-merged]')).toContainText(`joined with ${kept.ref}`)
})

test('a typed reference to a report that was itself joined says so, with no Join button', async ({ page, request }) => {
  const token = await staffToken(request)
  const kept = await makeRequest(request)
  const joined = await makeRequest(request, { point: north(POINTS.inside_centre, 20) })
  await mergeInto(request, token, joined.id, kept.id)
  const far = await makeRequest(request, { point: POINTS.on_street.point })

  await signIn(page)
  await openCard(page, far.ref, 'new')
  await tap(page, page.locator('#join-open'), 'Join with another report')
  await typeText(page, page.locator('#join-ref'), joined.ref, 'reference')
  await tap(page, page.locator('#join-find'), 'Find')
  await expect(page.locator('#join-error')).toHaveText(`${joined.ref} was itself joined with ${kept.ref}. Join with ${kept.ref} instead.`)
  await expect(page.locator('#join-confirm')).toHaveCount(0)
  await expect(page.locator('#join-yes')).toHaveCount(0)
  expect((await staffGet(request, token, far.id)).status).toBe('new')
})

test('join by typing a reference when the report is not a nearby candidate', async ({ page, request }) => {
  const token = await staffToken(request)
  const kept = await makeRequest(request)
  const far = await makeRequest(request, { point: POINTS.on_street.point })

  await signIn(page)
  await openCard(page, far.ref, 'new')
  await tap(page, page.locator('#join-open'), 'Join with another report')
  await expect(page.locator('#join-none')).toBeVisible()
  await typeText(page, page.locator('#join-ref'), far.ref.toLowerCase(), 'reference')
  await tap(page, page.locator('#join-find'), 'Find')
  await expect(page.locator('#join-error')).toHaveText('Pick a different report to join it with.')
  await typeText(page, page.locator('#join-ref'), `${far.ref.toLowerCase()}`.replace(String(far.id), String(kept.id)), 'reference')
  await tap(page, page.locator('#join-find'), 'Find')
  await expect(page.locator('#join-confirm')).toContainText(`Join ${far.ref} into ${kept.ref}`)
  await tap(page, page.locator('#join-yes'), 'Join them')

  await expect(page.locator('#detail-ref')).toHaveText(kept.ref)
  const after = await staffGet(request, token, kept.id)
  expect(after.plus_ones).toBe(1)
  await expect(page.locator('#detail-plus')).toHaveText('+1 other reported this')
  expect((await staffGet(request, token, far.id)).merged_into).toEqual({ id: kept.id, ref: kept.ref })
})
