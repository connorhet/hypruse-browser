import { defineConfig } from '@playwright/test';

// The machine running these may be busy; timeouts are generous on purpose and no test
// depends on how fast something happens, only on whether it happens.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node tests/e2e/server.mjs',
    url: 'http://127.0.0.1:4321/health',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
