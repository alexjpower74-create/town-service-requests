// The app's only door to the Worker: same-origin fetch('/api/…') per docs/API.md. A failed call throws ApiError whose message
// is the API's own `error` text, shown to people as is, with `field` naming the input it belongs next to. No signal throws
// ApiError with code "network". `?mock=1` swaps in api.mock.js for resident-page development (remembered for the tab; `?mock=0`
// turns it off; the mock has no staff routes). Playwright specs never use the mock.

const MOCK_KEY = 'tsr:mock'
const TOKEN_KEY = 'tsr:staff-token'
export const SIGNED_OUT = 'tsr:signed-out'

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

// The town office session token, kept in this browser. Staff tokens last 12 hours (docs/API.md).
export const staffSession = {
  get() { try { return localStorage.getItem(TOKEN_KEY) || '' } catch { return '' } },
  set(token) { try { localStorage.setItem(TOKEN_KEY, token) } catch {} },
  clear() { try { localStorage.removeItem(TOKEN_KEY) } catch {} },
}

// Staff routes carry the token. A 401 without a `field` means the session ended: clear it and tell the page to sign in again.
async function staff(method, path, json) {
  const token = staffSession.get()
  const r = await send(method, path, { json, headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (r.status >= 200 && r.status < 300) return r.data
  if (r.status === 401 && !r.data?.field) {
    staffSession.clear()
    window.dispatchEvent(new CustomEvent(SIGNED_OUT, { detail: r.data?.error || '' }))
  }
  throw new ApiError(r.status, r.data)
}

const q = encodeURIComponent
// A staff file (the CSV): a real fetch with the token, answered as { blob, filename } for a download.
async function staffFile(path) {
  const token = staffSession.get()
  let res
  try {
    res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' })
  } catch {
    throw new ApiError(0, NO_SIGNAL)
  }
  if (!res.ok) {
    let data = null
    try { data = await res.json() } catch {}
    if (res.status === 401 && !data?.field) {
      staffSession.clear()
      window.dispatchEvent(new CustomEvent(SIGNED_OUT, { detail: data?.error || '' }))
    }
    throw new ApiError(res.status, data)
  }
  const filename = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'town-service-requests.csv'
  return { blob: await res.blob(), filename }
}

// upload_url is absolute (docs/API.md); the page still only ever talks to its own origin.
const samePath = (url) => { const u = new URL(url, location.origin); return u.pathname + u.search }
// Only the filters that are set; an empty value is the same as absent (API.md clarification 4).
function query(params = {}) {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== '' && v !== null && v !== undefined && v !== false) s.set(k, v === true ? '1' : String(v))
  const text = s.toString()
  return text ? `?${text}` : ''
}

export const api = {
  mocked,
  town: () => call('GET', '/api/town'),
  locate: (lat, lng) => call('GET', `/api/town/locate?lat=${q(lat)}&lng=${q(lng)}`),
  createRequest: (body) => call('POST', '/api/requests', { json: body }),
  uploadPhoto: (uploadUrl, token, blob) => call('PUT', samePath(uploadUrl), { bytes: blob, type: blob.type, headers: { Authorization: `Bearer ${token}` } }),
  nearby: (category, lat, lng) => call('GET', `/api/requests/nearby?category=${q(category)}&lat=${q(lat)}&lng=${q(lng)}`),
  meToo: (id, deviceId) => call('POST', `/api/requests/${q(id)}/me-too`, { json: { device_id: deviceId } }),
  status: (key) => call('GET', `/api/status/${q(key)}`),
  staff: {
    signin: (pin) => call('POST', '/api/staff/signin', { json: { pin } }),
    signout: () => staff('POST', '/api/staff/signout'),
    requests: (filters) => staff('GET', `/api/staff/requests${query(filters)}`),
    request: (id) => staff('GET', `/api/staff/requests/${q(id)}`),
    save: (id, body) => staff('PUT', `/api/staff/requests/${q(id)}`, body),
    note: (id, text) => staff('POST', `/api/staff/requests/${q(id)}/notes`, { text }),
    candidates: (id) => staff('GET', `/api/staff/requests/${q(id)}/candidates`),
    merge: (id, intoId) => staff('POST', `/api/staff/requests/${q(id)}/merge`, { into_id: intoId }),
    crews: () => staff('GET', '/api/staff/crews'),
    settings: () => staff('GET', '/api/staff/settings'),
    saveSettings: (body) => staff('PUT', '/api/staff/settings', body),
    changePin: (body) => staff('PUT', '/api/staff/pin', body),
    addCrew: (name) => staff('POST', '/api/staff/crews', { name }),
    updateCrew: (id, body) => staff('PUT', `/api/staff/crews/${q(id)}`, body),
    weekly: (week) => staff('GET', `/api/staff/report/weekly${query({ week })}`),
    exportCsv: (filters) => staffFile(`/api/staff/export.csv${query(filters)}`),
  },
}
