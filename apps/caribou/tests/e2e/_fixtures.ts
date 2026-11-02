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

// The test instance is older than Mastodon 4.3 unless a spec says otherwise:
// it has no grouped notifications, so the list asks for single ones.
const isGroupedNotifications = (url: URL) =>
  url.host === 'example.social' && url.pathname === '/api/v2/notifications'

/** The browser logs the 404 of that probe; it is expected, not an error. */
export function isGroupedProbe404(text: string, url: string): boolean {
  return url.includes('/api/v2/notifications') && text.includes('404')
}

export const test = base.extend({
  context: async ({ context }, use) => {
    await context.route(isNotificationsList, (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        : route.fallback())
    await context.route(isGroupedNotifications, (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Not found"}' })
        : route.fallback())
    await use(context)
  },
})
