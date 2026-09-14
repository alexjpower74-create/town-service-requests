// Public status page /s/?k=<status key>: one card. Shows only what GET /api/status answers (reference, category, street,
// status, public message, dates, +1 count, public history, the office phone). No map, no photo, no reporter details.
// Checks again when the page comes back into view. A 404 shows the API's own plain message and stops checking.
import { api } from '/api.js'
import { esc, brandBar, telHref, chip, STATUS_SENTENCE, plural } from '/ui.js'

const NOT_FOUND = "We can't find that report. Check the link, or call the town office."
const key = new URLSearchParams(location.search).get('k') || ''
const app = document.getElementById('app')
const brand = document.getElementById('brand')
let stopped = false

function render(r) {
  brand.innerHTML = brandBar(r.town)
  document.title = `Report ${r.ref} · ${r.town.name}`
  const merged = r.merged_into
    ? `<div class="merged-box" data-merged>This report was joined with <a href="${esc(r.merged_into.status_url)}">${esc(r.merged_into.ref)}</a>. Follow that one to see what the town is doing.</div>`
    : ''
  const sentence = r.status === 'merged' ? '' : `<p class="status-sentence" id="status-sentence">${esc(STATUS_SENTENCE[r.status] || '')}</p>`
  const message = r.public_message
    ? `<blockquote class="msg-box" id="public-message"><p class="msg-from">Message from the town</p><p>${esc(r.public_message)}</p></blockquote>`
    : ''
  const others = r.plus_ones ? `<p id="plus-ones">+${plural(r.plus_ones, 'other')} reported this</p>` : ''
  const dates = [
    `<li>Reported ${esc(r.reported_label)}</li>`,
    r.updated_label && r.updated_at !== r.reported_at ? `<li>Last update ${esc(r.updated_label)}</li>` : '',
    r.closed_label ? `<li>Closed ${esc(r.closed_label)}</li>` : '',
  ].join('')
  const history = (r.history || []).map((h) => `<li><span class="when">${esc(h.at_label)}</span>${esc(h.text)}</li>`).join('')
  const office = r.town.office_phone
    ? `<p class="office">Questions? Call the town office at <a href="${esc(telHref(r.town.office_phone))}">${esc(r.town.office_phone)}</a>.</p>`
    : ''
  app.innerHTML = `
    <article class="card" id="status-card" data-status="${esc(r.status)}">
      <h1 class="status-ref" id="status-ref" tabindex="-1">Report ${esc(r.ref)}</h1>
      <p class="status-what" id="status-what">${esc(r.category_label)} · ${esc(r.location_label)}</p>
      <div>${chip(r.status, r.status_label, 'chip-big')}</div>
      ${sentence}
      ${merged}
      ${message}
      ${others}
      <ul class="dates">${dates}</ul>
      <h2>What has happened</h2>
      <ol class="history" id="history">${history}</ol>
      ${office}
      <p class="muted small">This page is the town's answer. Nothing is texted or emailed.</p>
    </article>`
}

async function renderNotFound(message) {
  let town = null
  try { town = await api.town() } catch {}
  brand.innerHTML = brandBar(town)
  const office = town?.office_phone
    ? `<p class="office">Call the town office at <a href="${esc(telHref(town.office_phone))}">${esc(town.office_phone)}</a>.</p>`
    : ''
  app.innerHTML = `
    <article class="card" id="status-card" data-status="not-found">
      <h1 class="status-ref" tabindex="-1">Report status</h1>
      <p class="status-sentence" id="not-found" role="alert">${esc(message)}</p>
      ${office}
    </article>`
}

async function check() {
  if (stopped) return
  if (!key) {
    stopped = true
    return renderNotFound(NOT_FOUND)
  }
  try {
    render(await api.status(key))
  } catch (e) {
    if (e.status === 404) {
      stopped = true
      return renderNotFound(e.message)
    }
    if (!document.getElementById('status-card')) {
      app.innerHTML = `<article class="card"><p class="status-sentence" role="alert">${esc(e.message)}</p></article>`
    }
  }
}

check()
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check() })
