// npm run negative:csvguard — the copy drops the CSV formula guard. The CSV test must go red.
import { runControl } from './negative-lib.mjs'
await runControl({
  title: 'negative:csvguard',
  tests: ['CSV export: header, CRLF, quoting, formula guard and NL-date filename'],
  breaks: [{ file: 'src/csv.js', find: "  if (/^[=+\\-@\\t\\r]/.test(s)) s = `'${s}`\n", replace: '' }],
  describe: 'a cell starting with = is written as is'
})
