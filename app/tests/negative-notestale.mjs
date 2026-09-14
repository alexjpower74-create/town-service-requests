// Negative control (g): the copy's Save goes back to the old behaviour, comparing the form with (and sending the version of) the
// newest answer it holds, which after Add note is the note's. staff.spec "a Save after adding a note never undoes a change made
// meanwhile" must go red: the Save answers 200 and undoes the other session's crew. Exit 0 only if red.
import path from 'node:path'
import { control, replaceOnce } from './negative-lib.mjs'

process.exit(control({
  name: 'notestale',
  what: "Save builds its body from the note's newer answer instead of what the form was drawn from",
  args: ['staff.spec.mjs', '--project', 'chromium-1280', '-g', 'note never undoes'],
  breakIt: (copy) => {
    replaceOnce(path.join(copy, 'app', 'public', 'staff', 'staff.js'),
      '  const f = state.form\n',
      "  const f = { ...state.detail, public_message: state.detail.public_message || '' } // NEGATIVE CONTROL (g)\n")
  },
}))
