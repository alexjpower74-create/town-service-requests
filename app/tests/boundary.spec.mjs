// The town boundary on the phone: a tap outside stops at the pin step (message, Next disabled, no request); inside works;
// "Search a street" and "Use my location" move the pin, and the street hint is the Worker's own label.
import { test, expect, tap, tapLatLng, zoomOutTo, typeText, readPin, api, staffToken, requestCount, POINTS } from './helpers.mjs'

const OUTSIDE = 'That spot is outside the town. Move the pin inside the line on the map.'

async function startPothole(page) {
  await page.goto('/')
  await tap(page, page.locator('[data-category="pothole"]'), 'Pothole')
  await expect(page.locator('#step-where')).toBeVisible()
  await expect(page.locator('#map')).toHaveAttribute('data-zoom', '15')
}

test('a tap outside the boundary stops at the pin step and makes no request; a tap inside goes on', async ({ page, request }) => {
  await startPothole(page)
  const map = page.locator('#map')
  await zoomOutTo(page, 12)
  await tapLatLng(page, map, POINTS.outside_east_of_boundary, 'outside the boundary (east)')
  await expect(page.locator('#where-label')).toHaveAttribute('data-inside', 'false')
  await expect(page.locator('#where-error')).toHaveText(OUTSIDE)
  await expect(page.locator('#where-next')).toBeDisabled()
  const token = await staffToken(request)
  expect(await requestCount(request, token), 'no request exists').toBe(0)

  await tapLatLng(page, map, POINTS.inside_centre, 'inside the boundary')
  await expect(page.locator('#where-label')).toHaveAttribute('data-inside', 'true')
  await expect(page.locator('#where-error')).toBeHidden()
  await expect(page.locator('#where-next')).toBeEnabled()
  await tap(page, page.locator('#where-next'), 'Next')
  await expect(page.locator('#step-photo')).toBeVisible()
})

test('Search a street moves the pin to that street and shows the Worker\'s street name', async ({ page, request }) => {
  const town = (await api(request, 'GET', '/api/town')).body
  const street = town.streets.find((s) => s.name === 'Main Street')
  await startPothole(page)
  await tap(page, page.locator('#search-open'), 'Search a street')
  await typeText(page, page.locator('#street-q'), 'Main', 'street search')
  await tap(page, page.locator('.street-opt[data-street="Main Street"]'), 'Main Street')
  await expect(page.locator('#where-label')).toHaveAttribute('data-lat', String(street.point[0]))
  expect(await readPin(page)).toEqual(street.point)
  const located = (await api(request, 'GET', `/api/town/locate?lat=${street.point[0]}&lng=${street.point[1]}`)).body
  expect(located.location_label).toBe('Main Street')
  await expect(page.locator('#where-label')).toHaveText('Near Main Street')
  await expect(page.locator('#where-next')).toBeEnabled()
})

test('Use my location puts the pin where the phone is, and says so when that is outside the town', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: POINTS.on_street.point[0], longitude: POINTS.on_street.point[1] })
  await startPothole(page)
  await tap(page, page.locator('#locate'), 'Use my location')
  await expect(page.locator('#where-label')).toHaveAttribute('data-inside', 'true')
  const pin = await readPin(page)
  expect(pin[0]).toBeCloseTo(POINTS.on_street.point[0], 6)
  expect(pin[1]).toBeCloseTo(POINTS.on_street.point[1], 6)
  await expect(page.locator('#where-label')).toHaveText(`Near ${POINTS.on_street.street}`)
  await expect(page.locator('#where-next')).toBeEnabled()

  await context.setGeolocation({ latitude: POINTS.outside_south[0], longitude: POINTS.outside_south[1] })
  await tap(page, page.locator('#locate'), 'Use my location (outside)')
  await expect(page.locator('#where-label')).toHaveAttribute('data-inside', 'false')
  await expect(page.locator('#where-error')).toHaveText(OUTSIDE)
  await expect(page.locator('#where-next')).toBeDisabled()
  expect((await readPin(page))[0]).toBeCloseTo(POINTS.outside_south[0], 6)
})
