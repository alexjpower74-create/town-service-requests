// npm run negative:radius — the copy's "Already reported nearby" radius is 70 m. The 60 m test must go red.
import { runControl } from './negative-lib.mjs'
await runControl({
  title: 'negative:radius',
  tests: ['nearby: a pothole at 40 m is found and one at 60 m is not'],
  breaks: [{ file: 'src/index.js', find: 'const NEARBY_METRES = 50\n', replace: 'const NEARBY_METRES = 70\n' }],
  describe: 'the nearby radius is 70 m instead of 50 m'
})
