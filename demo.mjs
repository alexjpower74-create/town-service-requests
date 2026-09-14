// npm run demo — the SAMPLE town on this computer, nothing online.
// Wipes worker/.state-<port>, applies the D1 migrations into it (--local), starts wrangler dev on 8501 (inspector 8511) with TEST_MODE=1
// (needed only to seed the SAMPLE requests; never set TEST_MODE on a deploy, see docs/DEPLOY.md), seeds the demo scenario, prints the
// links and writes them to .logs/demo-links.txt. Ctrl+C stops it.
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const WORKER = join(ROOT, 'worker')
const PORT = Number(process.env.DEMO_PORT || 8501)
const BASE = `http://127.0.0.1:${PORT}`
const STATE = join(WORKER, `.state-${PORT}`)
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }

async function answers (url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok } catch { return false }
}

if (await answers(`${BASE}/api/town`)) {
  console.error(`Something already answers on ${BASE}. It is probably the demo already running: open ${BASE}/ (or stop it first, or set DEMO_PORT).`)
  process.exit(1)
}

rmSync(STATE, { recursive: true, force: true })
const migrate = spawnSync('wrangler', ['d1', 'migrations', 'apply', 'town-service-requests', '--local', '--persist-to', STATE],
  { cwd: WORKER, env, encoding: 'utf8' })
if (migrate.status !== 0) {
  console.error(`Migrations failed:\n${migrate.stdout}\n${migrate.stderr}`)
  process.exit(1)
}

const dev = spawn('wrangler', ['dev', '--local', '--port', String(PORT), '--inspector-port', String(PORT + 10),
  '--persist-to', STATE, '--var', 'TEST_MODE:1', '--show-interactive-dev-session=false'],
{ cwd: WORKER, env, stdio: ['ignore', 'ignore', 'inherit'] })
const stop = () => { try { dev.kill('SIGTERM') } catch {} }
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { stop(); process.exit(0) })
dev.on('exit', code => { console.error(`wrangler dev stopped (exit ${code}).`); process.exit(code ?? 1) })

let up = false
for (let i = 0; i < 120 && !up; i++) {
  up = await answers(`${BASE}/api/town`)
  if (!up) await new Promise(r => setTimeout(r, 500))
}
if (!up) { console.error(`wrangler dev did not come up on ${PORT}.`); stop(); process.exit(1) }

const res = await fetch(`${BASE}/api/test/seed`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenario: 'demo' })
})
if (!res.ok) { console.error(`Seeding the demo failed: ${res.status} ${await res.text()}`); stop(); process.exit(1) }
const seed = await res.json()
const open = seed.requests.filter(r => ['new', 'assigned', 'in_progress'].includes(r.status))

const lines = [
  'Town Service Requests demo (SAMPLE town, this computer only)',
  '',
  `Resident:  ${BASE}/`,
  `Staff:     ${BASE}/staff/   PIN ${seed.pin}`,
  ...open.slice(0, 3).map(r => `Status:    ${r.status_url}   (${r.ref}, ${r.status})`),
  '',
  `${seed.requests.length} SAMPLE requests seeded. Every request's status link is in its detail on the staff board.`
]
mkdirSync(join(ROOT, '.logs'), { recursive: true })
writeFileSync(join(ROOT, '.logs', 'demo-links.txt'), lines.join('\n') + '\n')
console.log('\n' + lines.join('\n') + '\n\nRunning. Ctrl+C stops it.')
