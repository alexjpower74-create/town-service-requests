// npm run negative:pinguard — the copy never counts wrong PINs. The sign-in rate-guard test must go red.
import { runControl } from './negative-lib.mjs'
await runControl({
  title: 'negative:pinguard',
  tests: ['rate guard: 5 wrong PINs per IP per 15 minutes'],
  breaks: [{ file: 'src/index.js', find: "    await attemptStmt(ctx, 'pin').run() // count the wrong PIN\n", replace: '' }],
  describe: 'wrong PINs are never counted'
})
