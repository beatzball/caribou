import { test as base } from '@playwright/test'

export { expect, type BrowserContext, type Page } from '@playwright/test'

// A signed-in page asks the user's server for notifications as soon as it
// loads (the nav rail's unread badge). The test instance does not resolve,
// so an unmocked request fails and the browser logs it as a console error.
// Every spec that seeds a session imports `test` from here. A spec that
// cares about notifications adds its own `page.route`, which wins: page
// routes run before context routes.
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.route('**/api/v1/notifications*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await use(context)
  },
})
