// npm run negative:idempotent — the copy drops the submission_id lookup and the UNIQUE constraint (in the copy's migration).
// The same-submission test must go red.
import { runControl } from './negative-lib.mjs'
await runControl({
  title: 'negative:idempotent',
  tests: ['create: the same submission_id twice makes exactly one request'],
  breaks: [
    { file: 'migrations/0001_init.sql', find: '  submission_id TEXT NOT NULL UNIQUE,\n', replace: '  submission_id TEXT NOT NULL,\n' },
    { file: 'src/index.js', find: '  const existing = await findBySubmission(db, body.submission_id)\n', replace: '  const existing = null\n' }
  ],
  describe: 'a resent report is inserted again'
})
