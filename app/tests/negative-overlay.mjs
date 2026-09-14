// Negative control (c): the copy lays a transparent, full-size element over Send report. The button still measures 56 px, so
// a rectangle check would call it fine; tap()'s elementFromPoint hit-test in report.spec must go red. Exit 0 only if red.
import path from 'node:path'
import { control, replaceOnce } from './negative-lib.mjs'

process.exit(control({
  name: 'overlay',
  what: 'a transparent element covers the Send report button',
  args: ['report.spec.mjs', '--project', 'chromium-390'],
  breakIt: (copy) => {
    replaceOnce(path.join(copy, 'app', 'public', 'index.html'),
      '<div class="actions"><button type="button" class="btn btn-primary" id="send">Send report</button></div>',
      '<div class="actions" style="position: relative"><button type="button" class="btn btn-primary" id="send">Send report</button>' +
        '<div class="negative-overlay" aria-hidden="true" style="position: absolute; inset: 0; background: transparent; z-index: 5"></div></div><!-- NEGATIVE CONTROL (c) -->')
  },
}))
