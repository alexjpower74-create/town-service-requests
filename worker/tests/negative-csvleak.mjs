// npm run negative:csvleak — the copy adds a phone column to the CSV. The CSV privacy test must go red.
import { runControl } from './negative-lib.mjs'
await runControl({
  title: 'negative:csvleak',
  tests: ["CSV export never contains the reporter's name, phone, description or note text"],
  breaks: [
    { file: 'src/csv.js', find: "  'Days to close', 'Public message']\n", replace: "  'Days to close', 'Public message', 'Phone']\n" },
    { file: 'src/csv.js', find: 'r.days_to_close, r.public_message]\n', replace: 'r.days_to_close, r.public_message, r.reporter_phone]\n' },
    { file: 'src/index.js', find: '({ ...s, public_message: row.public_message })', replace: '({ ...s, public_message: row.public_message, reporter_phone: row.reporter_phone })' }
  ],
  describe: "the CSV carries the reporter's phone"
})
