// npm run negative:batchguard — proves the in-batch version guard of the staff PUT, which the early version check normally hides.
// Phase A (setup): the copy loses the early `version !== row.version` check, so a second save with the same version reaches the
// batch. The two-saves test must STILL PASS: the guard alone answers 409 stale and writes no history.
// Phase B (break): the copy's guardOneChange also always passes. The same test must go RED (the loser's history is written).
import { runControl } from './negative-lib.mjs'
await runControl({
  title: 'negative:batchguard',
  tests: ['PUT: two saves with the same version: one wins, the other is 409 stale and writes nothing'],
  setup: [{ file: 'src/index.js', find: '  if (body.version !== row.version) throw await stale()\n', replace: '' }],
  breaks: [{
    file: 'src/index.js',
    find: `const guardOneChange = db => db.prepare("SELECT CASE WHEN changes() = 1 THEN 1 ELSE json('refused') END")\n`,
    replace: "const guardOneChange = db => db.prepare('SELECT 1')\n"
  }],
  describe: 'the in-batch guard never refuses and the early version check is gone'
})
