import { defineConfig, devices } from '@playwright/test';

// End-to-end tests against the running compose stack, which isn't started from here: it's the
// same stack used for manual testing, and CI starts it as its own step.
//   docker compose --profile full up -d --build --wait
export default defineConfig({
  testDir: 'src',
  // In CI: fail on a forgotten test.only, retry to tell a flaky test from a broken one, one worker.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [[process.env.CI ? 'github' : 'list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    // A retried test records a trace (DOM snapshots, network, console) into the HTML report.
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
