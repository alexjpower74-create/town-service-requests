// npm run negative:boundary — the copy skips the town boundary check. The outside-pin API test must go red.
import { runControl } from './negative-lib.mjs'
await runControl({
  title: 'negative:boundary',
  tests: ['create: a pin outside the boundary is refused and no request is created'],
  breaks: [{ file: 'src/index.js', find: '  if (!pointInRing([lat, lng], TOWN.boundary)) {', replace: '  if (false) {' }],
  describe: 'a pin outside the boundary is accepted'
})
