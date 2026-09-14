// Due, overdue, age and days-to-close (docs/API.md "Days"). All inputs are epoch milliseconds. Pure.

import { isOpen } from './lists.js'

export const DAY_MS = 86400000
const TENTH_DAY_MS = DAY_MS / 10

/** created_at + sla_days days, or null when the category has no target. */
export function dueAt (createdAt, slaDays) {
  return slaDays === null || slaDays === undefined ? null : createdAt + slaDays * DAY_MS
}

/** Open and strictly past due. */
export function isOverdue ({ status, createdAt, dueAt, now }) {
  return isOpen(status) && dueAt !== null && now > dueAt
}

export function overdueDays ({ status, createdAt, dueAt, now }) {
  return isOverdue({ status, createdAt, dueAt, now }) ? Math.ceil((now - dueAt) / DAY_MS) : 0
}

export const ageDays = (createdAt, now) => Math.floor((now - createdAt) / DAY_MS)

/** sum of millisecond durations / count, in days, rounded half-up to 1 decimal. Integer arithmetic, no float drift. */
export function meanDaysHalfUp (totalMs, count) {
  const unit = count * TENTH_DAY_MS
  let tenths = Math.floor(totalMs / unit)
  if (2 * (totalMs - tenths * unit) >= unit) tenths += 1
  return tenths / 10
}

export function daysToClose (createdAt, closedAt) {
  return closedAt === null || closedAt === undefined ? null : meanDaysHalfUp(closedAt - createdAt, 1)
}
