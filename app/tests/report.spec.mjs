// The resident journey on the real Worker: category → map tap → photo through the file chooser → details → Report sent → the
// status page, which must never show (on screen or in any response body it loaded) the phone, the name or the description.
import { test, expect, tap, tapAt, typeText, choosePhoto, staffToken, staffGet, recordBodies } from './helpers.mjs'

const NAME = 'Robin Testfield (SAMPLE)'
const PHONE = '709-555-0199'
const DESCRIPTION = 'Deep hole beside the blue mailbox (SAMPLE)'

test('a resident reports a pothole with a photo, and the status page keeps their details private', async ({ page, request }) => {
  await page.goto('/')
  await tap(page, page.locator('[data-category="pothole"]'), 'Pothole')
  await expect(page.locator('#step-where')).toBeVisible()
  await tapAt(page, page.locator('#map'), 0.5, 0.5, 'map centre')
  await expect(page.locator('#where-next')).toBeEnabled()
  await expect(page.locator('#where-label')).toHaveText(/^(Near .+|Not near a named street)$/)
  await tap(page, page.locator('#where-next'), 'Next')

  await expect(page.locator('#step-photo')).toBeVisible()
  await choosePhoto(page, page.locator('#photo-add'))
  await expect(page.locator('#photo-chosen')).toBeVisible()
  await expect(page.locator('#photo-preview')).toHaveAttribute('data-width', '1600')
  await expect(page.locator('#photo-preview')).toHaveAttribute('data-type', 'image/jpeg')
  await tap(page, page.locator('#photo-next'), 'Next (photo)')

  await expect(page.locator('#step-details')).toBeVisible()
  await typeText(page, page.locator('#description'), DESCRIPTION, 'description')
  await typeText(page, page.locator('#name'), NAME, 'name')
  await typeText(page, page.locator('#phone'), PHONE, 'phone')
  await tap(page, page.locator('#send'), 'Send report')

  await expect(page.locator('#step-sent h1')).toHaveText('Report sent')
  await expect(page.locator('#sent-ref')).toHaveText('HP-1001')
  await expect(page.locator('[data-photo-ok]')).toHaveText('Photo added.')

  const token = await staffToken(request)
  const staff = await staffGet(request, token, 1001)
  // The strings really reached the Worker, so their absence from the status page below means something.
  expect(staff.reporter_phone).toBe(PHONE)
  expect(staff.reporter_name).toBe(NAME)
  expect(staff.description).toBe(DESCRIPTION)
  expect(staff.photo, 'the staff API shows the photo stored').toBe('stored')
  expect(staff.has_photo).toBe(true)
  const photo = await request.get(new URL(staff.photo_url).pathname)
  expect(photo.status()).toBe(200)
  expect(photo.headers()['content-type']).toBe('image/jpeg')

  const bodies = recordBodies(page)
  await tap(page, page.locator('#open-status'), 'Open the status page')
  await expect(page.locator('#status-ref')).toHaveText('Report HP-1001')
  await expect(page.locator('#status-what')).toHaveText(`Pothole · ${staff.location_label}`)
  await page.waitForLoadState('networkidle')
  await expect.poll(() => bodies.some((b) => b.url.includes('/api/status/')), { message: 'the status JSON was recorded' }).toBe(true)

  const secrets = [PHONE, PHONE.replace(/\D/g, ''), NAME, 'Testfield', DESCRIPTION, 'blue mailbox']
  const text = await page.locator('body').innerText()
  for (const s of secrets) expect(text, `the status page text never shows "${s}"`).not.toContain(s)
  for (const b of bodies) {
    for (const s of secrets) expect(b.text, `the response body of ${b.url} never contains "${s}"`).not.toContain(s)
  }
})
