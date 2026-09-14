// NL time labels. docs/API.md shows labels as "Mon Sep 7" and "Mon Sep 7, 10:45 AM". Intl's own en-US output is
// "Mon, Sep 7" and uses a narrow no-break space before AM on newer ICU, so the label is assembled from formatToParts
// to give exactly the contract's text on every runtime.

export const TIME_ZONE = 'America/St_Johns'

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
})

function parts (ms) {
  const p = {}
  for (const { type, value } of fmt.formatToParts(new Date(ms))) p[type] = value
  return p
}

const toMs = at => (typeof at === 'number' ? at : Date.parse(at))

/** "Mon Sep 7" in NL time; null for null. */
export function dateLabel (at) {
  if (at === null || at === undefined) return null
  const p = parts(toMs(at))
  return `${p.weekday} ${p.month} ${p.day}`
}

/** "Mon Sep 7, 10:45 AM" in NL time; null for null. */
export function fullLabel (at) {
  if (at === null || at === undefined) return null
  const p = parts(toMs(at))
  return `${p.weekday} ${p.month} ${p.day}, ${p.hour}:${p.minute} ${p.dayPeriod.toUpperCase()}`
}
