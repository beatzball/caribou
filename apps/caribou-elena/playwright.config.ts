import { defineConfig, devices } from '@playwright/test'

const isCI = !!process.env.CI

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI ? [['html'], ['github']] : [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm build && node dist/server/server/index.mjs',
        url: 'http://localhost:3000',
        reuseExistingServer: !isCI,
        timeout: 120_000,
      },
  projects: isCI
    ? [
        { name: 'chromium', use: devices['Desktop Chrome'] },
        { name: 'firefox',  use: devices['Desktop Firefox'] },
        { name: 'webkit',   use: devices['Desktop Safari'] },
      ]
    : [
        { name: 'chromium', use: devices['Desktop Chrome'] },
      ],
})
