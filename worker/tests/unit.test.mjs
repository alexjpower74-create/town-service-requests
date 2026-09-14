// Pure units: SLA / overdue / age / days to close, NL labels across DST, history and copy texts, SAMPLE rows vs the migration.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dueAt, isOverdue, overdueDays, ageDays, daysToClose, meanDaysHalfUp, DAY_MS } from '../src/sla.js'
import { dateLabel, fullLabel } from '../src/time.js'
import { copyUpdate } from '../src/copy.js'
import * as H from '../src/history.js'
import { verifyPin } from '../src/auth.js'
import { SAMPLE_SETTINGS, SAMPLE_CREWS, SAMPLE_PIN } from '../src/sample.js'

const MIN = 60000
const HOUR = 3600000
const T = Date.parse('2026-09-07T13:15:00.000Z')

function check (status, now, sla = 10) {
  const due = dueAt(T, sla)
  const clock = { status, createdAt: T, dueAt: due, now }
  return { overdue: isOverdue(clock), overdue_days: overdueDays(clock) }
}

test('SLA: a streetlight (10 days) is not overdue at T + 9 d 23 h 59 m', () => {
  assert.deepEqual(check('new', T + 9 * DAY_MS + 23 * HOUR + 59 * MIN), { overdue: false, overdue_days: 0 })
})

test('SLA: not overdue at exactly T + 10 d', () => {
  assert.deepEqual(check('assigned', T + 10 * DAY_MS), { overdue: false, overdue_days: 0 })
})

test('SLA: overdue at T + 10 d + 1 min with overdue_days 1', () => {
  assert.deepEqual(check('in_progress', T + 10 * DAY_MS + MIN), { overdue: true, overdue_days: 1 })
  assert.deepEqual(check('new', T + 11 * DAY_MS), { overdue: true, overdue_days: 1 })
  assert.deepEqual(check('new', T + 11 * DAY_MS + 1), { overdue: true, overdue_days: 2 })
})

test('SLA: done, won\'t fix and merged are never overdue; a null SLA is never overdue', () => {
  const late = T + 100 * DAY_MS
  for (const status of ['done', 'wont_fix', 'merged']) assert.deepEqual(check(status, late), { overdue: false, overdue_days: 0 })
  assert.equal(dueAt(T, null), null)
  assert.deepEqual(check('new', late, null), { overdue: false, overdue_days: 0 })
  assert.equal(dueAt(T, 10), T + 10 * DAY_MS)
})

test('age_days floors', () => {
  assert.equal(ageDays(T, T), 0)
  assert.equal(ageDays(T, T + DAY_MS - 1), 0)
  assert.equal(ageDays(T, T + DAY_MS), 1)
  assert.equal(ageDays(T, T + 7 * DAY_MS + 23 * HOUR), 7)
})

test('days_to_close rounds half-up to 1 decimal', () => {
  assert.equal(daysToClose(T, T + 3.25 * DAY_MS), 3.3)
  assert.equal(daysToClose(T, T + 3.25 * DAY_MS - 1), 3.2)
  assert.equal(daysToClose(T, T + 1.15 * DAY_MS), 1.2) // 1.15 * 10 is 11.4999… in floating point
  assert.equal(daysToClose(T, T + 0.05 * DAY_MS), 0.1)
  assert.equal(daysToClose(T, T), 0)
  assert.equal(daysToClose(T, null), null)
  assert.equal(meanDaysHalfUp(3 * DAY_MS + 3.5 * DAY_MS, 2), 3.3) // mean 3.25
})

test('labels in NL time, across both DST changes', () => {
  assert.equal(fullLabel('2026-09-07T13:15:00.000Z'), 'Mon Sep 7, 10:45 AM') // NDT, UTC-2:30
  assert.equal(dateLabel('2026-09-07T13:15:00.000Z'), 'Mon Sep 7')
  assert.equal(dateLabel('2026-09-08T02:00:00.000Z'), 'Mon Sep 7') // 11:30 PM Monday in NL, Tuesday in UTC
  assert.equal(fullLabel('2026-09-08T02:00:00.000Z'), 'Mon Sep 7, 11:30 PM')
  // Spring forward, Sun Mar 8 2026 at 2:00 AM NST -> 3:00 AM NDT
  assert.equal(fullLabel('2026-03-08T05:00:00.000Z'), 'Sun Mar 8, 1:30 AM') // NST, UTC-3:30
  assert.equal(fullLabel('2026-03-08T06:00:00.000Z'), 'Sun Mar 8, 3:30 AM') // NDT, UTC-2:30
  // Fall back, Sun Nov 1 2026 at 2:00 AM NDT -> 1:00 AM NST
  assert.equal(fullLabel('2026-11-01T04:29:00.000Z'), 'Sun Nov 1, 1:59 AM') // NDT
  assert.equal(fullLabel('2026-11-01T05:31:00.000Z'), 'Sun Nov 1, 2:01 AM') // NST
  assert.equal(fullLabel('2026-12-25T16:30:00.000Z'), 'Fri Dec 25, 1:00 PM')
  assert.equal(fullLabel(null), null)
  assert.equal(dateLabel(null), null)
})

test('history texts', () => {
  assert.deepEqual(H.status('assigned'), { kind: 'status', public_text: 'Assigned to a crew', staff_text: 'Assigned', internal: 0 })
  assert.deepEqual(H.status('new'), { kind: 'status', public_text: 'Reopened', staff_text: 'Reopened', internal: 0 })
  assert.deepEqual(H.crew('Roads crew (SAMPLE)'), { kind: 'crew', public_text: null, staff_text: 'Crew: Roads crew (SAMPLE)', internal: 1 })
  assert.deepEqual(H.crew(null), { kind: 'crew', public_text: null, staff_text: 'Crew removed', internal: 1 })
  assert.deepEqual(H.message(null), { kind: 'message', public_text: null, staff_text: 'Public message removed', internal: 1 })
  assert.deepEqual(H.note('Call back Friday'), { kind: 'note', public_text: null, staff_text: 'Call back Friday', internal: 1 })
  assert.deepEqual(H.mergedIn('HP-1002', 4), {
    kind: 'merged_in', public_text: 'Another report of the same problem was joined to this one', staff_text: 'Joined in HP-1002 (+4)', internal: 0
  })
})

test('copy_update for merged names the kept report', () => {
  assert.equal(copyUpdate({
    townName: 'SAMPLE Town', ref: 'HP-1002', categoryLabel: 'Pothole', locationLabel: 'Main Street', status: 'merged', targetRef: 'HP-1001',
    publicMessage: null, statusUrl: 'http://x/s/?k=abc'
  }), 'SAMPLE Town: update on your report HP-1002 (Pothole, Main Street). It was joined with report HP-1001. Follow it here: http://x/s/?k=abc')
})

test('SAMPLE rows: the migration and the reset agree, and the stored PIN is 3690', async () => {
  const sql = readFileSync(new URL('../migrations/0002_sample.sql', import.meta.url), 'utf8')
  const s = SAMPLE_SETTINGS
  for (const value of [s.town_name, s.emergency_phone, s.office_phone, s.office_hours, JSON.stringify(s.sla_days), s.pin_hash, s.pin_salt]) {
    assert.ok(sql.includes(`'${value}'`), `migration has ${value}`)
  }
  assert.ok(sql.includes(`, ${s.pin_iterations});`))
  for (const c of SAMPLE_CREWS) assert.ok(sql.includes(`(${c.id}, '${c.name}', 1)`), `migration has crew ${c.name}`)
  assert.equal(JSON.stringify(s.sla_days), '{"pothole":14,"streetlight":10,"snow":2,"water":3,"garbage":3,"tree":5,"other":14}')
  assert.equal(await verifyPin(SAMPLE_PIN, s), true)
  assert.equal(await verifyPin('3691', s), false)
  assert.equal(await verifyPin('', s), false)
})
