// The fixed lists from docs/API.md: categories (in this order everywhere) and statuses.

export const CATEGORIES = [
  { key: 'pothole', label: 'Pothole', hint: 'A hole or broken pavement in the road', sla_days: 14 },
  { key: 'streetlight', label: 'Streetlight out', hint: "A light that's out, flickering or on all day", sla_days: 10 },
  { key: 'snow', label: 'Missed snow clearing', hint: 'A street or sidewalk the plow missed', sla_days: 2 },
  { key: 'water', label: 'Water or sewer problem', hint: 'Low pressure, a leak, a bad smell or a blocked drain', sla_days: 3 },
  { key: 'garbage', label: 'Missed garbage pickup', hint: "Your bags or bin weren't picked up", sla_days: 3 },
  { key: 'tree', label: 'Fallen tree', hint: 'A tree or big branch down or blocking the way', sla_days: 5 },
  { key: 'other', label: 'Something else', hint: 'Anything else the town should look at', sla_days: 14 }
]
export const CATEGORY_KEYS = CATEGORIES.map(c => c.key)
export const categoryLabel = key => CATEGORIES.find(c => c.key === key)?.label ?? key
export const DEFAULT_SLA_DAYS = Object.fromEntries(CATEGORIES.map(c => [c.key, c.sla_days]))

export const STATUS_LABELS = {
  new: 'New',
  assigned: 'Assigned',
  in_progress: 'In progress',
  done: 'Done',
  wont_fix: "Won't fix",
  merged: 'Joined with another report'
}
export const BOARD_STATUSES = ['new', 'assigned', 'in_progress', 'done', 'wont_fix']
export const OPEN_STATUSES = ['new', 'assigned', 'in_progress']
export const CLOSED_STATUSES = ['done', 'wont_fix']
export const isOpen = status => OPEN_STATUSES.includes(status)
