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

// ---- NL calendar: wall clock, midnight, report weeks, CSV dates ----

const wallFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
})

function wall (ms) {
  const p = {}
  for (const { type, value } of wallFmt.formatToParts(new Date(ms))) p[type] = value
  if (p.hour === '24') p.hour = '00'
  return p
}

/** NL wall-clock time minus UTC at that instant, in ms (NDT −2.5 h, NST −3.5 h). */
export function nlOffsetMs (ms) {
  const p = wall(ms)
  const wholeSecond = ms - (((ms % 1000) + 1000) % 1000)
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - wholeSecond
}

/** The UTC instant of 00:00 NL time on calendar date y-m-d (NL changes clocks at 2 AM, so midnight is never skipped or doubled). */
export function nlMidnightUtc (y, m, d) {
  const w = Date.UTC(y, m - 1, d)
  return w - nlOffsetMs(w - nlOffsetMs(w))
}

/** "YYYY-MM-DD": the NL calendar date at that instant. */
export function nlDate (at) {
  const p = wall(toMs(at))
  return `${p.year}-${p.month}-${p.day}`
}

/** "YYYY-MM-DD HH:MM" in NL time, 24-hour; '' for null. */
export function csvDateTime (at) {
  if (at === null || at === undefined) return ''
  const p = wall(toMs(at))
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`
}

/** A real calendar date "YYYY-MM-DD" as a Date at UTC midnight, else null. */
export function parseIsoDate (s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === 'string' ? s : '')
  if (!m) return null
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? d : null
}

const calendarFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
function calendarLabel (date) {
  const p = {}
  for (const { type, value } of calendarFmt.formatToParts(date)) p[type] = value
  return `${p.weekday} ${p.month} ${p.day}`
}

const bound = date => nlMidnightUtc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())

/** The NL week (Monday 00:00 to the next Monday 00:00, America/St_Johns) containing calendar date "YYYY-MM-DD". */
export function weekOf (day) {
  const d = parseIsoDate(day)
  const DAY = 86400000
  const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY)
  const sunday = new Date(monday.getTime() + 6 * DAY)
  const nextMonday = new Date(monday.getTime() + 7 * DAY)
  return {
    week_start: monday.toISOString().slice(0, 10),
    week_label: `${calendarLabel(monday)} to ${calendarLabel(sunday)}`,
    start_at: new Date(bound(monday)).toISOString(),
    end_at: new Date(bound(nextMonday)).toISOString()
  }
}
