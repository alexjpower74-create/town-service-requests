// Resident report page `/` (phone, no account): pick a category → put a pin inside the town boundary → "Already reported
// nearby" (only when the API finds any) → photo (optional, made smaller on the phone) → details → Report sent.
// The report is never blocked by the photo: it is created first, then the photo goes up with its upload token.
// submission_id is made once per report and reused on every retry, so resending never makes a second report.
import { api } from '/api.js'
import { esc, brandBar, telHref, chip, categoryIcon, BACK_ICON, uuid, deviceId, readJson, writeJson } from '/ui.js'
import { insideRing, nearestStreetByPoint } from '/geo.js'
import { townMap, pinIcon } from '/map.js'

export const OUTSIDE = 'That spot is outside the town. Move the pin inside the line on the map.'
const PHOTO_FAILED = "Your report was sent, but the photo didn't go through."
const MAX_SIDE = 1600
const JPEG_QUALITY = 0.7
const REPORTS_KEY = 'tsr:reports'
const METOO_KEY = 'tsr:me-too'
const STEPS = ['home', 'where', 'nearby', 'metoo', 'photo', 'details', 'sent']

const $ = (id) => document.getElementById(id)
const state = { town: null, category: null, submissionId: null, pin: null, inside: false, place: '', nearby: [], photo: null, body: null, created: null }
let map = null
let marker = null

function show(step) {
  for (const s of STEPS) $(`step-${s}`).hidden = s !== step
  document.body.dataset.step = step
  window.scrollTo(0, 0)
  $(`step-${step}`).querySelector('h1')?.focus({ preventScroll: true })
  if (step === 'where' && map) requestAnimationFrame(() => map.invalidateSize())
}

/* ---- start ------------------------------------------------------------------ */
async function start() {
  for (const el of document.querySelectorAll('.back-icon')) el.innerHTML = BACK_ICON
  try {
    state.town = await api.town()
  } catch (e) {
    $('loading').hidden = true
    $('load-error').textContent = e.message
    return
  }
  const t = state.town
  $('brand').innerHTML = brandBar(t)
  document.title = `Report a problem · ${t.name}`
  $('emergency-phone').textContent = t.emergency_phone
  $('emergency-phone').href = telHref(t.emergency_phone)
  $('emergency').hidden = false
  $('cats').innerHTML = t.categories.map((c) => `
    <button type="button" class="cat-btn" data-category="${esc(c.key)}">
      <span class="cat-icon">${categoryIcon(c.key)}</span>
      <span class="cat-label">${esc(c.label)}</span>
      <span class="cat-hint">${esc(c.hint)}</span>
    </button>`).join('')
  $('loading').hidden = true
  renderMine()
  show('home')
}

function renderMine() {
  const list = readJson(REPORTS_KEY, [])
  $('mine').hidden = list.length === 0
  $('mine-list').innerHTML = list.slice().reverse().map((r) => `
    <li><a href="${esc(r.status_url)}" data-ref="${esc(r.ref)}">
      <span class="ref">${esc(r.ref)}</span> · ${esc(r.category_label)} · ${esc(r.location_label)}
      <span class="muted small">${r.kind === 'me_too' ? 'You said "Me too"' : `Reported ${esc(r.reported_label)}`}</span>
    </a></li>`).join('')
}

function remember(entry) {
  const list = readJson(REPORTS_KEY, []).filter((r) => r.ref !== entry.ref)
  list.push(entry)
  writeJson(REPORTS_KEY, list.slice(-20))
}

/* ---- step 1: category -------------------------------------------------------- */
$('cats').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-category]')
  if (btn) startReport(btn.dataset.category)
})

function startReport(key) {
  state.category = state.town.categories.find((c) => c.key === key)
  state.submissionId = uuid()
  state.pin = null
  state.inside = false
  state.place = ''
  state.nearby = []
  state.body = null
  state.created = null
  clearPhoto()
  for (const id of ['description', 'name', 'phone']) $(id).value = ''
  clearErrors()
  updateCounter()
  $('description-optional').textContent = key === 'other' ? '(needed for Something else)' : '(optional)'
  for (const el of document.querySelectorAll('[data-chosen]')) el.innerHTML = `<span class="cat-icon sm">${categoryIcon(key)}</span>${esc(state.category.label)}`
  $('where-error').textContent = ''
  $('where-note').textContent = ''
  $('where-label').textContent = ''
  for (const a of ['lat', 'lng', 'inside']) delete $('where-label').dataset[a]
  $('where-next').disabled = true
  closeSearch()
  show('where')
  if (!map) {
    map = townMap($('map'), state.town)
    map.on('click', (ev) => setPin(ev.latlng.lat, ev.latlng.lng))
  } else {
    if (marker) { marker.remove(); marker = null }
    map.setView(state.town.center, state.town.zoom)
  }
  requestAnimationFrame(() => map.invalidateSize())
}

/* ---- step 2: where ------------------------------------------------------------ */
function setPin(lat, lng, streetName = null) {
  state.pin = { lat, lng }
  if (!marker) {
    marker = L.marker([lat, lng], { icon: pinIcon(), draggable: true, keyboard: false, title: 'Your pin', alt: 'Your pin' }).addTo(map)
    marker.on('dragend', () => { const p = marker.getLatLng(); setPin(p.lat, p.lng) })
  } else {
    marker.setLatLng([lat, lng])
  }
  // The same ray-casting rule as the Worker: a pin outside the line never gets as far as the API.
  state.inside = insideRing([lat, lng], state.town.boundary)
  const label = $('where-label')
  label.dataset.lat = String(lat)
  label.dataset.lng = String(lng)
  label.dataset.inside = String(state.inside)
  $('where-note').textContent = ''
  if (!state.inside) {
    label.textContent = ''
    $('where-error').textContent = OUTSIDE
    $('where-next').disabled = true
    return
  }
  $('where-error').textContent = ''
  state.place = streetName || nearestStreetByPoint([lat, lng], state.town.streets)
  label.textContent = state.place ? `Near ${state.place}` : 'Not near a named street'
  $('where-next').disabled = false
}

$('locate').addEventListener('click', () => {
  closeSearch()
  if (!navigator.geolocation) {
    $('where-error').textContent = "This phone can't share its location. Tap the map instead."
    return
  }
  $('where-note').textContent = 'Finding where you are…'
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords
      map.setView([lat, lng], Math.max(map.getZoom(), 17), { animate: false })
      setPin(lat, lng)
    },
    () => {
      $('where-note').textContent = ''
      $('where-error').textContent = "We couldn't find where you are. Tap the map instead, or search a street."
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
  )
})

function closeSearch() {
  $('search').hidden = true
  $('search-open').setAttribute('aria-expanded', 'false')
  $('street-q').value = ''
  $('street-list').innerHTML = ''
}
$('search-open').addEventListener('click', () => {
  if (!$('search').hidden) return closeSearch()
  $('search').hidden = false
  $('search-open').setAttribute('aria-expanded', 'true')
  $('street-q').focus()
})
$('street-q').addEventListener('input', () => {
  const q = $('street-q').value.trim().toLowerCase()
  if (!q) { $('street-list').innerHTML = ''; return }
  const hits = state.town.streets
    .filter((s) => s.name.toLowerCase().includes(q))
    .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)))
    .slice(0, 8)
  $('street-list').innerHTML = hits.length
    ? hits.map((s) => `<li><button type="button" class="street-opt" data-street="${esc(s.name)}">${esc(s.name)}</button></li>`).join('')
    : '<li class="none">No street by that name in the town.</li>'
})
$('street-list').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-street]')
  if (!btn) return
  const street = state.town.streets.find((s) => s.name === btn.dataset.street)
  closeSearch()
  map.setView(street.point, 17, { animate: false })
  setPin(street.point[0], street.point[1], street.name)
})

$('where-next').addEventListener('click', async () => {
  if (!state.pin || !state.inside) return
  const btn = $('where-next')
  btn.disabled = true
  btn.textContent = 'Checking…'
  try {
    const r = await api.nearby(state.category.key, state.pin.lat, state.pin.lng)
    state.nearby = r.requests
    if (state.nearby.length) {
      renderNearby()
      show('nearby')
    } else {
      show('photo')
    }
  } catch (e) {
    $('where-error').textContent = e.message
  } finally {
    btn.textContent = 'Next'
    btn.disabled = !state.inside
  }
})

/* ---- already reported nearby --------------------------------------------------- */
function renderNearby() {
  const added = new Map(readJson(METOO_KEY, []).map((x) => [x.id, x]))
  $('nearby-list').innerHTML = state.nearby.map((r) => {
    const mine = added.get(r.id)
    const others = r.plus_ones ? `<p class="near-plus">+${r.plus_ones} ${r.plus_ones === 1 ? 'other' : 'others'}</p>` : ''
    const action = mine
      ? `<p class="added" data-added>You already added yourself to ${esc(r.ref)} from this phone.</p>
         <a class="btn btn-secondary" href="${esc(mine.status_url)}">Open its status page</a>`
      : '<button type="button" class="btn btn-primary" data-metoo>Me too</button>'
    return `
      <article class="near-card" data-id="${r.id}" data-ref="${esc(r.ref)}">
        <div class="near-head"><span class="cat-icon sm">${categoryIcon(r.category)}</span><span class="near-cat">${esc(r.category_label)}</span>${chip(r.status, r.status_label)}</div>
        <p class="near-street">${esc(r.location_label)}</p>
        <p class="muted">Reported ${esc(r.reported_label)}</p>
        <p class="muted" data-distance>about ${r.distance_m} m from your pin</p>
        ${others}
        ${action}
        <p class="field-error" data-error role="alert"></p>
      </article>`
  }).join('')
}

$('nearby-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-metoo]')
  if (!btn) return
  const card = btn.closest('.near-card')
  const id = Number(card.dataset.id)
  const r0 = state.nearby.find((x) => x.id === id)
  btn.disabled = true
  card.querySelector('[data-error]').textContent = ''
  try {
    const r = await api.meToo(id, deviceId())
    writeJson(METOO_KEY, [...readJson(METOO_KEY, []).filter((x) => x.id !== id), { id, ref: r.ref, status_url: r.status_url }])
    remember({ kind: 'me_too', ref: r.ref, status_url: r.status_url, category_label: r0.category_label, location_label: r0.location_label, reported_label: r0.reported_label })
    $('metoo-text').textContent = r.duplicate ? `You were already added to ${r.ref}. Thanks.` : `Thanks. We added you to ${r.ref}.`
    $('metoo-open').href = r.status_url
    show('metoo')
  } catch (err) {
    card.querySelector('[data-error]').textContent = err.message
    btn.disabled = false
  }
})
$('nearby-different').addEventListener('click', () => show('photo'))

/* ---- step 3: photo ---------------------------------------------------------------- */
function clearPhoto() {
  if (state.photo?.url) URL.revokeObjectURL(state.photo.url)
  state.photo = null
  $('photo-preview').removeAttribute('src')
  for (const a of ['width', 'height', 'bytes', 'type']) delete $('photo-preview').dataset[a]
  $('photo-empty').hidden = false
  $('photo-chosen').hidden = true
  $('photo-error').textContent = ''
}

async function decode(file) {
  if (globalThis.createImageBitmap) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bmp, width: bmp.width, height: bmp.height, done: () => bmp.close() }
    } catch {}
  }
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.src = url
  try {
    await img.decode()
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) }
}

// At most 1600 px on the long side, JPEG quality 0.7, drawn through a canvas (also drops the photo's location metadata).
async function shrink(file) {
  const img = await decode(file)
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height))
    const width = Math.max(1, Math.round(img.width * scale))
    const height = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d').drawImage(img.source, 0, 0, width, height)
    const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', JPEG_QUALITY))
    return { blob, width, height }
  } finally {
    img.done()
  }
}

const pickPhoto = () => $('photo-input').click()
$('photo-add').addEventListener('click', pickPhoto)
$('photo-change').addEventListener('click', pickPhoto)
$('photo-input').addEventListener('change', async () => {
  const file = $('photo-input').files?.[0]
  $('photo-input').value = ''
  if (!file) return
  $('photo-error').textContent = ''
  $('photo-busy').hidden = false
  try {
    const small = await shrink(file)
    clearPhoto()
    state.photo = { ...small, url: URL.createObjectURL(small.blob) }
    const img = $('photo-preview')
    img.src = state.photo.url
    Object.assign(img.dataset, { width: small.width, height: small.height, bytes: small.blob.size, type: small.blob.type })
    $('photo-empty').hidden = true
    $('photo-chosen').hidden = false
  } catch {
    $('photo-error').textContent = "That photo couldn't be opened. Try another one, or skip the photo."
  } finally {
    $('photo-busy').hidden = true
  }
})
$('photo-skip').addEventListener('click', () => { clearPhoto(); show('details') })
$('photo-remove').addEventListener('click', () => { clearPhoto(); show('details') })
$('photo-next').addEventListener('click', () => show('details'))

/* ---- step 4: details and send ------------------------------------------------------- */
function updateCounter() {
  const n = $('description').value.trim().length
  $('description-count').textContent = `${n} of 500`
  $('description-count').classList.toggle('over', n > 500)
}
$('description').addEventListener('input', updateCounter)

function clearErrors() {
  for (const id of ['description', 'name', 'phone']) {
    $(`${id}-error`).textContent = ''
    $(id).removeAttribute('aria-invalid')
  }
  $('send-error').textContent = ''
}

function showError(e) {
  const field = ['description', 'name', 'phone'].includes(e.field) ? e.field : null
  if (field) {
    $(`${field}-error`).textContent = e.message
    $(field).setAttribute('aria-invalid', 'true')
    $(field).focus()
  } else {
    $('send-error').textContent = e.message
  }
}

$('send').addEventListener('click', async () => {
  const btn = $('send')
  if (btn.disabled) return
  clearErrors()
  btn.disabled = true
  btn.textContent = 'Sending…'
  // The same submission_id on every try: a resend after no signal answers the report already made.
  state.body = {
    submission_id: state.submissionId,
    device_id: deviceId(),
    category: state.category.key,
    lat: state.pin.lat,
    lng: state.pin.lng,
    description: $('description').value,
    name: $('name').value,
    phone: $('phone').value,
    has_photo: Boolean(state.photo),
  }
  try {
    const r = await api.createRequest(state.body)
    state.created = r
    remember({ kind: 'report', ref: r.ref, status_url: r.status_url, category_label: r.category_label, location_label: r.location_label, reported_label: r.reported_label })
    renderSent(r)
    show('sent')
    if (state.photo) uploadPhoto(r)
  } catch (e) {
    showError(e)
  } finally {
    btn.disabled = false
    btn.textContent = 'Send report'
  }
})

/* ---- report sent ------------------------------------------------------------------- */
function renderSent(r) {
  $('sent-ref').textContent = r.ref
  $('sent-what').textContent = `${r.category_label} · ${r.location_label} · ${r.reported_label}`
  $('sent-link').value = r.status_url
  $('open-status').href = r.status_url
  $('copy-link').textContent = 'Copy link'
  $('photo-status').innerHTML = ''
}

// First try: the token from the create answer. A retry asks again with the same submission_id, which answers the same report
// with a fresh token while its photo is still waiting.
async function uploadPhoto(created) {
  const box = $('photo-status')
  box.innerHTML = '<p class="muted">Sending the photo…</p>'
  try {
    const r = created || (await api.createRequest(state.body))
    if (r.photo !== 'stored') {
      if (!r.upload_token) throw new Error('no upload token')
      await api.uploadPhoto(r.upload_url, r.upload_token, state.photo.blob)
    }
    box.innerHTML = '<p class="ok" data-photo-ok>Photo added.</p>'
  } catch (e) {
    const why = e.status >= 400 && e.status < 500 && e.status !== 401 ? `<p class="muted">${esc(e.message)}</p>` : ''
    box.innerHTML = `<p class="field-error" role="alert">${PHOTO_FAILED}</p>${why}
      <button type="button" class="btn btn-secondary" id="photo-retry">Try the photo again</button>`
  }
}
$('photo-status').addEventListener('click', (e) => {
  if (e.target.closest('#photo-retry')) uploadPhoto(null)
})

$('copy-link').addEventListener('click', async () => {
  const link = $('sent-link')
  try {
    await navigator.clipboard.writeText(link.value)
  } catch {
    link.select()
    try { document.execCommand('copy') } catch {}
  }
  $('copy-link').textContent = 'Copied'
})

for (const btn of document.querySelectorAll('[data-restart]')) {
  btn.addEventListener('click', () => { renderMine(); show('home') })
}

/* ---- back ---------------------------------------------------------------------------- */
for (const btn of document.querySelectorAll('[data-back]')) {
  btn.addEventListener('click', () => {
    const to = btn.dataset.back
    if (to === 'home') renderMine()
    if (to === 'photo-back') return show(state.nearby.length ? 'nearby' : 'where')
    if (to === 'nearby' || to === 'where') closeSearch()
    show(to)
  })
}

start()
