// Town office app /staff/ (PIN). Views by hash: #board (default), #map, #report, #settings. The board and the map share one set
// of filters. A report's detail (photo, description, contact, small map, status / crew / public message with Save and the stale
// path, copy update text, status link, internal notes, history, joined reports, "Join with another report") opens over either.
// Weekly report: week picker, table, totals, oldest open, Download CSV. Settings: phones, office hours, SLA per category, crews,
// change PIN. Errors show the API's own text next to the field it names. Nothing is sent to anyone.
import { api, staffSession, SIGNED_OUT } from '/api.js'
import { esc, brandBar, chip, categoryIcon, telHref, plural } from '/ui.js'
import { townMap, pinIcon } from '/map.js'

const COLUMNS = [['new', 'New'], ['assigned', 'Assigned'], ['in_progress', 'In progress'], ['done', 'Done'], ['wont_fix', "Won't fix"]]
const AGES = [['', 'Any age'], ['3', 'Older than 3 days'], ['7', 'Older than 7 days'], ['30', 'Older than 30 days']]
const SAVE_FIELDS = ['status', 'crew_id', 'public_message']
const VIEWS = ['board', 'map', 'report', 'settings']
const DAY_MS = 86_400_000

const $ = (id) => document.getElementById(id)
const app = $('app')
const panel = $('detail')
const state = {
  town: null, crews: [], list: null, column: 'new', detail: null, stale: null, join: null, settings: null,
  week: null, thisWeek: null,
  filters: { category: '', ward: '', min_age_days: '', overdue: false },
}
let detailMap = null
let staffMap = null
let cluster = null
let loadSeq = 0

const ageText = (n) => (n === 0 ? 'Today' : plural(n, 'day'))
const others = (n) => `+${n} ${n === 1 ? 'other' : 'others'} reported this`
const options = (list, value) => list.map(([k, l]) => `<option value="${esc(k)}"${String(k) === String(value) ? ' selected' : ''}>${esc(l)}</option>`).join('')
const shiftDate = (ymd, days) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
const avgText = (v) => (v === null || v === undefined ? '–' : Number(v).toFixed(1))

async function copyText(input, button, done = 'Copied') {
  try {
    await navigator.clipboard.writeText(input.value)
  } catch {
    input.select()
    try { document.execCommand('copy') } catch {}
  }
  button.textContent = done
}

/* ---- start, sign-in, views --------------------------------------------------------------- */
window.addEventListener(SIGNED_OUT, (e) => showSignin(e.detail || 'Sign in again.'))
window.addEventListener('hashchange', () => { if (staffSession.get()) showView() })
window.addEventListener('resize', () => updateBoardHint())

async function start() {
  try {
    state.town = await api.town()
  } catch (e) {
    app.innerHTML = `<main class="signin-wrap"><p class="field-error" role="alert">${esc(e.message)}</p></main>`
    return
  }
  $('brand').innerHTML = brandBar(state.town)
  document.title = `Town office · ${state.town.name}`
  if (staffSession.get()) showView()
  else showSignin()
}

function leaveView() {
  closeDetail(false)
  if (staffMap) { staffMap.remove(); staffMap = null; cluster = null }
  delete app.dataset.view
  loadSeq++
}

function currentView() {
  const v = location.hash.replace(/^#/, '')
  return VIEWS.includes(v) ? v : 'board'
}

function showView() {
  leaveView()
  const view = currentView()
  $('nav').hidden = false
  for (const a of document.querySelectorAll('#nav [data-view]')) {
    if (a.dataset.view === view) a.setAttribute('aria-current', 'page')
    else a.removeAttribute('aria-current')
  }
  document.title = `${{ board: 'Board', map: 'Map', report: 'Weekly report', settings: 'Settings' }[view]} · Town office · ${state.town.name}`
  ;({ board: showBoard, map: showMap, report: showReport, settings: showSettings })[view]()
}

function showSignin(message = '') {
  leaveView()
  $('nav').hidden = true
  app.innerHTML = `
    <main class="signin-wrap">
      <div class="card">
        <h1 tabindex="-1">Town office sign-in</h1>
        <form id="signin-form" novalidate>
          <label class="field-label" for="pin">PIN</label>
          <input class="field" id="pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="8">
          <p class="field-error" id="pin-error" role="alert">${esc(message)}</p>
          <div class="actions"><button class="btn btn-primary" id="signin-btn" type="submit">Sign in</button></div>
        </form>
        <p class="muted small">Residents report problems on <a href="/">the report page</a>. Nothing here is texted or emailed to anyone.</p>
      </div>
    </main>`
  app.dataset.view = 'signin'
  $('signin-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const btn = $('signin-btn')
    btn.disabled = true
    $('pin-error').textContent = ''
    try {
      const r = await api.staff.signin($('pin').value)
      staffSession.set(r.token)
      showView()
    } catch (err) {
      // Wrong PIN (401), too many tries (429) or no signal: the API's own words, and an empty box for the next try.
      $('pin-error').textContent = err.message
      $('pin').value = ''
      btn.disabled = false
    }
  })
}

$('signout').addEventListener('click', async () => {
  try { await api.staff.signout() } catch {}
  staffSession.clear()
  history.replaceState(null, '', location.pathname)
  showSignin()
})

async function loadCrews() {
  try { state.crews = (await api.staff.crews()).crews } catch {}
}

/* ---- filters, shared by the board and the map ------------------------------------------------ */
function filtersHtml() {
  const t = state.town
  const f = state.filters
  return `
    <form class="filters" id="filters" novalidate>
      <div><label class="field-label" for="f-category">Category</label>
        <select class="field" id="f-category">${options([['', 'All categories'], ...t.categories.map((c) => [c.key, c.label])], f.category)}</select></div>
      <div><label class="field-label" for="f-ward">Ward</label>
        <select class="field" id="f-ward">${options([['', 'All wards'], ...t.wards.map((w) => [w.id, w.name])], f.ward)}</select></div>
      <div><label class="field-label" for="f-age">Age</label>
        <select class="field" id="f-age">${options(AGES, f.min_age_days)}</select></div>
      <label class="check"><input type="checkbox" id="f-overdue"${f.overdue ? ' checked' : ''}> Overdue only</label>
    </form>`
}

function wireFilters(reload) {
  $('filters').addEventListener('change', () => {
    state.filters = { category: $('f-category').value, ward: $('f-ward').value, min_age_days: $('f-age').value, overdue: $('f-overdue').checked }
    reload()
  })
}

const filterQuery = () => {
  const f = state.filters
  return { category: f.category, ward: f.ward, min_age_days: f.min_age_days, overdue: f.overdue ? '1' : '' }
}

function refreshView() {
  if ($('board')) loadBoard()
  if (cluster) loadMap()
  if ($('report-body') && state.week) loadReport(state.week)
}

/* ---- board ------------------------------------------------------------------------------------ */
async function showBoard() {
  app.innerHTML = `
    <main class="staff-main" id="staff-main">
      <h1 class="visually-hidden">Board</h1>
      ${filtersHtml()}
      <p class="field-error" id="board-error" role="alert"></p>
      <div class="col-tabs" id="col-tabs" aria-label="Show a column"></div>
      <p class="board-hint" id="board-hint" hidden>Scroll the board sideways for more columns.</p>
      <div class="board-scroll" id="board-scroll"><div class="board" id="board"></div></div>
    </main>`
  wireFilters(loadBoard)
  $('board').addEventListener('click', (e) => {
    const card = e.target.closest('[data-id]')
    if (card) openDetail(Number(card.dataset.id))
  })
  $('board').addEventListener('scroll', () => updateBoardHint(), { passive: true })
  $('col-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-col]')
    if (tab) { state.column = tab.dataset.col; renderBoard() }
  })
  await loadCrews()
  if (!staffSession.get()) return
  await loadBoard()
}

async function loadBoard() {
  const seq = ++loadSeq
  try {
    const list = await api.staff.requests(filterQuery())
    if (seq !== loadSeq || !$('board')) return
    state.list = list
    $('board-error').textContent = ''
    renderBoard()
  } catch (e) {
    if (seq === loadSeq && $('board-error')) $('board-error').textContent = e.message
  }
}

function card(r) {
  const meta = [r.plus_ones ? `+${r.plus_ones}` : '', r.crew_name ? esc(r.crew_name) : '', r.has_photo ? 'Photo' : ''].filter(Boolean).join(' · ')
  return `
    <button type="button" class="card-req${r.overdue ? ' overdue' : ''}" data-id="${r.id}" data-ref="${esc(r.ref)}" data-overdue="${r.overdue}"${state.detail?.id === r.id ? ' aria-current="true"' : ''}>
      <span class="card-top"><span class="card-ref">${esc(r.ref)}</span><span class="card-age">${ageText(r.age_days)}</span></span>
      <span class="card-cat"><span class="cat-icon sm">${categoryIcon(r.category)}</span>${esc(r.category_label)}</span>
      <span class="card-street">${esc(r.location_label)}</span>
      ${meta ? `<span class="card-meta" data-meta>${meta}</span>` : ''}
      ${r.overdue ? `<span class="card-overdue">Overdue by ${plural(r.overdue_days, 'day')}</span>` : ''}
    </button>`
}

// With the panel open at desktop width the board scrolls sideways inside itself: say so, and fade its right edge, until the last
// column is in view.
function updateBoardHint() {
  const board = $('board')
  const hint = $('board-hint')
  if (!board || !hint) return
  const more = board.scrollWidth > board.clientWidth + 2 && board.scrollLeft + board.clientWidth < board.scrollWidth - 2
  hint.hidden = !more
  $('board-scroll').dataset.more = String(more)
}

function renderBoard() {
  if (!$('board') || !state.list) return
  const { counts, requests } = state.list
  $('col-tabs').innerHTML = COLUMNS.map(([k, l]) =>
    `<button type="button" class="col-tab" data-col="${k}" aria-pressed="${k === state.column}">${esc(l)} <span data-tab-count="${k}">${counts[k]}</span></button>`).join('')
  $('board').innerHTML = COLUMNS.map(([k, l]) => {
    const cards = requests.filter((r) => r.status === k)
    return `
      <section class="col${k === state.column ? ' active' : ''}" data-col="${k}" aria-label="${esc(l)}">
        <h2>${esc(l)} <span class="count" data-count="${k}">${counts[k]}</span></h2>
        <div class="cards">${cards.map(card).join('') || '<p class="empty-col">Nothing here.</p>'}</div>
      </section>`
  }).join('')
  $('board').dataset.loaded = String(loadSeq)
  app.dataset.view = 'board'
  updateBoardHint()
}

/* ---- map -------------------------------------------------------------------------------------- */
async function showMap() {
  app.innerHTML = `
    <main class="staff-main" id="staff-main">
      <h1 class="view-title">Map</h1>
      ${filtersHtml()}
      <p class="field-error" id="board-error" role="alert"></p>
      <div class="staff-map" id="staff-map" role="application" aria-label="Map of the reports. Tap a group to zoom in, or a pin to open its report."></div>
      <ul class="map-legend" aria-label="What the pin colours mean">
        ${COLUMNS.map(([k, l]) => `<li><span class="req-pin st-${k}" aria-hidden="true"></span>${esc(l)}</li>`).join('')}
        <li><span class="req-pin st-new overdue" aria-hidden="true"></span>Red ring: overdue</li>
      </ul>
      <p class="muted small" id="map-count" aria-live="polite"></p>
    </main>`
  wireFilters(loadMap)
  if (typeof L === 'undefined' || typeof L.markerClusterGroup !== 'function') {
    $('board-error').textContent = 'The map could not be loaded. Reload the page to try again.'
    return
  }
  staffMap = townMap($('staff-map'), state.town)
  // Groups while pins would crowd each other; every pin on its own from zoom 17.
  cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 60, disableClusteringAtZoom: 17, spiderfyOnMaxZoom: false })
  staffMap.addLayer(cluster)
  await loadCrews()
  if (!staffSession.get()) return
  await loadMap()
}

function pinMarker(r) {
  const icon = L.divIcon({
    className: 'req-marker',
    html: `<span class="req-pin st-${esc(r.status)}${r.overdue ? ' overdue' : ''}" data-ref="${esc(r.ref)}" data-id="${r.id}" data-overdue="${r.overdue}"></span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })
  const title = `${r.ref} · ${r.category_label} · ${r.location_label} · ${r.status_label}${r.overdue ? ` · overdue by ${plural(r.overdue_days, 'day')}` : ''}`
  const marker = L.marker([r.lat, r.lng], { icon, title, alt: title, riseOnHover: true })
  marker.on('click', () => openDetail(r.id))
  return marker
}

async function loadMap() {
  const seq = ++loadSeq
  try {
    const list = await api.staff.requests(filterQuery())
    if (seq !== loadSeq || !cluster) return
    state.list = list
    cluster.clearLayers()
    cluster.addLayers(list.requests.map(pinMarker))
    $('board-error').textContent = ''
    $('map-count').textContent = `${plural(list.requests.length, 'report')} on the map.`
    $('staff-map').dataset.loaded = String(seq)
    app.dataset.view = 'map'
  } catch (e) {
    if (seq === loadSeq && $('board-error')) $('board-error').textContent = e.message
  }
}

/* ---- weekly report ------------------------------------------------------------------------------ */
async function showReport() {
  app.innerHTML = `
    <main class="staff-main narrow" id="staff-main">
      <h1 class="view-title">Weekly report</h1>
      <div class="week-picker">
        <button type="button" class="btn-plain" id="week-prev">Previous week</button>
        <p class="week-label" id="week-label" aria-live="polite">Loading…</p>
        <button type="button" class="btn-plain" id="week-next">Next week</button>
      </div>
      <p class="field-error" id="report-error" role="alert"></p>
      <div id="report-body"></div>
      <h2>Export</h2>
      <p class="muted small">Every report except the ones joined into another, one row each. No names, phone numbers, descriptions or notes.</p>
      <button type="button" class="btn btn-secondary csv-btn" id="download-csv">Download CSV</button>
      <p class="field-error" id="csv-error" role="alert"></p>
    </main>`
  $('week-prev').addEventListener('click', () => loadReport(shiftDate(state.week, -7)))
  $('week-next').addEventListener('click', () => loadReport(shiftDate(state.week, 7)))
  $('download-csv').addEventListener('click', downloadCsv)
  $('report-body').addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]')
    if (b) openDetail(Number(b.dataset.id))
  })
  await loadReport(null)
}

async function loadReport(week) {
  const seq = ++loadSeq
  $('report-error').textContent = ''
  try {
    // "This week" is asked for again every time, so Next week is not stuck after NL Monday 00:00 with the page left open.
    const [r, current] = await Promise.all([api.staff.weekly(week || ''), week ? api.staff.weekly('') : null])
    if (seq !== loadSeq || !$('report-body')) return
    state.thisWeek = (current || r).week_start
    state.week = r.week_start
    renderReport(r)
    app.dataset.view = 'report'
  } catch (e) {
    if (seq === loadSeq && $('report-error')) $('report-error').textContent = e.message
  }
}

function renderReport(r) {
  $('week-label').textContent = r.week_label
  $('week-next').disabled = Boolean(state.thisWeek) && r.week_start >= state.thisWeek
  const row = (key, label, v) => `
    <tr data-category="${esc(key)}">
      <th scope="row">${esc(label)}</th>
      <td data-col="opened">${v.opened}</td><td data-col="closed">${v.closed}</td><td data-col="avg">${avgText(v.avg_days_to_close)}</td>
    </tr>`
  const oldest = r.oldest_open.length
    ? `<ol class="oldest" id="oldest">${r.oldest_open.map((s) => `
        <li><button type="button" class="oldest-btn${s.overdue ? ' overdue' : ''}" data-id="${s.id}" data-ref="${esc(s.ref)}">
          <strong>${esc(s.ref)}</strong> · ${esc(s.category_label)} · ${esc(s.location_label)} · ${ageText(s.age_days)}
          ${s.overdue ? `<span class="card-overdue">Overdue by ${plural(s.overdue_days, 'day')}</span>` : ''}
        </button></li>`).join('')}</ol>`
    : '<p class="muted" id="oldest">Nothing is open.</p>'
  $('report-body').innerHTML = `
    <div class="table-wrap">
      <table class="report-table" id="report-table" data-week="${esc(r.week_start)}">
        <caption class="visually-hidden">Reports opened and closed, ${esc(r.week_label)}</caption>
        <thead><tr><th scope="col">Category</th><th scope="col">Opened</th><th scope="col">Closed</th><th scope="col">Average days to close</th></tr></thead>
        <tbody>${r.rows.map((x) => row(x.category, x.label, x)).join('')}</tbody>
        <tfoot>${row('total', 'All categories', r.totals)}</tfoot>
      </table>
    </div>
    <p class="muted small">Joined reports are left out. The average counts only reports closed that week.</p>
    <p class="report-now" id="report-now">Open now: <strong data-now="open">${r.open_now}</strong> · Overdue now: <strong data-now="overdue">${r.overdue_now}</strong></p>
    <h2>Oldest open</h2>
    ${oldest}`
}

// A real fetch with the token, then the file handed to the browser as a download.
async function downloadCsv() {
  const btn = $('download-csv')
  $('csv-error').textContent = ''
  btn.disabled = true
  try {
    const { blob, filename } = await api.staff.exportCsv()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.hidden = true
    document.body.append(a)
    a.click()
    setTimeout(() => { URL.revokeObjectURL(url); a.remove() }, 1000)
  } catch (e) {
    if ($('csv-error')) $('csv-error').textContent = e.message // gone if the session ended and sign-in is showing
  } finally {
    btn.disabled = false
  }
}

/* ---- settings ------------------------------------------------------------------------------------- */
async function showSettings() {
  app.innerHTML = `
    <main class="staff-main narrow" id="staff-main">
      <h1 class="view-title">Settings</h1>
      <p class="field-error" id="settings-load-error" role="alert"></p>
      <div id="settings-body"><p class="loading">Loading…</p></div>
    </main>`
  const seq = ++loadSeq
  try {
    const [settings] = await Promise.all([api.staff.settings(), loadCrews()])
    if (seq !== loadSeq || !$('settings-body')) return
    state.settings = settings
    renderSettings()
    app.dataset.view = 'settings'
  } catch (e) {
    if ($('settings-load-error')) $('settings-load-error').textContent = e.message
  }
}

function textField(name, label, hint, value, type = 'text') {
  return `
    <label class="field-label" for="s-${name}">${esc(label)}</label>
    ${hint ? `<p class="muted small" id="hint-${name}">${esc(hint)}</p>` : ''}
    <input class="field" id="s-${name}" type="${type}"${type === 'tel' ? ' inputmode="tel"' : ''} value="${esc(value)}" aria-describedby="${hint ? `hint-${name} ` : ''}err-${name}">
    <p class="field-error" id="err-${name}" role="alert"></p>`
}

function crewsHtml() {
  return state.crews.map((c) => `
    <li class="crew-row" data-crew-id="${c.id}" data-active="${c.active}">
      <label class="visually-hidden" for="crew-name-${c.id}">Crew name</label>
      <input class="field" id="crew-name-${c.id}" value="${esc(c.name)}" autocomplete="off">
      <span class="crew-state">${c.active ? `Working · ${plural(c.open_count, 'open report')}` : 'Not working (hidden from the crew list)'}</span>
      <div class="crew-actions">
        <button type="button" class="btn btn-secondary" data-crew-rename="${c.id}">Rename</button>
        <button type="button" class="btn btn-secondary" data-crew-toggle="${c.id}">${c.active ? 'Deactivate' : 'Reactivate'}</button>
      </div>
      <p class="field-error" id="err-crew-${c.id}" role="alert"></p>
    </li>`).join('')
}

function renderSettings() {
  const s = state.settings
  $('settings-body').innerHTML = `
    <section class="card settings-card">
      <h2>Phones and office hours</h2>
      <form id="settings-form" novalidate>
        ${textField('emergency_phone', 'Emergency phone', 'Residents see it in the red banner on the report page.', s.emergency_phone, 'tel')}
        ${textField('office_phone', 'Office phone', 'Shown on every status page.', s.office_phone, 'tel')}
        ${textField('office_hours', 'Office hours', '', s.office_hours)}
        <h3>Days to fix each kind of problem</h3>
        <p class="muted small" id="sla-hint">A report is overdue once it has been open longer than this. Leave a box blank for no target.</p>
        <div class="sla-grid">${state.town.categories.map((c) => `
          <div class="sla-row">
            <label class="field-label" for="sla-${c.key}">${esc(c.label)}</label>
            <div class="sla-input"><input class="field" id="sla-${c.key}" inputmode="numeric" autocomplete="off" value="${s.sla_days[c.key] ?? ''}" aria-describedby="sla-hint err-sla-${c.key}"><span class="muted">days</span></div>
            <p class="field-error" id="err-sla-${c.key}" role="alert"></p>
          </div>`).join('')}
        </div>
        <p class="field-error" id="settings-error" role="alert"></p>
        <div class="actions"><button type="submit" class="btn btn-primary" id="settings-save">Save settings</button></div>
        <p class="ok" id="settings-ok" role="status"></p>
      </form>
    </section>
    <section class="card settings-card">
      <h2>Crews</h2>
      <ul class="crew-list" id="crew-list" data-rendered="0">${crewsHtml()}</ul>
      <label class="field-label" for="crew-new">Add a crew</label>
      <div class="row-inline"><input class="field" id="crew-new" autocomplete="off"><button type="button" class="btn btn-secondary" id="crew-add">Add crew</button></div>
      <p class="field-error" id="err-crew-new" role="alert"></p>
    </section>
    <section class="card settings-card">
      <h2>Change the PIN</h2>
      <form id="pin-form" novalidate>
        <label class="field-label" for="pin-current">Current PIN</label>
        <input class="field" id="pin-current" type="password" inputmode="numeric" autocomplete="current-password" maxlength="8" aria-describedby="err-current_pin">
        <p class="field-error" id="err-current_pin" role="alert"></p>
        <label class="field-label" for="pin-new">New PIN (4 to 8 digits)</label>
        <input class="field" id="pin-new" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8" aria-describedby="err-new_pin">
        <p class="field-error" id="err-new_pin" role="alert"></p>
        <p class="field-error" id="pin-error" role="alert"></p>
        <div class="actions"><button type="submit" class="btn btn-secondary" id="pin-save">Change PIN</button></div>
        <p class="ok" id="pin-ok" role="status"></p>
      </form>
    </section>`
}

async function saveSettings() {
  for (const el of document.querySelectorAll('#settings-form .field-error')) el.textContent = ''
  $('settings-ok').textContent = ''
  // Blank = no target; whole numbers go as numbers; anything else goes as typed so the API names it.
  const sla = Object.fromEntries(state.town.categories.map((c) => {
    const v = $(`sla-${c.key}`).value.trim()
    return [c.key, v === '' ? null : /^\d+$/.test(v) ? Number(v) : v]
  }))
  const body = { emergency_phone: $('s-emergency_phone').value, office_phone: $('s-office_phone').value, office_hours: $('s-office_hours').value, sla_days: sla }
  const btn = $('settings-save')
  btn.disabled = true
  try {
    state.settings = await api.staff.saveSettings(body)
    $('settings-ok').textContent = 'Saved.'
  } catch (e) {
    const target = e.field?.startsWith('sla_days.') ? $(`err-sla-${e.field.slice(9)}`) : e.field ? $(`err-${e.field}`) : null
    const box = target || $('settings-error')
    if (box) box.textContent = e.message // gone if the session ended and sign-in is showing
  } finally {
    btn.disabled = false
  }
}

async function crewChange(id, run) {
  const err = id ? $(`err-crew-${id}`) : $('err-crew-new')
  err.textContent = ''
  try {
    await run()
    await loadCrews()
    const list = $('crew-list')
    if (!list) return
    list.innerHTML = crewsHtml()
    // Counts re-draws, so a reader (a test) can tell the list it holds is the one after this change.
    list.dataset.rendered = String(Number(list.dataset.rendered || 0) + 1)
    if (!id) $('crew-new').value = ''
  } catch (e) {
    if ($('crew-list')) err.textContent = e.message // gone if the session ended and sign-in is showing
  }
}

async function changePin() {
  for (const id of ['err-current_pin', 'err-new_pin', 'pin-error']) $(id).textContent = ''
  $('pin-ok').textContent = ''
  const btn = $('pin-save')
  btn.disabled = true
  try {
    await api.staff.changePin({ current_pin: $('pin-current').value, new_pin: $('pin-new').value })
    $('pin-current').value = ''
    $('pin-new').value = ''
    $('pin-ok').textContent = 'PIN changed. Use the new PIN next time you sign in.'
  } catch (e) {
    // A wrong current PIN is a 401 WITH field current_pin: a form error, not a lost session (API.md clarification 17).
    const target = e.field === 'current_pin' || e.field === 'new_pin' ? $(`err-${e.field}`) : $('pin-error')
    if (target) target.textContent = e.message // gone if the session ended and sign-in is showing
  } finally {
    btn.disabled = false
  }
}

app.addEventListener('submit', (e) => {
  if (e.target.id === 'settings-form') { e.preventDefault(); saveSettings() }
  if (e.target.id === 'pin-form') { e.preventDefault(); changePin() }
})
app.addEventListener('click', (e) => {
  const t = e.target.closest('button')
  if (!t) return
  if (t.id === 'crew-add') return crewChange(null, () => api.staff.addCrew($('crew-new').value))
  const rename = t.dataset.crewRename
  if (rename) {
    const crew = state.crews.find((c) => c.id === Number(rename))
    return crewChange(crew.id, () => api.staff.updateCrew(crew.id, { name: $(`crew-name-${crew.id}`).value, active: crew.active }))
  }
  const toggle = t.dataset.crewToggle
  if (toggle) {
    const crew = state.crews.find((c) => c.id === Number(toggle))
    // The name as typed in the box, so a new name typed without pressing Rename is not thrown away.
    return crewChange(crew.id, () => api.staff.updateCrew(crew.id, { name: $(`crew-name-${crew.id}`).value, active: !crew.active }))
  }
})

/* ---- detail --------------------------------------------------------------------------------------- */
async function openDetail(id, notice = '') {
  try {
    // Crews come fresh with every report, so one deactivated from another session is not offered.
    const [d] = await Promise.all([api.staff.request(id), loadCrews()])
    if (!staffSession.get()) return
    state.join = null
    state.detail = d
    renderDetail(notice)
  } catch (e) {
    const where = state.detail ? $('save-error') || $('join-error') : $('board-error') || $('report-error')
    if (where) where.textContent = e.message
  }
}

function closeDetail(render = true) {
  if (detailMap) { detailMap.remove(); detailMap = null }
  state.detail = null
  state.join = null
  panel.hidden = true
  panel.innerHTML = ''
  $('staff-main')?.classList.remove('with-detail')
  if (render) renderBoard()
  updateBoardHint()
}

function historyHtml(d) {
  return d.history.map((h) => `<li${h.internal ? ' class="internal"' : ''}><span class="when">${esc(h.at_label)}</span>${esc(h.text)}${h.internal ? ' <span class="staff-only">Staff only</span>' : ''}</li>`).join('')
}

function renderDetail(notice = '') {
  const d = state.detail
  if (detailMap) { detailMap.remove(); detailMap = null }
  const merged = d.status === 'merged'
  // What the form is drawn from. Save compares against this and sends its version, whatever newer answer arrives later.
  state.form = { version: d.version, status: d.status, crew_id: d.crew_id, public_message: d.public_message || '' }
  const crews = state.crews.filter((c) => c.active || c.id === d.crew_id)
  const crewOptions = options([['', 'No crew'], ...crews.map((c) => [c.id, c.active ? c.name : `${c.name} (not active)`])], d.crew_id ?? '')
  const contact = d.reporter_name || d.reporter_phone
    ? `<p id="d-contact">${d.reporter_name ? esc(d.reporter_name) : 'No name given'}${d.reporter_phone ? ` · <a href="${esc(telHref(d.reporter_phone))}">${esc(d.reporter_phone)}</a>` : ''}</p>`
    : '<p class="muted" id="d-contact">No name or phone given.</p>'
  const photo = d.photo_url
    ? `<img class="detail-photo" id="detail-photo" src="${esc(d.photo_url)}" alt="Photo from the resident">`
    : d.photo === 'waiting' ? '<p class="muted small">The resident has a photo for this, but it has not arrived.</p>' : ''
  const mergedList = d.merged.length ? `
    <h3>Joined into this report</h3>
    <ul class="merged-list" id="d-merged">${d.merged.map((m) => `
      <li data-ref="${esc(m.ref)}"><strong>${esc(m.ref)}</strong> · ${esc(m.created_label)}${m.plus_ones ? ` · +${m.plus_ones}` : ''}
        ${m.description ? `<br>${esc(m.description)}` : ''}
        ${m.reporter_name || m.reporter_phone ? `<br>${esc(m.reporter_name || 'No name given')}${m.reporter_phone ? ` · <a href="${esc(telHref(m.reporter_phone))}">${esc(m.reporter_phone)}</a>` : ''}` : ''}
        ${m.photo_url ? `<br><a href="${esc(m.photo_url)}" target="_blank" rel="noopener">Its photo</a>` : ''}
      </li>`).join('')}
    </ul>` : ''
  const form = merged ? '' : `
    <h3>Status and crew</h3>
    <form id="save-form" novalidate>
      <label class="field-label" for="d-status">Status</label>
      <select class="field" id="d-status">${options(COLUMNS, d.status)}</select>
      <p class="field-error" id="err-status" role="alert"></p>
      <label class="field-label" for="d-crew">Crew</label>
      <select class="field" id="d-crew">${crewOptions}</select>
      <p class="field-error" id="err-crew_id" role="alert"></p>
      <label class="field-label" for="d-message">Message to the public</label>
      <p class="muted small" id="d-message-hint">Shows on the resident's status link. Leave it empty for none.</p>
      <textarea class="field" id="d-message" rows="3" aria-describedby="d-message-hint err-public_message">${esc(d.public_message || '')}</textarea>
      <p class="field-error" id="err-public_message" role="alert"></p>
      <p class="field-error" id="save-error" role="alert"></p>
      <div id="stale-slot"></div>
      <div class="actions"><button type="submit" class="btn btn-primary" id="save">Save</button></div>
      <p class="ok" id="save-ok" role="status">${esc(notice === 'saved' ? 'Saved.' : '')}</p>
    </form>`
  panel.innerHTML = `
    <div class="detail-in" data-id="${d.id}" data-version="${d.version}">
      <div class="detail-head">
        <h2 id="detail-ref" tabindex="-1">${esc(d.ref)}</h2>
        ${chip(d.status, d.status_label)}
        <button type="button" class="back" id="detail-close">Close</button>
      </div>
      ${notice && notice !== 'saved' ? `<p class="ok" id="detail-notice" role="status">${esc(notice)}</p>` : ''}
      <p class="detail-what"><span class="cat-icon sm">${categoryIcon(d.category)}</span>${esc(d.category_label)} · ${esc(d.location_label)}${d.ward_name ? ` · ${esc(d.ward_name)}` : ''}</p>
      <p class="muted small">Reported ${esc(d.created_label)} · ${ageText(d.age_days)}${d.closed_label ? ` · Closed ${esc(d.closed_label)}` : ''}</p>
      ${['new', 'assigned', 'in_progress'].includes(d.status) && d.due_label ? `<p class="small" id="d-due">Due ${esc(d.due_label)}</p>` : ''}
      ${d.overdue ? `<p class="card-overdue" id="d-overdue">Overdue by ${plural(d.overdue_days, 'day')}</p>` : ''}
      <p id="detail-plus"${d.plus_ones ? '' : ' hidden'}>${others(d.plus_ones)}</p>
      ${merged ? `<p class="merged-box" id="d-merged-into">This report was joined with <button type="button" class="link-btn" data-open="${d.merged_into.id}">${esc(d.merged_into.ref)}</button>. Change that one instead.</p>` : ''}
      ${photo}
      <h3>What the resident said</h3>
      <p id="d-description">${d.description ? esc(d.description) : '<span class="muted">No description.</span>'}</p>
      ${contact}
      <div class="detail-map" id="detail-map" aria-label="Where the pin is"></div>
      ${form}
      <h3>Update for the resident</h3>
      <p class="muted small">Nothing is sent from here. Copy this into a text or an email yourself.</p>
      <label class="visually-hidden" for="copy-text">Update text</label>
      <textarea class="field copy-text" id="copy-text" readonly rows="4">${esc(d.copy_update)}</textarea>
      <button type="button" class="btn btn-secondary" id="copy-update">Copy update text</button>
      <h3>Status link</h3>
      <div class="row-inline">
        <input class="field link-field" id="d-status-link" readonly value="${esc(d.status_url)}" aria-label="Status link">
        <button type="button" class="btn btn-secondary" id="copy-link">Copy</button>
      </div>
      <p><a href="${esc(d.status_url)}" target="_blank" rel="noopener" id="d-open-status">Open the status page</a></p>
      <h3>Notes</h3>
      <p><span class="notes-label">Only town staff see notes</span></p>
      <label class="visually-hidden" for="note-text">Note</label>
      <textarea class="field" id="note-text" rows="2"></textarea>
      <p class="field-error" id="err-text" role="alert"></p>
      <button type="button" class="btn btn-secondary" id="add-note">Add note</button>
      <h3>History</h3>
      <ol class="history" id="d-history">${historyHtml(d)}</ol>
      ${mergedList}
      ${merged ? '' : '<div id="join-slot"></div>'}
    </div>`
  panel.hidden = false
  panel.scrollTop = 0
  $('staff-main')?.classList.add('with-detail')
  renderJoin()
  renderBoard()
  $('detail-ref').focus({ preventScroll: true })
  if (typeof L !== 'undefined') {
    detailMap = townMap($('detail-map'), state.town)
    detailMap.setView([d.lat, d.lng], 16, { animate: false })
    L.marker([d.lat, d.lng], { icon: pinIcon(), keyboard: false, interactive: false }).addTo(detailMap)
  }
}

async function save() {
  const d = state.detail
  for (const f of SAVE_FIELDS) $(`err-${f}`).textContent = ''
  $('save-error').textContent = ''
  $('save-ok').textContent = ''
  $('stale-slot').innerHTML = ''
  // Only what changed goes in the body, so "set a crew on a New report" moves it to Assigned as API.md says. The version and "what
  // changed" both come from what the form was drawn from, never from a newer answer (a note's): otherwise a Save could silently undo
  // someone else's change instead of meeting the Worker's stale check (DECISIONS 19).
  const f = state.form
  const body = { version: f.version }
  const status = $('d-status').value
  if (status !== f.status) body.status = status
  const crew = $('d-crew').value === '' ? null : Number($('d-crew').value)
  if (crew !== f.crew_id) body.crew_id = crew
  const message = $('d-message').value
  if (message.trim() !== f.public_message) body.public_message = message
  const btn = $('save')
  btn.disabled = true
  btn.textContent = 'Saving…'
  try {
    state.detail = await api.staff.save(d.id, body)
    renderDetail('saved')
    refreshView()
  } catch (e) {
    if (!$('save-form')) return // the session ended: the sign-in screen has replaced the panel
    if (e.code === 'stale' && e.body.request) {
      $('stale-slot').innerHTML = `<div class="stale-box" id="stale" role="alert"><span>${esc(e.message)}</span><button type="button" class="btn btn-secondary" id="stale-reload">Reload</button></div>`
      state.stale = e.body.request
    } else if (SAVE_FIELDS.includes(e.field)) {
      $(`err-${e.field}`).textContent = e.message
    } else {
      $('save-error').textContent = e.message
    }
  } finally {
    if ($('save')) { $('save').disabled = false; $('save').textContent = 'Save' }
  }
}

async function addNote() {
  const d = state.detail
  const btn = $('add-note')
  $('err-text').textContent = ''
  btn.disabled = true
  try {
    state.detail = await api.staff.note(d.id, $('note-text').value)
    // Notes never change the version: update the history and leave any unsaved form edits alone.
    $('d-history').innerHTML = historyHtml(state.detail)
    $('copy-text').value = state.detail.copy_update
    $('note-text').value = ''
  } catch (e) {
    if ($('err-text')) $('err-text').textContent = e.message
  } finally {
    btn.disabled = false
  }
}

/* ---- join with another report --------------------------------------------------------------------- */
function joinCandidatesHtml(j) {
  if (j.candidates === null) return '<p class="muted">Looking for likely duplicates…</p>'
  if (!j.candidates.length) return '<p class="muted" id="join-none">No open reports of the same kind within 200 m.</p>'
  return `<p>Likely the same problem:</p><ul class="join-list" id="join-candidates">${j.candidates.map((c) => `
    <li><button type="button" class="join-cand" data-cand="${c.id}"><strong>${esc(c.ref)}</strong> · ${esc(c.category_label)} · ${esc(c.location_label)} · about ${c.distance_m} m · ${esc(c.status_label)}${c.plus_ones ? ` · +${c.plus_ones}` : ''}</button></li>`).join('')}</ul>`
}

function joinConfirmHtml(d, t) {
  if (!t) return ''
  return `
    <div class="confirm-box" id="join-confirm" role="alert">
      <p>Join <strong>${esc(d.ref)}</strong> into <strong>${esc(t.ref)}</strong> (${esc(t.category_label)}, ${esc(t.location_label)})? ${esc(d.ref)} closes, and its +1s move to ${esc(t.ref)}.</p>
      <p class="field-error" id="join-confirm-error" role="alert"></p>
      <div class="btn-row"><button type="button" class="btn btn-primary" id="join-yes">Join them</button><button type="button" class="btn btn-secondary" id="join-cancel">Cancel</button></div>
    </div>`
}

// The join area is drawn once; after that only its parts change (the likely duplicates arriving, an error, the confirm), so the
// reference box is never replaced while someone is typing in it.
function renderJoin() {
  const slot = $('join-slot')
  if (!slot) return
  const d = state.detail
  const j = state.join
  if (j && $('join')) {
    $('join-cands').innerHTML = joinCandidatesHtml(j)
    $('join-error').textContent = j.error || ''
    $('join-confirm-slot').innerHTML = joinConfirmHtml(d, j.target)
    return
  }
  const inner = j ? `
      <div id="join">
        <div id="join-cands">${joinCandidatesHtml(j)}</div>
        <label class="field-label" for="join-ref">Or type a reference</label>
        <div class="row-inline">
          <input class="field" id="join-ref" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="HP-1003" value="${esc(j.typed || '')}">
          <button type="button" class="btn btn-secondary" id="join-find">Find</button>
        </div>
        <p class="field-error" id="join-error" role="alert">${esc(j.error || '')}</p>
        <div id="join-confirm-slot">${joinConfirmHtml(d, j.target)}</div>
      </div>`
    : '<button type="button" class="btn btn-secondary" id="join-open">Join with another report</button>'
  slot.innerHTML = `
    <h3>Join with another report</h3>
    <p class="muted small">If this is the same problem as another report, join it into that one. This one closes and its +1s move over.</p>
    ${inner}`
}

async function openJoin() {
  const id = state.detail.id
  state.join = { candidates: null, target: null, typed: '', error: '' }
  renderJoin()
  try {
    const r = await api.staff.candidates(id)
    if (state.detail?.id !== id || !state.join) return
    state.join.candidates = r.requests
  } catch (e) {
    if (!state.join) return
    state.join.candidates = []
    state.join.error = e.message
  }
  renderJoin()
}

async function findTyped() {
  const j = state.join
  j.typed = $('join-ref').value
  j.error = ''
  j.target = null
  const m = /^\s*(?:HP\s*-?\s*)?(\d{1,15})\s*$/i.exec(j.typed)
  if (!m) { j.error = 'Type a reference like HP-1003.'; return renderJoin() }
  const id = Number(m[1])
  if (id === state.detail.id) { j.error = 'Pick a different report to join it with.'; return renderJoin() }
  try {
    const t = await api.staff.request(id)
    // A report that was itself joined can't keep another one: say so now, with no Join button (the Worker would answer 409).
    if (t.status === 'merged' && t.merged_into) j.error = `${t.ref} was itself joined with ${t.merged_into.ref}. Join with ${t.merged_into.ref} instead.`
    else j.target = t
  } catch (e) {
    if (!$('join-slot')) return
    j.error = e.message
  }
  renderJoin()
  $('join-confirm')?.scrollIntoView({ block: 'nearest' })
}

async function confirmJoin() {
  const d = state.detail
  const target = state.join.target
  const btn = $('join-yes')
  btn.disabled = true
  try {
    const r = await api.staff.merge(d.id, target.id)
    state.detail = r.request
    state.join = null
    renderDetail(`Joined ${d.ref} into this report.`)
    refreshView()
  } catch (e) {
    if (!$('join-confirm-error')) return
    $('join-confirm-error').textContent = e.message
    btn.disabled = false
  }
}

/* ---- detail events (delegated: the panel is re-rendered) ------------------------------------------ */
panel.addEventListener('submit', (e) => {
  if (e.target.id === 'save-form') { e.preventDefault(); save() }
})
panel.addEventListener('input', (e) => {
  if (e.target.id === 'join-ref' && state.join) state.join.typed = e.target.value
})
panel.addEventListener('click', (e) => {
  const t = e.target
  const id = t.closest('button')?.id
  if (id === 'detail-close') return closeDetail()
  if (id === 'stale-reload') { state.detail = state.stale; state.stale = null; renderDetail(); return refreshView() }
  if (id === 'copy-update') return copyText($('copy-text'), $('copy-update'))
  if (id === 'copy-link') return copyText($('d-status-link'), $('copy-link'))
  if (id === 'add-note') return addNote()
  if (id === 'join-open') return openJoin()
  if (id === 'join-find') return findTyped()
  if (id === 'join-yes') return confirmJoin()
  if (id === 'join-cancel') { state.join.target = null; return renderJoin() }
  const cand = t.closest('[data-cand]')
  if (cand) {
    state.join.target = state.join.candidates.find((c) => c.id === Number(cand.dataset.cand))
    state.join.error = ''
    renderJoin()
    $('join-confirm')?.scrollIntoView({ block: 'nearest' })
    return
  }
  const open = t.closest('[data-open]')
  if (open) openDetail(Number(open.dataset.open))
})

start()
