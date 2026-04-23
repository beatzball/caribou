import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['pages/**/*.ts', 'server/**/*.ts'],
      reporter: ['text', 'lcov'],
    },
  },
})
