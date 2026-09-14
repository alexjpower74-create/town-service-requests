// The app's only door to the Worker: same-origin fetch('/api/…') per docs/API.md. A failed call throws ApiError whose message
// is the API's own `error` text, shown to people as is, with `field` naming the input it belongs next to. No signal throws
// ApiError with code "network". `?mock=1` swaps in api.mock.js for development (remembered for the tab; `?mock=0` turns it
// off). Playwright specs never use the mock.

const MOCK_KEY = 'tsr:mock'

const mode = new URLSearchParams(location.search).get('mock')
let mocked = false
try {
  if (mode === '1') sessionStorage.setItem(MOCK_KEY, '1')
  if (mode === '0') sessionStorage.removeItem(MOCK_KEY)
  mocked = sessionStorage.getItem(MOCK_KEY) === '1'
} catch { mocked = mode === '1' }
const mock = mocked ? await import('/api.mock.js') : null

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Something went wrong (error ${status}). Please try again.`)
    this.status = status
    this.code = body?.code || 'error'
    this.field = body?.field || null
    this.body = body || {}
  }
}

const NO_SIGNAL = { error: 'No signal. Check your connection and try again.', code: 'network' }

// One request. Answers { status, data } for every HTTP status; throws ApiError(0, network) only when nothing came back.
export async function send(method, path, { json, bytes, type, headers = {} } = {}) {
  const h = { ...headers }
  let body
  if (json !== undefined) { h['content-type'] = 'application/json'; body = JSON.stringify(json) }
  if (bytes !== undefined) { h['content-type'] = type; body = bytes }
  if (mock) return mock.handle(method, path, { json, bytes, type, headers: h })
  let res
  try {
    res = await fetch(path, { method, headers: h, body, cache: 'no-store' })
  } catch {
    throw new ApiError(0, NO_SIGNAL)
  }
  let text
  try { text = await res.text() } catch { throw new ApiError(0, NO_SIGNAL) }
  let data = null
  try { data = JSON.parse(text) } catch {}
  return { status: res.status, data }
}

async function call(method, path, options) {
  const r = await send(method, path, options)
  if (r.status >= 200 && r.status < 300) return r.data
  throw new ApiError(r.status, r.data)
}

const q = encodeURIComponent
// upload_url is absolute (docs/API.md); the page still only ever talks to its own origin.
const samePath = (url) => { const u = new URL(url, location.origin); return u.pathname + u.search }

export const api = {
  mocked,
  town: () => call('GET', '/api/town'),
  createRequest: (body) => call('POST', '/api/requests', { json: body }),
  uploadPhoto: (uploadUrl, token, blob) => call('PUT', samePath(uploadUrl), { bytes: blob, type: blob.type, headers: { Authorization: `Bearer ${token}` } }),
  nearby: (category, lat, lng) => call('GET', `/api/requests/nearby?category=${q(category)}&lat=${q(lat)}&lng=${q(lng)}`),
  meToo: (id, deviceId) => call('POST', `/api/requests/${q(id)}/me-too`, { json: { device_id: deviceId } }),
  status: (key) => call('GET', `/api/status/${q(key)}`),
}
