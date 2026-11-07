import { expect, test } from '@playwright/test'

// Throwaway: proves the e2e gate goes red when one browser fails. Reverted.
test('fails only in firefox', ({ browserName }) => {
  expect(browserName).not.toBe('firefox')
})
