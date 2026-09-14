// Settings on the real Worker: inline validation, a wrong current PIN that stays inline (no sign-out), crews that show up in and
// drop out of a report's crew list, and a PIN change that makes the old PIN fail.
import { test, expect, tap, typeText, replaceText, api, makeRequest, staffToken, signIn, openCard, goView } from './helpers.mjs'

test('bad settings show the API message next to the field, and a wrong current PIN stays inline without signing out', async ({ page, request }) => {
  await signIn(page)
  await goView(page, 'settings')
  await replaceText(page, page.locator('#s-emergency_phone'), '12', 'emergency phone')
  await tap(page, page.locator('#settings-save'), 'Save settings')
  await expect(page.locator('#err-emergency_phone')).toHaveText('Type a phone number like 709-555-0100.')
  await expect(page.locator('#settings-ok')).toHaveText('')

  await replaceText(page, page.locator('#s-emergency_phone'), '709-555-0142', 'emergency phone')
  await replaceText(page, page.locator('#sla-pothole'), '400', 'pothole SLA')
  await tap(page, page.locator('#settings-save'), 'Save settings')
  await expect(page.locator('#err-sla-pothole')).toHaveText('Use 1 to 365 days, or leave it blank for no target.')
  await expect(page.locator('#err-emergency_phone')).toHaveText('')

  // Blank means no target.
  await replaceText(page, page.locator('#sla-pothole'), '', 'pothole SLA')
  await tap(page, page.locator('#settings-save'), 'Save settings')
  await expect(page.locator('#settings-ok')).toHaveText('Saved.')
  const token = await staffToken(request)
  expect((await api(request, 'GET', '/api/staff/settings', { token })).body.sla_days.pothole).toBeNull()

  await typeText(page, page.locator('#pin-current'), '1111', 'current PIN')
  await typeText(page, page.locator('#pin-new'), '2468', 'new PIN')
  const answer = page.waitForResponse((r) => r.url().endsWith('/api/staff/pin'))
  await tap(page, page.locator('#pin-save'), 'Change PIN')
  const res = await answer
  expect(res.status()).toBe(401)
  expect((await res.json()).field).toBe('current_pin')
  await expect(page.locator('#err-current_pin')).toHaveText('That PIN is not right.')
  await expect(page.locator('#signout'), 'still signed in').toBeVisible()
  await expect(page.locator('#pin-form')).toBeVisible()
  await goView(page, 'board')
  expect((await api(request, 'POST', '/api/staff/signin', { data: { pin: '3690' } })).status, 'the PIN is unchanged').toBe(200)
})

test('a new crew appears in a report\'s crew list, a renamed one follows, and a deactivated one disappears', async ({ page, request }) => {
  const created = await makeRequest(request)
  const token = await staffToken(request)
  await signIn(page)
  await goView(page, 'settings')
  // Each crew change re-draws the list: wait for the re-draw before touching the list again.
  const list = page.locator('#crew-list')
  const redrawn = async (before) => expect(list).not.toHaveAttribute('data-rendered', before)
  await typeText(page, page.locator('#crew-new'), 'Sidewalk crew (SAMPLE)', 'new crew')
  let before = await list.getAttribute('data-rendered')
  await tap(page, page.locator('#crew-add'), 'Add crew')
  await redrawn(before)
  const crews = (await api(request, 'GET', '/api/staff/crews', { token })).body.crews
  const crew = crews.find((c) => c.name === 'Sidewalk crew (SAMPLE)')
  expect(crew?.active).toBe(true)
  await expect(page.locator(`.crew-row[data-crew-id="${crew.id}"]`)).toHaveAttribute('data-active', 'true')

  await goView(page, 'board')
  await openCard(page, created.ref, 'new')
  await expect(page.locator(`#d-crew option[value="${crew.id}"]`)).toHaveText('Sidewalk crew (SAMPLE)')
  await tap(page, page.locator('#detail-close'), 'Close')

  await goView(page, 'settings')
  await replaceText(page, page.locator(`#crew-name-${crew.id}`), 'Pavement crew (SAMPLE)', 'crew name')
  before = await list.getAttribute('data-rendered')
  await tap(page, page.locator(`[data-crew-rename="${crew.id}"]`), 'Rename')
  await redrawn(before)
  await expect(page.locator(`#crew-name-${crew.id}`)).toHaveValue('Pavement crew (SAMPLE)')
  before = await list.getAttribute('data-rendered')
  await tap(page, page.locator(`[data-crew-toggle="${crew.id}"]`), 'Deactivate')
  await redrawn(before)
  await expect(page.locator(`.crew-row[data-crew-id="${crew.id}"]`)).toHaveAttribute('data-active', 'false')
  const after = (await api(request, 'GET', '/api/staff/crews', { token })).body.crews.find((c) => c.id === crew.id)
  expect(after).toMatchObject({ name: 'Pavement crew (SAMPLE)', active: false })

  await goView(page, 'board')
  await openCard(page, created.ref, 'new')
  await expect(page.locator('#d-crew option')).toHaveCount(4)
  await expect(page.locator(`#d-crew option[value="${crew.id}"]`)).toHaveCount(0)
})

test('change the PIN, sign out, the old PIN is refused and the new one works', async ({ page }) => {
  await signIn(page)
  await goView(page, 'settings')
  await typeText(page, page.locator('#pin-current'), '3690', 'current PIN')
  await typeText(page, page.locator('#pin-new'), '2468', 'new PIN')
  await tap(page, page.locator('#pin-save'), 'Change PIN')
  await expect(page.locator('#pin-ok')).toHaveText('PIN changed. Use the new PIN next time you sign in.')

  await tap(page, page.locator('#signout'), 'Sign out')
  await expect(page.locator('#pin')).toBeVisible()
  await typeText(page, page.locator('#pin'), '3690', 'old PIN')
  const refused = page.waitForResponse((r) => r.url().endsWith('/api/staff/signin'))
  await tap(page, page.locator('#signin-btn'), 'Sign in')
  expect((await refused).status()).toBe(401)
  await expect(page.locator('#pin-error')).toHaveText('That PIN is not right.')

  await typeText(page, page.locator('#pin'), '2468', 'new PIN')
  const accepted = page.waitForResponse((r) => r.url().endsWith('/api/staff/signin'))
  await tap(page, page.locator('#signin-btn'), 'Sign in')
  expect((await accepted).status()).toBe(200)
  await expect(page.locator('#app')).toHaveAttribute('data-view', 'board')
})
