// Negative control (b): the copy's Worker adds reporter_phone to the public status JSON. The page does not display it, so only
// report.spec's check on every response body the status page loaded can catch it. Exit 0 only if red.
import path from 'node:path'
import { control, replaceOnce } from './negative-lib.mjs'

process.exit(control({
  name: 'statusleak',
  what: "the Worker's GET /api/status answer carries reporter_phone",
  args: ['report.spec.mjs', '--project', 'chromium-390'],
  breakIt: (copy) => {
    replaceOnce(path.join(copy, 'worker', 'src', 'index.js'),
      '    location_label: row.location_label, // public: the street name, never the pin',
      '    location_label: row.location_label, // public: the street name, never the pin\n    reporter_phone: row.reporter_phone, // NEGATIVE CONTROL (b)')
  },
}))
