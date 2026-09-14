// Used only by `npm run negative:mergegiveup`, never by `npm test`: it expects a copy of the Worker whose merge batch always loses
// its version guard. On that copy a merge must give up after its retries with 409 bad_state (API.md clarification 13) and write
// nothing. The shipped Worker merges normally, so this file would fail there by design.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { POINTS } from './test-points.js'

const BASE = process.env.BASE || `http://127.0.0.1:${process.env.PORT || 8502}`
const T0 = '2026-09-07T13:15:00.000Z'

async function api (method, path, { body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'X-Test-Now': T0,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, body: json, text }
}

const create = async () => {
  const [lat, lng] = POINTS.inside_centre
  const r = await api('POST', '/api/requests', { body: { submission_id: randomUUID(), device_id: randomUUID(), category: 'pothole', lat, lng, has_photo: false } })
  assert.equal(r.status, 201, r.text)
  return r.body
}

test('merge: a merge that keeps losing its version guard gives up with 409 and writes nothing', async () => {
  assert.equal((await api('POST', '/api/test/reset')).status, 200)
  const target = await create()
  const source = await create()
  assert.equal((await api('POST', `/api/requests/${source.id}/me-too`, { body: { device_id: randomUUID() } })).status, 201)
  const token = (await api('POST', '/api/staff/signin', { body: { pin: '3690' } })).body.token
  const detail = async id => (await api('GET', `/api/staff/requests/${id}`, { token })).body
  const before = { target: await detail(target.id), source: await detail(source.id) }

  const r = await api('POST', `/api/staff/requests/${source.id}/merge`, { token, body: { into_id: target.id } })
  assert.equal(r.status, 409, r.text)
  assert.deepEqual(r.body, { error: 'Someone else changed one of these reports. Reload and try again.', code: 'bad_state' })

  const after = { target: await detail(target.id), source: await detail(source.id) }
  assert.deepEqual(after, before, 'nothing was written: statuses, counts, versions, merged_into and history are unchanged')
  assert.equal(after.source.status, 'new')
  assert.equal(after.source.merged_into, null)
  assert.equal(after.target.plus_ones, 0)
  assert.equal(after.target.merged_count, 0)
  const status = await api('GET', `/api/status/${source.status_key}`)
  assert.equal(status.body.merged_into, null)
})
