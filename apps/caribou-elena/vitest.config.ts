import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    // Match both `tests/unit/**` and `tests/integration/**` (existing
    // convention for tests with no colocated home) plus `**/__tests__/`
    // (colocated-with-impl — used for server/lib helpers and pages/components
    // where the test wants to live next to what it covers). E2E tests under
    // `tests/e2e/` are intentionally excluded — Playwright runs those via
    // its own config.
    include: [
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      '{server,pages}/**/__tests__/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      include: ['pages/**/*.ts', 'server/**/*.ts'],
      reporter: ['text', 'lcov'],
    },
  },
})
