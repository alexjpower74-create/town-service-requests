// Town office app /staff/ (PIN): sign-in, the board (five columns with counts, filters, cards with overdue), and a report's
// detail (photo, description, contact, small map, status / crew / public message with Save, the stale path, copy update text,
// status link, internal notes, history, reports joined into it, and "Join with another report" by candidate or typed reference).
// Only the M1 staff routes of docs/API.md. Errors show the API's own text next to the field it names. Nothing is sent to anyone.
import { api, staffSession, SIGNED_OUT } from '/api.js'
import { esc, brandBar, chip, categoryIcon, telHref, plural } from '/ui.js'
import { townMap, pinIcon } from '/map.js'

const COLUMNS = [['new', 'New'], ['assigned', 'Assigned'], ['in_progress', 'In progress'], ['done', 'Done'], ['wont_fix', "Won't fix"]]
const AGES = [['', 'Any age'], ['3', 'Older than 3 days'], ['7', 'Older than 7 days'], ['30', 'Older than 30 days']]
const SAVE_FIELDS = ['status', 'crew_id', 'public_message']

const $ = (id) => document.getElementById(id)
const app = $('app')
const panel = $('detail')
const state = {
  town: null, crews: [], list: null, column: 'new', detail: null, join: null,
  filters: { category: '', ward: '', min_age_days: '', overdue: false },
}
let detailMap = null
let boardSeq = 0

const ageText = (n) => (n === 0 ? 'Today' : plural(n, 'day'))
const others = (n) => `+${n} ${n === 1 ? 'other' : 'others'} reported this`
const options = (list, value) => list.map(([k, l]) => `<option value="${esc(k)}"${String(k) === String(value) ? ' selected' : ''}>${esc(l)}</option>`).join('')

async function copyText(input, button, done = 'Copied') {
  try {
    await navigator.clipboard.writeText(input.value)
  } catch {
    input.select()
    try { document.execCommand('copy') } catch {}
  }
  button.textContent = done
}

/* ---- start and sign-in ------------------------------------------------------------ */
window.addEventListener(SIGNED_OUT, (e) => showSignin(e.detail || 'Sign in again.'))

async function start() {
  try {
    state.town = await api.town()
  } catch (e) {
    app.innerHTML = `<main class="signin-wrap"><p class="field-error" role="alert">${esc(e.message)}</p></main>`
    return
  }
  $('brand').innerHTML = brandBar(state.town)
  document.title = `Town office · ${state.town.name}`
  if (staffSession.get()) showBoard()
  else showSignin()
}

function showSignin(message = '') {
  closeDetail(false)
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
  $('signin-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const btn = $('signin-btn')
    btn.disabled = true
    $('pin-error').textContent = ''
    try {
      const r = await api.staff.signin($('pin').value)
      staffSession.set(r.token)
      showBoard()
    } catch (err) {
      // Wrong PIN (401), too many tries (429) or no signal: the API's own words.
      $('pin-error').textContent = err.message
      btn.disabled = false
    }
  })
}

$('signout').addEventListener('click', async () => {
  try { await api.staff.signout() } catch {}
  staffSession.clear()
  showSignin()
})

/* ---- board -------------------------------------------------------------------------- */
async function showBoard() {
  $('nav').hidden = false
  const t = state.town
  const f = state.filters
  app.innerHTML = `
    <main class="staff-main" id="staff-main">
      <h1 class="visually-hidden">Board</h1>
      <form class="filters" id="filters" novalidate>
        <div><label class="field-label" for="f-category">Category</label>
          <select class="field" id="f-category">${options([['', 'All categories'], ...t.categories.map((c) => [c.key, c.label])], f.category)}</select></div>
        <div><label class="field-label" for="f-ward">Ward</label>
          <select class="field" id="f-ward">${options([['', 'All wards'], ...t.wards.map((w) => [w.id, w.name])], f.ward)}</select></div>
        <div><label class="field-label" for="f-age">Age</label>
          <select class="field" id="f-age">${options(AGES, f.min_age_days)}</select></div>
        <label class="check"><input type="checkbox" id="f-overdue"${f.overdue ? ' checked' : ''}> Overdue only</label>
      </form>
      <p class="field-error" id="board-error" role="alert"></p>
      <div class="col-tabs" id="col-tabs" aria-label="Show a column"></div>
      <div class="board" id="board"></div>
    </main>`
  $('filters').addEventListener('change', () => {
    state.filters = { category: $('f-category').value, ward: $('f-ward').value, min_age_days: $('f-age').value, overdue: $('f-overdue').checked }
    loadBoard()
  })
  $('board').addEventListener('click', (e) => {
    const card = e.target.closest('[data-id]')
    if (card) openDetail(Number(card.dataset.id))
  })
  $('col-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-col]')
    if (tab) { state.column = tab.dataset.col; renderBoard() }
  })
  try { state.crews = (await api.staff.crews()).crews } catch { if (!staffSession.get()) return }
  await loadBoard()
}

async function loadBoard() {
  const seq = ++boardSeq
  const f = state.filters
  try {
    const list = await api.staff.requests({ category: f.category, ward: f.ward, min_age_days: f.min_age_days, overdue: f.overdue ? '1' : '' })
    if (seq !== boardSeq) return
    state.list = list
    if ($('board-error')) $('board-error').textContent = ''
    renderBoard()
  } catch (e) {
    if (seq === boardSeq && $('board-error')) $('board-error').textContent = e.message
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
  $('board').dataset.loaded = String(boardSeq)
}

/* ---- detail --------------------------------------------------------------------------- */
async function openDetail(id, notice = '') {
  try {
    const d = await api.staff.request(id)
    state.join = null
    state.detail = d
    renderDetail(notice)
  } catch (e) {
    const where = state.detail ? $('save-error') || $('join-error') : $('board-error')
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
}

function historyHtml(d) {
  return d.history.map((h) => `<li${h.internal ? ' class="internal"' : ''}><span class="when">${esc(h.at_label)}</span>${esc(h.text)}${h.internal ? ' <span class="staff-only">Staff only</span>' : ''}</li>`).join('')
}

function renderDetail(notice = '') {
  const d = state.detail
  if (detailMap) { detailMap.remove(); detailMap = null }
  const merged = d.status === 'merged'
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
  // Only what changed goes in the body, so "set a crew on a New report" moves it to Assigned as API.md says.
  const body = { version: d.version }
  const status = $('d-status').value
  if (status !== d.status) body.status = status
  const crew = $('d-crew').value === '' ? null : Number($('d-crew').value)
  if (crew !== d.crew_id) body.crew_id = crew
  const message = $('d-message').value
  if (message.trim() !== (d.public_message || '')) body.public_message = message
  const btn = $('save')
  btn.disabled = true
  btn.textContent = 'Saving…'
  try {
    state.detail = await api.staff.save(d.id, body)
    renderDetail('saved')
    loadBoard()
  } catch (e) {
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
    $('err-text').textContent = e.message
  } finally {
    btn.disabled = false
  }
}

/* ---- join with another report --------------------------------------------------------------- */
function renderJoin() {
  const slot = $('join-slot')
  if (!slot) return
  const d = state.detail
  const j = state.join
  let inner = '<button type="button" class="btn btn-secondary" id="join-open">Join with another report</button>'
  if (j) {
    const list = j.candidates === null
      ? '<p class="muted">Looking for likely duplicates…</p>'
      : j.candidates.length
        ? `<p>Likely the same problem:</p><ul class="join-list" id="join-candidates">${j.candidates.map((c) => `
            <li><button type="button" class="join-cand" data-cand="${c.id}"><strong>${esc(c.ref)}</strong> · ${esc(c.category_label)} · ${esc(c.location_label)} · about ${c.distance_m} m · ${esc(c.status_label)}${c.plus_ones ? ` · +${c.plus_ones}` : ''}</button></li>`).join('')}</ul>`
        : '<p class="muted" id="join-none">No open reports of the same kind within 200 m.</p>'
    const t = j.target
    const confirm = t ? `
      <div class="confirm-box" id="join-confirm" role="alert">
        <p>Join <strong>${esc(d.ref)}</strong> into <strong>${esc(t.ref)}</strong> (${esc(t.category_label)}, ${esc(t.location_label)})? ${esc(d.ref)} closes, and its +1s move to ${esc(t.ref)}.</p>
        <p class="field-error" id="join-confirm-error" role="alert"></p>
        <div class="btn-row"><button type="button" class="btn btn-primary" id="join-yes">Join them</button><button type="button" class="btn btn-secondary" id="join-cancel">Cancel</button></div>
      </div>` : ''
    inner = `
      <div id="join">
        ${list}
        <label class="field-label" for="join-ref">Or type a reference</label>
        <div class="row-inline">
          <input class="field" id="join-ref" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="HP-1003" value="${esc(j.typed || '')}">
          <button type="button" class="btn btn-secondary" id="join-find">Find</button>
        </div>
        <p class="field-error" id="join-error" role="alert">${esc(j.error || '')}</p>
        ${confirm}
      </div>`
  }
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
    j.target = await api.staff.request(id)
  } catch (e) {
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
    loadBoard()
  } catch (e) {
    $('join-confirm-error').textContent = e.message
    btn.disabled = false
  }
}

/* ---- detail events (delegated: the panel is re-rendered) ---------------------------------------- */
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
  if (id === 'stale-reload') { state.detail = state.stale; state.stale = null; return renderDetail() }
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
