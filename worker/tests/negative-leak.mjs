// npm run negative:leak — the copy adds reporter_phone to the public status JSON. The public-status privacy test must go red.
import { runControl } from './negative-lib.mjs'
await runControl({
  title: 'negative:leak',
  tests: ['public status never contains private fields'],
  breaks: [{
    file: 'src/index.js',
    find: '    location_label: row.location_label, // public: the street name, never the pin\n',
    replace: '    location_label: row.location_label, // public: the street name, never the pin\n    reporter_phone: row.reporter_phone,\n'
  }],
  describe: "the status JSON carries the reporter's phone"
})
