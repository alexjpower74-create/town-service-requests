// npm run negative:week — the copy uses UTC midnight for the report week instead of NL midnight. The NL week boundary test must go red.
import { runControl } from './negative-lib.mjs'
await runControl({
  title: 'negative:week',
  tests: ['weekly report: NL week boundaries, the Sunday 11:30 PM request and the DST weeks'],
  breaks: [{
    file: 'src/time.js',
    find: 'const bound = date => nlMidnightUtc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())\n',
    replace: 'const bound = date => date.getTime()\n'
  }],
  describe: 'the report week runs from UTC midnight instead of NL midnight'
})
