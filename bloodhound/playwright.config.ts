import { defineConfig, devices } from '@playwright/test';

// Runs against the test database (pnpm test:e2e wraps this with .env.test).
export default defineConfig({
  testDir: 'apps/web/test/e2e',
  timeout: 120_000,
  workers: 1,
  globalSetup: './apps/web/test/e2e/global-setup.ts',
  use: { baseURL: 'http://localhost:3100', trace: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node node_modules/next/dist/bin/next start -p 3100',
    cwd: 'apps/web',
    url: 'http://localhost:3100',
    reuseExistingServer: false,
    env: { BLOODHOUND_LLM: 'replay' },
    timeout: 120_000,
  },
});
