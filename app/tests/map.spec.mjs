// The town office map on the real Worker: clustering, a cluster click that zooms in to pins, a pin that opens its report, status
// colours with the overdue ring, and filters shared with the board.
import { test, expect, tap, makeRequest, north, staffToken, staffList, staffPut, signIn, goView, POINTS } from './helpers.mjs'

const M_PER_DEG_LAT = 111195.0797

test('20 reports close together make one cluster; a click zooms in to pins, and a pin opens that report', async ({ page, request }) => {
  const [lat0, lng0] = POINTS.inside_centre
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180)
  const made = []
  for (let i = 0; i < 20; i++) {
    // A 5 x 4 grid, 30 m apart: about 10 px apart at zoom 15, about 80 px at zoom 18.
    made.push(await makeRequest(request, { point: [lat0 + (Math.floor(i / 5) * 30) / M_PER_DEG_LAT, lng0 + ((i % 5) * 30) / mPerDegLng] }))
  }
  const token = await staffToken(request)
  expect((await staffList(request, token)).requests).toHaveLength(20)

  await signIn(page)
  await goView(page, 'map')
  const map = page.locator('#staff-map')
  const clusters = map.locator('.marker-cluster')
  await expect(clusters).toHaveCount(1)
  await expect(clusters.first()).toHaveText('20')
  await expect(map.locator('.req-pin')).toHaveCount(0)
  const zoomBefore = Number(await map.getAttribute('data-zoom'))

  await tap(page, clusters.first(), 'the cluster of 20')
  await expect(map.locator('.marker-cluster')).toHaveCount(0)
  await expect(map.locator('.req-pin')).toHaveCount(20)
  expect(Number(await map.getAttribute('data-zoom')), 'the click zoomed in').toBeGreaterThan(zoomBefore)

  const target = made[7]
  const pin = map.locator(`.req-pin[data-ref="${target.ref}"]`)
  await expect(pin).toBeVisible()
  await tap(page, pin, `pin ${target.ref}`)
  await expect(page.locator('#detail-ref')).toHaveText(target.ref)
})

test("pins are coloured by status with a red ring when overdue, and the map uses the board's filters", async ({ page, request }) => {
  const token = await staffToken(request)
  const fresh = await makeRequest(request)
  const water = await makeRequest(request, { category: 'water', point: north(POINTS.inside_centre, 300) })
  await staffPut(request, token, water.id, { crew_id: 2 })
  const late = await makeRequest(request, { category: 'streetlight', point: north(POINTS.inside_centre, -300), at: new Date(Date.now() - 12 * 86_400_000).toISOString() })

  await signIn(page)
  await goView(page, 'map')
  const map = page.locator('#staff-map')
  await expect(map.locator('.req-pin')).toHaveCount(3)
  const colour = (ref) => map.locator(`.req-pin[data-ref="${ref}"]`).evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).boxShadow])
  const [freshBg, freshRing] = await colour(fresh.ref)
  expect(freshBg, 'New is harbour blue').toBe('rgb(10, 92, 138)')
  expect(freshRing).not.toContain('rgb(185, 28, 28)')
  expect((await colour(water.ref))[0], 'Assigned is purple').toBe('rgb(91, 33, 182)')
  const [lateBg, lateRing] = await colour(late.ref)
  expect(lateBg).toBe('rgb(10, 92, 138)')
  expect(lateRing, 'overdue has the red ring').toContain('rgb(185, 28, 28)')
  await expect(map.locator(`.req-pin[data-ref="${late.ref}"]`)).toHaveAttribute('data-overdue', 'true')

  // A filter set on the board is the map's filter too.
  await goView(page, 'board')
  const before = await page.locator('#board').getAttribute('data-loaded')
  await page.locator('#f-category').selectOption('water')
  await expect(page.locator('#board')).not.toHaveAttribute('data-loaded', before)
  await goView(page, 'map')
  await expect(page.locator('#f-category')).toHaveValue('water')
  await expect(map.locator('.req-pin')).toHaveCount(1)
  await expect(map.locator(`.req-pin[data-ref="${water.ref}"]`)).toBeVisible()
  await expect(page.locator('#map-count')).toHaveText('1 report on the map.')
})
