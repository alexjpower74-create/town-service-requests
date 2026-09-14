// The SAMPLE rows that migrations/0002_sample.sql inserts, for POST /api/test/reset. tests/unit.test.mjs checks the two match.

import { DEFAULT_SLA_DAYS } from './lists.js'

export const SAMPLE_PIN = '3690'

export const SAMPLE_SETTINGS = {
  town_name: 'SAMPLE Town of Harbour Pond (demo)',
  emergency_phone: '709-555-0142',
  office_phone: '709-555-0100',
  office_hours: 'Monday to Friday, 9 AM to 4:30 PM',
  sla_days: DEFAULT_SLA_DAYS,
  pin_hash: 'eDgQfmxhAIq9BJaxiUZgzQiqjJIRc9bYEeKjqg7uv3g=',
  pin_salt: 'OseAgYK1dia5PkE4jNZUig==',
  pin_iterations: 100000
}

export const SAMPLE_CREWS = [
  { id: 1, name: 'Roads crew (SAMPLE)' },
  { id: 2, name: 'Water and sewer crew (SAMPLE)' },
  { id: 3, name: 'Parks and trees crew (SAMPLE)' }
]

const WIPE = ['request_history', 'metoo_devices', 'photos', 'upload_tokens', 'requests', 'crews', 'staff_sessions', 'attempts', 'settings']

/** Statements that wipe every table and write the SAMPLE settings, PIN and crews (one D1 batch). */
export function resetStatements (db) {
  const s = SAMPLE_SETTINGS
  return [
    ...WIPE.map(t => db.prepare(`DELETE FROM ${t}`)),
    db.prepare(`INSERT INTO settings (id, town_name, emergency_phone, office_phone, office_hours, sla_days, pin_hash, pin_salt, pin_iterations)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(s.town_name, s.emergency_phone, s.office_phone, s.office_hours, JSON.stringify(s.sla_days), s.pin_hash, s.pin_salt, s.pin_iterations),
    ...SAMPLE_CREWS.map(c => db.prepare('INSERT INTO crews (id, name, active) VALUES (?, ?, 1)').bind(c.id, c.name))
  ]
}
