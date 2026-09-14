// Town Service Requests end-to-end suite. Every spec runs against the real Worker (it serves app/public too), started fresh by
// tests/start-worker.mjs on E2E_PORT (default 8503, inspector +10) with TEST_MODE=1. One worker: the specs share one D1.
// E2E_WORKER_DIR points the server at a copy of the Worker (negative controls, port 8506).
// Tests tagged @phone run only in the 390 projects, @desktop only in the 1280 ones, @shots (screenshots) only in chromium
// (filtered by project, never counted as skipped).
import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT || 8503)

export default defineConfig({
  testDir: './tests',
  testMatch: '*.spec.mjs',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  outputDir: './tests/results',
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node tests/start-worker.mjs',
    url: `http://127.0.0.1:${PORT}/api/town`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: { ...process.env, E2E_PORT: String(PORT) },
  },
  projects: [
    { name: 'chromium-390', grepInvert: /@desktop/, use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } },
    { name: 'chromium-1280', grepInvert: /@phone/, use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } },
    { name: 'webkit-390', grepInvert: /@desktop|@shots/, use: { ...devices['iPhone 14'], browserName: 'webkit' } },
    { name: 'webkit-1280', grepInvert: /@phone|@shots/, use: { browserName: 'webkit', viewport: { width: 1280, height: 800 } } },
  ],
})
