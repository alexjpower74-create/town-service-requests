// "Already reported nearby" on the real Worker: requests arranged 40 m and 60 m north of the pin the app placed (read from its
// data-lat / data-lng) and a streetlight 10 m away; only the 40 m pothole is offered, and Me too adds a +1 instead of a report.
import { test, expect, tap, tapAt, readPin, makeRequest, north, staffToken, staffGet, requestCount } from './helpers.mjs'

async function pinAtCentre(page) {
  await tap(page, page.locator('[data-category="pothole"]'), 'Pothole')
  await expect(page.locator('#step-where')).toBeVisible()
  await tapAt(page, page.locator('#map'), 0.5, 0.5, 'map centre')
  await expect(page.locator('#where-next')).toBeEnabled()
}

test('only the pothole 40 m away is offered, Me too adds a +1 and no request, and the same phone sees it as added', async ({ page, request }) => {
  await page.goto('/')
  await pinAtCentre(page)
  const pin = await readPin(page)
  const at40 = await makeRequest(request, { point: north(pin, 40) })
  await makeRequest(request, { point: north(pin, 60) })
  await makeRequest(request, { category: 'streetlight', point: north(pin, 10) })
  const token = await staffToken(request)
  expect(await requestCount(request, token)).toBe(3)

  await tap(page, page.locator('#where-next'), 'Next')
  await expect(page.locator('#step-nearby h1')).toHaveText('Already reported nearby')
  const cards = page.locator('.near-card')
  await expect(cards).toHaveCount(1)
  await expect(cards.first()).toHaveAttribute('data-ref', at40.ref)
  await expect(cards.first().locator('[data-distance]')).toHaveText('about 40 m from your pin')

  await tap(page, cards.first().locator('[data-metoo]'), 'Me too')
  await expect(page.locator('#metoo-text')).toHaveText(`Thanks. We added you to ${at40.ref}.`)
  expect((await staffGet(request, token, at40.id)).plus_ones, 'the API count is 1').toBe(1)
  expect(await requestCount(request, token), 'no new request').toBe(3)

  // A second run from the same phone.
  await tap(page, page.locator('#step-metoo [data-restart]'), 'Back to the start')
  await pinAtCentre(page)
  await tap(page, page.locator('#where-next'), 'Next')
  await expect(page.locator('.near-card')).toHaveCount(1)
  await expect(page.locator(`.near-card[data-ref="${at40.ref}"] [data-added]`)).toBeVisible()
  await expect(page.locator(`.near-card[data-ref="${at40.ref}"] [data-metoo]`)).toHaveCount(0)

  // "No, mine is different" carries on with the report.
  await tap(page, page.locator('#nearby-different'), 'No, mine is different')
  await expect(page.locator('#step-photo')).toBeVisible()
  expect((await staffGet(request, token, at40.id)).plus_ones).toBe(1)
  expect(await requestCount(request, token)).toBe(3)
})
