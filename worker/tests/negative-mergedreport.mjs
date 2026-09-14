// npm run negative:mergedreport — the copy counts merged requests in the weekly report. The weekly report test must go red.
import { runControl } from './negative-lib.mjs'
await runControl({
  title: 'negative:mergedreport',
  tests: ['weekly report on a fake clock'],
  breaks: [{
    file: 'src/index.js',
    find: "  const counted = results.filter(r => r.status !== 'merged') // merged requests are the same problem counted once\n",
    replace: '  const counted = results\n'
  }],
  describe: 'merged requests are counted in the weekly report'
})
