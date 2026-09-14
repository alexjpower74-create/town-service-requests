// Negative control (a): the copy's resident page drops the phone-side boundary check (every pin counts as inside).
// boundary.spec "a tap outside the boundary stops at the pin step" must go red. Exit 0 only if red.
import path from 'node:path'
import { control, replaceOnce } from './negative-lib.mjs'

process.exit(control({
  name: 'boundary',
  what: 'report.js treats every pin as inside the boundary (no ray casting on the phone)',
  args: ['boundary.spec.mjs', '--project', 'chromium-390', '-g', 'outside the boundary'],
  breakIt: (copy) => {
    replaceOnce(path.join(copy, 'app', 'public', 'report.js'),
      'state.inside = insideRing([lat, lng], state.town.boundary)',
      'state.inside = true // NEGATIVE CONTROL (a)')
  },
}))
