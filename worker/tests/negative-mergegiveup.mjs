// npm run negative:mergegiveup — proves the merge's give-up path (API.md clarification 13), which no request can reach on the
// shipped Worker. Phase A (setup): the copy binds `source.version - 1`, so every merge batch loses its version guard; the give-up
// test must PASS (409 bad_state after the retries, nothing written). Phase B (break): the copy's catch rethrows instead; the same
// test must go RED (500).
import { runControl } from './negative-lib.mjs'
await runControl({
  title: 'negative:mergegiveup',
  testFile: 'tests/merge-giveup.test.mjs',
  tests: ['merge: a merge that keeps losing its version guard gives up with 409 and writes nothing'],
  setup: [{ file: 'src/index.js', find: '.bind(target.id, at, at, source.id, source.version),\n', replace: '.bind(target.id, at, at, source.id, source.version - 1),\n' }],
  breaks: [{
    file: 'src/index.js',
    find: "    throw badState('Someone else changed one of these reports. Reload and try again.') // clarification 13\n",
    replace: '    throw e\n'
  }],
  describe: 'a merge that keeps losing its guard rethrows (500) instead of answering 409'
})
