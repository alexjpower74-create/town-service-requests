// Negative control (e): the copy's map.js draws the base map with an empty custom attribution. targets.spec "the resident map
// shows the OpenFreeMap attribution" must go red: OpenFreeMap requires its attribution on the map. Exit 0 only if red.
import path from 'node:path'
import { control, replaceOnce } from './negative-lib.mjs'

process.exit(control({
  name: 'attribution',
  what: 'map.js passes an empty customAttribution (and the no-WebGL fallback adds nothing)',
  args: ['targets.spec.mjs', '--project', 'chromium-1280', '-g', 'attribution'],
  breakIt: (copy) => {
    replaceOnce(path.join(copy, 'app', 'public', 'map.js'),
      `export const ATTRIBUTION = '<a href="https://openfreemap.org"`,
      `export const ATTRIBUTION = '' // NEGATIVE CONTROL (e)\nconst ATTRIBUTION_UNUSED = '<a href="https://openfreemap.org"`)
  },
}))
