// Negative control (d): the copy's Me too makes a new report instead of calling POST /api/requests/:id/me-too. nearby.spec must
// go red (the thanks names a new reference, the count stays 0 and a request is added). Exit 0 only if red.
import path from 'node:path'
import { control, replaceOnce } from './negative-lib.mjs'

process.exit(control({
  name: 'metoo',
  what: 'Me too creates a new request instead of calling me-too',
  args: ['nearby.spec.mjs', '--project', 'chromium-390'],
  breakIt: (copy) => {
    replaceOnce(path.join(copy, 'app', 'public', 'report.js'),
      '    const r = await api.meToo(id, deviceId())',
      '    const made = await api.createRequest({ submission_id: uuid(), device_id: deviceId(), category: r0.category, lat: state.pin.lat, lng: state.pin.lng, has_photo: false }) // NEGATIVE CONTROL (d)\n' +
        '    const r = { ref: made.ref, status_url: made.status_url, duplicate: false }')
  },
}))
