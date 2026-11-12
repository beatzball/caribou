import { test } from './_fixtures.js'
import { layoutAccessibilityTests } from './_layout-a11y.js'

// Firefox cannot emulate touch. It still checks desktop target sizes;
// Chromium and WebKit check the 44px coarse-pointer targets.
test.use({
  hasTouch: async ({ browserName }, use) => { await use(browserName !== 'firefox') },
})
layoutAccessibilityTests()
