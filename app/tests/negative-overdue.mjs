// Negative control (f): the copy's board decides overdue from age_days > 10 instead of the API's `overdue`. The first board checks
// still pass (the streetlight is 11 days old); after Settings moves the streetlight SLA to 12 days the API says not overdue but the
// broken board still paints it, so overdue.spec must go red at the SLA change. Exit 0 only if red.
import path from 'node:path'
import { control, replaceOnce } from './negative-lib.mjs'

process.exit(control({
  name: 'overdue',
  what: "the board reads overdue from age_days > 10 instead of the API's overdue",
  args: ['overdue.spec.mjs', '--project', 'chromium-1280'],
  breakIt: (copy) => {
    replaceOnce(path.join(copy, 'app', 'public', 'staff', 'staff.js'),
      'function card(r) {\n',
      'function card(r) {\n  r = { ...r, overdue: r.age_days > 10 } // NEGATIVE CONTROL (f)\n')
  },
}))
