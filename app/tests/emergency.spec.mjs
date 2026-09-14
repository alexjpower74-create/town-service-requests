// The resident emergency banner takes the town's number from the API: change it in Settings and the banner shows the new number as
// a tel: link.
import { test, expect, tap, replaceText, api, staffToken, signIn, goView } from './helpers.mjs'

test('a new emergency phone in Settings shows in the resident banner as a tel: link', async ({ page, request }) => {
  await page.goto('/')
  await expect(page.locator('#emergency-phone')).toHaveText('709-555-0142')

  await signIn(page)
  await goView(page, 'settings')
  await replaceText(page, page.locator('#s-emergency_phone'), '709-555-0177', 'emergency phone')
  await tap(page, page.locator('#settings-save'), 'Save settings')
  await expect(page.locator('#settings-ok')).toHaveText('Saved.')
  const token = await staffToken(request)
  expect((await api(request, 'GET', '/api/staff/settings', { token })).body.emergency_phone).toBe('709-555-0177')

  await page.goto('/')
  await expect(page.locator('#emergency')).toContainText('Water main break or danger right now? Call the town at 709-555-0177 or 911.')
  await expect(page.locator('#emergency-phone')).toHaveText('709-555-0177')
  await expect(page.locator('#emergency-phone')).toHaveAttribute('href', 'tel:7095550177')
})
