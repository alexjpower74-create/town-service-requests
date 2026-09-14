// npm run negative:overdue — the copy compares now >= created_at instead of now > due_at (ignores the SLA). The fake-clock
// overdue test must go red.
import { runControl } from './negative-lib.mjs'
await runControl({
  title: 'negative:overdue',
  tests: ['overdue on a fake clock through the API'],
  breaks: [{ file: 'src/sla.js', find: '  return isOpen(status) && dueAt !== null && now > dueAt\n', replace: '  return isOpen(status) && dueAt !== null && now >= createdAt\n' }],
  describe: 'overdue ignores the SLA and compares now with created_at'
})
