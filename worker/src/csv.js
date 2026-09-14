// The staff CSV export (docs/API.md GET /api/staff/export.csv). RFC 4180 quoting, CRLF, and a formula guard so a spreadsheet never
// runs a public message as a formula. No reporter name, phone, description or notes: the rows are StaffRequestSummary plus the
// public message only.

import { csvDateTime } from './time.js'

export const CSV_HEADER = ['Reference', 'Category', 'Location', 'Ward', 'Status', 'Crew', 'Plus ones', 'Reported', 'Due', 'Overdue', 'Closed',
  'Days to close', 'Public message']

export const csvCells = r => [r.ref, r.category_label, r.location_label, r.ward_name, r.status_label, r.crew_name, r.plus_ones,
  csvDateTime(r.created_at), csvDateTime(r.due_at), r.overdue ? 'Yes' : 'No', csvDateTime(r.closed_at), r.days_to_close, r.public_message]

export function csvCell (value) {
  let s = value === null || value === undefined ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

export const toCsv = rows => [CSV_HEADER, ...rows.map(csvCells)].map(cells => cells.map(csvCell).join(',')).join('\r\n') + '\r\n'
