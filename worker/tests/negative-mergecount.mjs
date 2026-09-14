// npm run negative:mergecount — the copy adds only + 1 on merge (drops the source's own plus_ones). The merge-count test must go red.
import { runControl } from './negative-lib.mjs'
await runControl({
  title: 'negative:mergecount',
  tests: ['merge keeps the +1 count'],
  breaks: [{ file: 'src/index.js', find: '  const added = source.plus_ones + 1\n', replace: '  const added = 1\n' }],
  describe: "a merge adds 1 instead of the source's plus_ones + 1"
})
