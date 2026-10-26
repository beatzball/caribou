import { test as base } from '@playwright/test'

export { expect, type BrowserContext, type Page, type Route } from '@playwright/test'

// A signed-in page asks the user's server for notifications as soon as it
// loads (the nav rail's unread badge). The test instance does not resolve,
// so an unmocked request fails and the browser logs it as a console error.
// Every spec that seeds a session imports `test` from here. A spec that
// cares about notifications adds its own `page.route`, which wins: page
// routes run before context routes.
//
// Only a GET of the list on the test instance gets the empty answer. A
// request to another host, another method or a sub-path is not answered
// here, so it fails and shows up as a console error.
const isNotificationsList = (url: URL) =>
  url.host === 'example.social' && url.pathname === '/api/v1/notifications'

export const test = base.extend({
  context: async ({ context }, use) => {
    await context.route(isNotificationsList, (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        : route.fallback())
    await use(context)
  },
})
