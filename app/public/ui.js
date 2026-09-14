// Small shared helpers for every page: escaping, the town bar with its SAMPLE badge, status chips, category icons (inline SVG
// line icons, never emoji), ids kept on the phone. No DOM framework: pages build strings with esc() around every value.

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c])

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// The town bar every screen carries: the town name, and the SAMPLE badge while the town is sample.
export function brandBar(town) {
  const name = town?.name || 'Town service requests'
  const badge = town?.sample ? '<span class="sample-badge" data-sample>SAMPLE</span>' : ''
  return `<div class="brand"><span class="town-name" data-town-name>${esc(name)}</span>${badge}</div>`
}

export const telHref = (phone) => `tel:${String(phone || '').replace(/[^\d+]/g, '')}`

export const chip = (status, label, extra = '') => `<span class="chip st-${esc(status)}${extra ? ` ${extra}` : ''}" data-status="${esc(status)}">${esc(label)}</span>`

// What each status means to a resident (the same sentences as the staff "copy update" text in docs/API.md).
export const STATUS_SENTENCE = {
  new: 'We have your report.',
  assigned: 'A crew has been assigned.',
  in_progress: 'Work has started.',
  done: 'The work is done.',
  wont_fix: "We won't be fixing this one.",
}

const svg = (body) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`
export const CATEGORY_ICONS = {
  pothole: svg('<path d="M5 21 9 3M19 21 15 3"/><ellipse cx="12" cy="14.5" rx="3.6" ry="1.8"/><path d="M12 5v2"/>'),
  streetlight: svg('<path d="M7 21h6M10 21V6a3 3 0 0 1 3-3h3"/><path d="M14.5 3H21l-1.6 3.5h-3.3z"/><path d="M18 9.5v1.5M15.5 9l-.8 1.2M20.5 9l.8 1.2"/>'),
  snow: svg('<path d="M12 2v20M3.3 7l17.4 10M20.7 7 3.3 17"/><path d="m9 4 3 2 3-2M9 20l3-2 3 2"/>'),
  water: svg('<path d="M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11z"/><path d="M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5"/>'),
  garbage: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/>'),
  tree: svg('<path d="M3 20h18"/><path d="M5 17 18 8"/><path d="M13 11.5c-1-3 1-6 4-6.5 1 3-1 6-4 6.5zM9.5 14c-2.5-1-3.5-4-2-6.5 2.5 1 3.5 4 2 6.5z"/>'),
  other: svg('<circle cx="12" cy="12" r="9"/><path d="M8 12h.01M12 12h.01M16 12h.01" stroke-width="3"/>'),
}
export const BACK_ICON = svg('<path d="M15 5l-7 7 7 7"/>')
export const categoryIcon = (key) => CATEGORY_ICONS[key] || CATEGORY_ICONS.other

// UUID v4 (submission_id, device_id). randomUUID needs a secure context; a phone on a LAN address may not have one.
export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// One device id per phone, made once and kept in localStorage (docs/API.md: "Me too" counts once per phone).
const DEVICE_KEY = 'tsr:device-id'
let memoryDevice = null
export function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) { id = uuid(); localStorage.setItem(DEVICE_KEY, id) }
    return id
  } catch {
    memoryDevice ||= uuid()
    return memoryDevice
  }
}

export function readJson(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback } catch { return fallback }
}
export function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
}
